#!/usr/bin/env node

// MCP server exposing focus-forecast's upcoming projections as tools.
//
// Reads the same JSON:API the phone reads (http://localhost:5813/api/...) and
// the same SQLite file `history.js` writes, so there is exactly one source of
// truth for a score: this file computes nothing, it only fetches and reshapes.
// If a grade here ever disagrees with the web UI, this file is wrong.
//
// .mcp.json entry:
//   "focus-forecast": {
//     "command": "node",
//     "args": ["/home/jw/projects/mustmodify/focus-forecast/mcp-server.js"]
//   }
//
// No dependencies, matching the rest of the project (README: "No dependencies
// (Node 18+)"). MCP over stdio is newline-delimited JSON-RPC 2.0, which is
// small enough to speak directly; pulling in @modelcontextprotocol/sdk would
// mean giving this repo its first package.json and node_modules for maybe 80
// lines of framing. The tron-channel server uses the SDK because it lives in a
// worktree that already has it.
//
// Transport rule that matters more than any other here: stdout carries JSON-RPC
// and nothing else. Every log, warning and stack trace goes to stderr. A stray
// console.log corrupts the stream and the client sees the server hang.

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const BASE_URL = (process.env.FOCUS_FORECAST_URL || 'http://localhost:5813').replace(/\/+$/, '');
const DB = process.env.FOCUS_FORECAST_DB || path.join(__dirname, 'data', 'history.db');
const SQLITE = '/usr/bin/sqlite3';
const FETCH_TIMEOUT_MS = 10_000;

const log = (...a) => process.stderr.write(`[focus-forecast-mcp] ${a.join(' ')}\n`);

// ---------------------------------------------------------------- data access

