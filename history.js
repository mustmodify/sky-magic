#!/usr/bin/env node
// Focus Forecast — score history recorder.
//
//   node history.js record    snapshot every event × site × metric into SQLite
//   node history.js report    trajectories per event, plus drift-by-lead-time
//   node history.js schema    print the schema (for ad-hoc sqlite3 queries)
//   node history.js prune     drop snapshots older than --days=365
//
// report flags: --metric=clouds --site=craggy --days=14
//
// The question this answers: for a given event, does its score walk steadily in
// one direction as the event approaches (a model bias we could correct for), or
// does it bounce (genuine uncertainty we should show as a range)?
//
// Storage is SQLite via the sqlite3 CLI — no npm dependencies, and the file is
// queryable by hand. Node 20 predates the built-in node:sqlite module.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DB = process.env.FF_HISTORY_DB || path.join(__dirname, 'data', 'history.db');
const SQLITE = '/usr/bin/sqlite3';

// ---------------------------------------------------------------------------
// SQLite plumbing
// ---------------------------------------------------------------------------
const q = v => v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
const n = v => v == null || Number.isNaN(v) ? 'NULL' : String(v);

function sql(script) {
  const r = spawnSync(SQLITE, [DB], { input: script, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`sqlite3: ${r.stderr || r.stdout}`);
  return r.stdout;
}

function rows(query) {
  const r = spawnSync(SQLITE, ['-json', DB, query], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`sqlite3: ${r.stderr || r.stdout}`);
  return r.stdout.trim() ? JSON.parse(r.stdout) : [];
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS snapshots (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  taken_ms     INTEGER NOT NULL,
  taken_iso    TEXT    NOT NULL,
  generated_at TEXT,
  source       TEXT              -- 'http' (live server) or 'inline' (own fetch)
);
CREATE TABLE IF NOT EXISTS scores (
  snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  event_ms    INTEGER NOT NULL, -- identity of the event across snapshots
  event_kind  TEXT    NOT NULL, -- sunrise | sunset
  event_local TEXT    NOT NULL, -- "Tue, Jul 28 8:36 PM"
  lead_hours  REAL    NOT NULL, -- hours from snapshot to event
  site        TEXT    NOT NULL,
  path        TEXT    NOT NULL, -- 'overall', 'clouds', 'clouds.bands.near.near-high'
  depth       INTEGER NOT NULL, -- 0 = overall, 1 = top-level metric, ...
  name        TEXT,
  score       REAL,
  grade       TEXT,
  value       TEXT,             -- the leaf's human-readable reading ("81%")
  no_go       TEXT              -- no-go reasons, joined, when present
);
CREATE INDEX IF NOT EXISTS scores_series ON scores (event_ms, site, path, lead_hours);
CREATE INDEX IF NOT EXISTS scores_snapshot ON scores (snapshot_id);
`;

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

// Prefer the running server (its raw cache is at most 15 min old, so this adds
// no upstream API load); fall back to building the payload in-process so a
// snapshot still lands if the server is down.
async function getPayload() {
  const { CONFIG } = require('./server.js');
  try {
    const res = await fetch(`http://127.0.0.1:${CONFIG.port}/api/forecast`, { signal: AbortSignal.timeout(30000) });
    if (res.ok) return { payload: await res.json(), source: 'http' };
  } catch { /* server down — build it ourselves */ }
  const { getRaw, buildPayload } = require('./server.js');
  return { payload: buildPayload(await getRaw(), null), source: 'inline' };
}

// Unattended job: a single upstream hiccup shouldn't cost a 4-hour data point.
async function getPayloadWithRetry(tries = 3, waitMs = 45000) {
  for (let i = 1; ; i++) {
    try { return await getPayload(); }
    catch (err) {
      if (i >= tries) throw err;
      console.error(`attempt ${i} failed (${err.message}) — retrying in ${waitMs / 1000}s`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
}

function flatten(node, prefix, out) {
  const p = prefix ? `${prefix}.${node.key}` : node.key;
  out.push({ path: p, depth: p.split('.').length, name: node.name, score: node.score, grade: node.grade, value: node.value ?? null });
  for (const child of node.children || []) flatten(child, p, out);
}

// JW (2026-10-07, via Jarvis): "go to two hours in the last 12 hours." He saw
// an A- for a Mitchell sunrise one evening and a B+ the next morning; the drop
// turned out to be real (a late horizon cloud bank, 2.9->1.68 between the 11h
// and 7h snapshots) but the 4-hourly cadence couldn't show him it happening,
// only the before and after. Drift analysis backs the threshold: average
// |score change| is 0.07 inside 6h, 0.31 at 6-12h, ~0.45 at 12-48h — almost
// all the settling happens inside 12h, so that is where resolution pays for
// itself. --max-lead=N restricts a run to events within N hours, so a denser
// cron slot can snapshot just the near events without doubling the full
// 72h-horizon snapshot's size every time it fires.
async function record(maxLeadHours = null) {
  fs.mkdirSync(path.dirname(DB), { recursive: true });
  sql(SCHEMA);

  const { payload, source } = await getPayloadWithRetry();
  const takenMs = Date.now();
  const events = maxLeadHours == null ? payload.events
    : payload.events.filter(ev => (ev.ms - takenMs) / 3600000 <= maxLeadHours);
  if (!events.length) { console.log(`${new Date(takenMs).toISOString()} · ${source} · no events within ${maxLeadHours}h, nothing recorded`); return; }

  // Insert the snapshot first and read its id back. `last_insert_rowid()` would
  // be wrong here: `scores` has an implicit rowid, so the first score insert
  // clobbers it and every later row would point at the wrong snapshot.
  sql(`INSERT INTO snapshots (taken_ms, taken_iso, generated_at, source) VALUES (${n(takenMs)}, ${q(new Date(takenMs).toISOString())}, ${q(payload.generatedAt)}, ${q(source)});`);
  const snapId = rows('SELECT MAX(id) AS id FROM snapshots')[0].id;

  const stmts = ['BEGIN;'];
  let rowCount = 0;
  for (const ev of events) {
    const leadHours = +((ev.ms - takenMs) / 3600000).toFixed(2);
    const local = `${ev.day} ${ev.time}`;
    for (const site of ev.sites) {
      const nodes = [{ path: 'overall', depth: 0, name: 'Overall', score: site.overall, grade: site.grade, value: null }];
      for (const m of site.metrics) flatten(m, '', nodes);
      const noGo = site.noGo?.length ? site.noGo.join('; ') : null;
      for (const nd of nodes) {
        stmts.push(
          `INSERT INTO scores (snapshot_id, event_ms, event_kind, event_local, lead_hours, site, path, depth, name, score, grade, value, no_go) ` +
          `VALUES (${n(snapId)}, ${n(ev.ms)}, ${q(ev.kind)}, ${q(local)}, ${n(leadHours)}, ${q(site.id)}, ${q(nd.path)}, ${n(nd.depth)}, ${q(nd.name)}, ${n(nd.score)}, ${q(nd.grade)}, ${q(nd.value)}, ${nd.path === 'overall' ? q(noGo) : 'NULL'});`
        );
        rowCount++;
      }
    }
  }
  stmts.push('COMMIT;');
  sql(stmts.join('\n'));

  const check = rows(`SELECT COUNT(*) c FROM scores WHERE snapshot_id = ${n(snapId)}`)[0];
  const scope = maxLeadHours == null ? '' : ` (<=${maxLeadHours}h only, of ${payload.events.length})`;
  console.log(`${new Date(takenMs).toISOString()} · ${source} · ${events.length} events${scope} × ${events[0]?.sites.length ?? 0} sites → ${check.c}/${rowCount} rows`);
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------
const SPARK = '▁▂▃▄▅▆▇█';
const spark = scores => scores.map(s => SPARK[Math.max(0, Math.min(7, Math.round((s / 4.3) * 7)))]).join('');
const signed = v => (v > 0 ? '+' : '') + v.toFixed(2);

function report(opts) {
  if (!fs.existsSync(DB)) return console.log('No history yet — run `node history.js record` (cron does this every 4 hours).');
  const metric = opts.metric || 'overall';
  const siteFilter = opts.site ? ` AND site = ${q(opts.site)}` : '';
  const since = Date.now() - (opts.days || 14) * 86400000;

  const series = rows(
    `SELECT event_ms, event_kind, event_local, site, lead_hours, score, grade
       FROM scores
      WHERE path = ${q(metric)} AND event_ms > ${n(since)}${siteFilter}
      ORDER BY event_ms, site, lead_hours DESC`
  );
  if (!series.length) return console.log(`No rows for metric '${metric}'. Try: node history.js schema`);

  const snaps = rows('SELECT COUNT(*) c, MIN(taken_iso) a, MAX(taken_iso) b FROM snapshots')[0];
  console.log(`\nMetric: ${metric}   ·   ${snaps.c} snapshots  (${snaps.a?.slice(0, 16)} → ${snaps.b?.slice(0, 16)})\n`);

  // Per-event trajectories: the same event scored again and again as it nears.
  const byEvent = new Map();
  for (const r of series) {
    const k = `${r.event_ms}|${r.site}`;
    if (!byEvent.has(k)) byEvent.set(k, []);
    byEvent.get(k).push(r);
  }

  const drift = [];   // (Δscore per snapshot step, bucketed by lead time)
  let lastEvent = null;
  for (const [, obs] of byEvent) {
    if (obs.length < 2) continue;                       // need a trajectory
    const head = obs[0], tail = obs[obs.length - 1];
    const scores = obs.map(o => o.score).filter(s => s != null);
    if (scores.length < 2) continue;
    const steps = scores.slice(1).map((s, i) => s - scores[i]);
    const net = scores[scores.length - 1] - scores[0];
    const churn = steps.reduce((a, b) => a + Math.abs(b), 0) / steps.length;
    const monotone =
      churn < 0.02 ? '— flat' :
      steps.every(d => d >= -0.01) ? '↑ steady' :
      steps.every(d => d <= 0.01) ? '↓ steady' : 'bounces';

    for (let i = 1; i < obs.length; i++) {
      if (obs[i].score == null || obs[i - 1].score == null) continue;
      drift.push({ lead: obs[i].lead_hours, d: obs[i].score - obs[i - 1].score });
    }

    const label = `${head.event_local} ${head.event_kind}`;
    if (label !== lastEvent) { console.log(`  ${label}`); lastEvent = label; }
    console.log(
      `    ${head.site.padEnd(10)} ${spark(scores)}  ` +
      `${scores[0].toFixed(2)} → ${tail.score.toFixed(2)} (${tail.grade})  ` +
      `net ${signed(net).padStart(6)}  churn ${churn.toFixed(2)}/step  ${monotone}  ` +
      `[${head.lead_hours.toFixed(0)}h → ${tail.lead_hours.toFixed(0)}h out]`
    );
  }

  // The aggregate question: is there a systematic bias by lead time?
  if (drift.length) {
    const buckets = [[48, 999, '48h+'], [24, 48, '24–48h'], [12, 24, '12–24h'], [0, 12, '0–12h']];
    console.log('\n  Drift as the event approaches (mean change per snapshot step):');
    for (const [lo, hi, label] of buckets) {
      const b = drift.filter(x => x.lead >= lo && x.lead < hi);
      if (!b.length) continue;
      const mean = b.reduce((a, x) => a + x.d, 0) / b.length;
      const abs = b.reduce((a, x) => a + Math.abs(x.d), 0) / b.length;
      const bar = mean >= 0 ? ' '.repeat(10) + '█'.repeat(Math.min(10, Math.round(mean * 20)))
                            : ' '.repeat(10 - Math.min(10, Math.round(-mean * 20))) + '█'.repeat(Math.min(10, Math.round(-mean * 20)));
      console.log(`    ${label.padEnd(8)} n=${String(b.length).padStart(4)}  mean ${signed(mean)}  |Δ| ${abs.toFixed(2)}  ${bar}`);
    }
    console.log('    (mean ≫ 0 = forecasts brighten as the event nears; ≈ 0 with big |Δ| = pure noise)\n');
  }
}

// A snapshot costs roughly 100 KB (≈1000 rows), so 6/day is ~200 MB/year.
// Old rows stay useful for calibration, so pruning is manual and generous.
function prune(opts) {
  const days = opts.days || 365;
  const cutoff = Date.now() - days * 86400000;
  sql(`DELETE FROM scores WHERE snapshot_id IN (SELECT id FROM snapshots WHERE taken_ms < ${n(cutoff)});
       DELETE FROM snapshots WHERE taken_ms < ${n(cutoff)};
       VACUUM;`);
  console.log(`Pruned snapshots older than ${days} days.`);
}

// ---------------------------------------------------------------------------
const cmd = process.argv[2] || 'record';
const opts = {};
for (let i = 3; i < process.argv.length; i++) {
  const m = process.argv[i].match(/^--([^=]+)=(.*)$/);
  if (m) opts[m[1]] = /^\d+$/.test(m[2]) ? +m[2] : m[2];
}

if (cmd === 'record') record(opts['max-lead'] ?? null).then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
else if (cmd === 'report') report(opts);
else if (cmd === 'schema') console.log(SCHEMA);
else if (cmd === 'prune') prune(opts);
else { console.error(`Unknown command '${cmd}'. Use: record | report | schema | prune`); process.exit(1); }