// The server is a user systemd unit, so "not running" is a normal state worth a
// good error rather than a stack trace: the fix is one command and the caller
// is the person who can run it.
async function api(pathname) {
  const url = `${BASE_URL}${pathname}`;
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (e) {
    const why = e.name === 'TimeoutError' ? `no response in ${FETCH_TIMEOUT_MS / 1000}s` : e.message;
    throw new Error(
      `Cannot reach focus-forecast at ${BASE_URL} (${why}). ` +
      `Check it with: systemctl --user status focus-forecast.service`
    );
  }
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

// sqlite3 CLI, same as history.js — Node 20 predates node:sqlite.
function query(sql) {
  if (!fs.existsSync(DB)) {
    throw new Error(
      `No score history at ${DB}. It is written by the 4-hourly cron job; ` +
      `run \`node history.js record\` once to create it.`
    );
  }
  const r = spawnSync(SQLITE, ['-json', DB, sql], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.error) throw new Error(`sqlite3: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`sqlite3: ${(r.stderr || r.stdout || '').trim()}`);
  return r.stdout.trim() ? JSON.parse(r.stdout) : [];
}

// Identifiers reach SQL by string interpolation because the sqlite3 CLI takes no
// bind parameters, so they are whitelisted rather than escaped. Anything that is
// not a plain identifier is refused outright — a metric path is [a-z0-9._-] by
// construction (see the `path` column: 'clouds.bands.near'), and a value that
// isn't cannot be a real one.
const IDENT = /^[a-z0-9][a-z0-9._-]*$/i;
function ident(value, label) {
  if (typeof value !== 'string' || !IDENT.test(value)) {
    throw new Error(`Invalid ${label}: ${JSON.stringify(value)}. Expected letters, digits, dot, dash or underscore.`);
  }
  return value;
}

// ------------------------------------------------------------------- reshaping

// The JSON:API envelope is built for a phone browsing links; an agent wants the
// answer. These strip `links`/`relationships` and inline the `included` sites so
// one tool call is one complete thought.
const timeOf = (t) => (t && (t.local || t.at) ? { local: t.local, at: t.at } : null);

function siteRow(inc) {
  const a = inc.attributes;
  return {
    site: a.site,
    name: a.name,
    score: a.score,
    grade: a.grade,
    calibration_only: a.calibration_only,
    no_go: a.no_go && a.no_go.length ? a.no_go : undefined,
    photo_time: timeOf(a.photo_time),
    depart_time: timeOf(a.depart_time),
    alarm_time: timeOf(a.alarm_time),
    legs: a.legs,
    subscores: a.subscores,
  };
}

function eventRow(d) {
  const a = d.attributes;
  return {
    id: d.id,
    event: a.event,
    kind: a.kind,
    date: a.date,
    event_time: timeOf(a.event_time),
    hours_out: a.hours_out,
    best: { site: a.best_site, score: a.best_score, grade: a.best_score_grade },
    worst: { site: a.worst_site, score: a.worst_score, grade: a.worst_score_grade },
    go: a.go,
  };
}

// Ranked the way the app ranks: Home is a calibration proxy scoring sky alone,
// not a place you can drive to, so it is listed but never competes.
function rankSites(included = []) {
  const rows = included.filter((i) => i.type === 'site-forecasts').map(siteRow);
  const ranked = rows.filter((r) => !r.calibration_only).sort((a, b) => b.score - a.score);
  const calibration = rows.filter((r) => r.calibration_only);
  return { ranked, calibration };
}

function withMeta(payload, doc) {
  const m = doc.meta || {};
  return {
    ...payload,
    meta: {
      generated_at: m.generated_at,
      timezone: m.timezone,
      horizon_hours: m.horizon_hours,
      scale: m.scale,
      // A stale or failed road-closure fetch can silently un-blank a no-go, so
      // it travels with every answer rather than being something to remember to ask for.
      access: m.access,
    },
  };
}

// ----------------------------------------------------------------------- tools

const TOOLS = [
  {
    name: 'next_opportunity',
    description:
      'The next sunrise or sunset in the 72h horizon, with every site scored and ranked best-first. ' +
      'Use this for "should I shoot tonight?" — it carries the overall grade, per-site subscores, ' +
      'no-go reasons, and the departure/alarm chain for the winning site.',
    inputSchema: {
      type: 'object',
      properties: {
        depth: { type: 'integer', minimum: 1, maximum: 4, description: 'Subscore tree depth (1 = top-level metrics only, 3 = leaves). Default 1.' },
      },
    },
    async run({ depth }) {
      const doc = await api(`/api/opportunities/next.json${depth ? `?depth=${Number(depth)}` : ''}`);
      const { ranked, calibration } = rankSites(doc.included);
      return withMeta({ event: eventRow(doc.data), sites: ranked, calibration_only: calibration }, doc);
    },
  },
  {
    name: 'list_opportunities',
    description:
      'Every sunrise/sunset event in the 72h horizon, one row each with best and worst site scores. ' +
      'The overview — use it to find which upcoming event is worth a closer look, then call get_opportunity.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['sunrise', 'sunset'], description: 'Only events of this kind.' },
        min_score: { type: 'number', description: 'Only events whose best site scores at least this (0–4).' },
      },
    },
    async run({ kind, min_score }) {
      const doc = await api('/api/opportunities.json');
      let events = doc.data.map(eventRow);
      if (kind) events = events.filter((e) => e.kind === kind);
      if (typeof min_score === 'number') events = events.filter((e) => e.best.score >= min_score);
      return withMeta({ count: events.length, events }, doc);
    },
  },
  {
    name: 'get_opportunity',
    description:
      'One event in full: every site with score, grade, no-go reasons, subscores and the whole ' +
      'departure chain. Omit `kind` to get both sunrise and sunset for that date.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Event date, YYYY-MM-DD.' },
        kind: { type: 'string', enum: ['sunrise', 'sunset'], description: 'Omit for both events that day.' },
        depth: { type: 'integer', minimum: 1, maximum: 4, description: 'Subscore tree depth. Default 1.' },
      },
      required: ['date'],
    },
    async run({ date, kind, depth }) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error(`date must be YYYY-MM-DD, got ${JSON.stringify(date)}`);
      const id = kind ? `${date}-${kind}` : date;
      const doc = await api(`/api/opportunities/${id}.json${depth ? `?depth=${Number(depth)}` : ''}`);
      const { ranked, calibration } = rankSites(doc.included);
      const events = Array.isArray(doc.data) ? doc.data.map(eventRow) : [eventRow(doc.data)];
      return withMeta({ events, sites: ranked, calibration_only: calibration }, doc);
    },
  },
  {
    name: 'get_site_scores',
    description:
      'The full subscore tree for one site at one event — why it scored what it scored. ' +
      'Returns each metric with its score, grade and the leaf reading behind it. Defaults to the next event.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Site id: mitchell, craggy, greenknob, or home.' },
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Event date. Omit for the next event.' },
        kind: { type: 'string', enum: ['sunrise', 'sunset'], description: 'Required when `date` is given.' },
        depth: { type: 'integer', minimum: 1, maximum: 4, description: 'Tree depth. Default 3 (down to leaves).' },
      },
      required: ['site'],
    },
    async run({ site, date, kind, depth }) {
      const d = depth ? Number(depth) : 3;
      const pathname = date
        ? `/api/opportunities/${date}${kind ? `-${kind}` : ''}.json?depth=${d}`
        : `/api/opportunities/next.json?depth=${d}`;
      const doc = await api(pathname);
      const rows = (doc.included || []).filter((i) => i.type === 'site-forecasts');
      const match = rows.filter((i) => i.attributes.site === site);
      if (!match.length) {
        const known = [...new Set(rows.map((i) => i.attributes.site))];
        throw new Error(`No site ${JSON.stringify(site)} at that event. Known sites: ${known.join(', ')}`);
      }
      // A bare date matches both that day's events, so return each separately
      // rather than silently picking one.
      const out = match.map((i) => ({ event: i.id.split(':')[0], ...siteRow(i) }));
      return withMeta(out.length === 1 ? out[0] : { site, events: out }, doc);
    },
  },
  {
    name: 'score_history',
    description:
      'How a score moved as an event approached, from data/history.db (snapshots every 4h). ' +
      'Answers whether a score drifts steadily in one direction as the event nears (a bias) or ' +
      'bounces (real uncertainty). Returns one series per event, oldest lead time first.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Site id, e.g. craggy. Omit for all sites.' },
        metric: { type: 'string', description: "Metric path: 'overall' (default), 'clouds', 'clouds.bands.near'." },
        days: { type: 'integer', minimum: 1, maximum: 365, description: 'How far back to look. Default 14.' },
        kind: { type: 'string', enum: ['sunrise', 'sunset'], description: 'Only events of this kind.' },
      },
    },
    async run({ site, metric, days, kind }) {
      const p = ident(metric || 'overall', 'metric');
      const back = Math.min(365, Math.max(1, Number(days) || 14));
      const since = Date.now() - back * 86_400_000;
      const where = [`s.path = '${p}'`, `s.event_ms >= ${since}`];
      if (site) where.push(`s.site = '${ident(site, 'site')}'`);
      if (kind) where.push(`s.event_kind = '${ident(kind, 'kind')}'`);
      const rows = query(
        `SELECT s.event_ms, s.event_kind, s.event_local, s.site, s.lead_hours, s.score, s.grade, s.value, s.no_go
           FROM scores s
          WHERE ${where.join(' AND ')}
          ORDER BY s.event_ms, s.site, s.lead_hours DESC`
      );
      if (!rows.length) {
        return { metric: p, days: back, series: [], note: `No rows for path '${p}' in the last ${back} days. Try metric 'overall', or check \`node history.js schema\`.` };
      }
      const byKey = new Map();
      for (const r of rows) {
        const key = `${r.event_ms}:${r.site}`;
        if (!byKey.has(key)) {
          byKey.set(key, { event: r.event_local, kind: r.event_kind, site: r.site, points: [] });
        }
        byKey.get(key).points.push({ lead_hours: r.lead_hours, score: r.score, grade: r.grade, value: r.value || undefined, no_go: r.no_go || undefined });
      }
      const series = [...byKey.values()].map((s) => {
        const scored = s.points.filter((p2) => typeof p2.score === 'number');
        const first = scored[0], last = scored[scored.length - 1];
        // Churn is total absolute movement, so a score that swings 2 points and
        // lands where it started reads as volatile rather than stable.
        let churn = 0;
        for (let i = 1; i < scored.length; i++) churn += Math.abs(scored[i].score - scored[i - 1].score);
        return {
          ...s,
          snapshots: s.points.length,
          net_change: first && last ? Number((last.score - first.score).toFixed(2)) : null,
          churn: Number(churn.toFixed(2)),
          final_score: last ? last.score : null,
          final_grade: last ? last.grade : null,
        };
      });
      return { metric: p, days: back, event_count: series.length, series };
    },
  },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// -------------------------------------------------------------- JSON-RPC/stdio

const PROTOCOL_VERSION = '2025-06-18';
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg;
  // Notifications carry no id and must never be answered — replying to one is a
  // protocol violation the client reports as an unsolicited response.
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize':
      return reply(id, {
        // Echo the client's version when it names one; a client that speaks an
        // older revision should not be told a newer number it may not parse.
        protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'focus-forecast', version: '1.0.0' },
      });

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return;

    case 'ping':
      return isNotification ? undefined : reply(id, {});

    case 'tools/list':
      return reply(id, {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });

    case 'tools/call': {
      const tool = BY_NAME.get(params?.name);
      if (!tool) return fail(id, -32602, `Unknown tool: ${params?.name}`);
      try {
        const result = await tool.run(params.arguments || {});
        return reply(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
      } catch (e) {
        // A tool that fails is a result the model should see and reason about
        // (the server may simply be down), not a transport-level error that
        // aborts the call.
        log(`${tool.name} failed: ${e.message}`);
        return reply(id, { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
      }
    }

    default:
      if (isNotification) return;
      return fail(id, -32601, `Method not found: ${method}`);
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      log(`ignoring unparseable line (${line.length} bytes)`);
      continue;
    }
    // Each message is handled independently; one failure must not stop the loop.
    Promise.resolve(handle(msg)).catch((e) => {
      log(`handler error: ${e.stack || e.message}`);
      if (msg && msg.id !== undefined && msg.id !== null) fail(msg.id, -32603, `Internal error: ${e.message}`);
    });
  }
});
process.stdin.on('end', () => process.exit(0));

log(`ready — api ${BASE_URL}, history ${DB}`);
