#!/usr/bin/env node
// Ground truth, source: active volcanic ash advisories worldwide (a proxy for
// "is there a major eruption putting aerosol in the stratosphere right now").
//
//   node ground-truth/volcano-collect.js record
//   node ground-truth/volcano-collect.js report --days=30
//
// JW asked (2026-11-08) whether an eruption somewhere could be making local
// sunsets more vivid. Real effect: stratospheric sulfate aerosol from a big
// eruption boosts sunset/sunrise color globally for weeks to months. The
// Smithsonian's Global Volcanism Program is the standard source for "what's
// erupting," but volcano.si.edu is behind a Cloudflare bot challenge and
// couldn't be fetched programmatically in this pass. aviationweather.gov's
// international SIGMET feed is a usable proxy instead: VAACs worldwide issue
// a volcanic-ash SIGMET for any eruption putting ash/SO2 into the air lanes,
// so "any VA hazard active" is a reasonable "is something erupting enough to
// matter" flag, even though it's built for aviation (ash plume extent), not
// stratospheric aerosol loading specifically — a big eruption without
// enough ash to trigger an aviation SIGMET could still matter for sunsets,
// and this would miss it. Treat this as a coarse flag, not a measurement.
const { q, n, sql, rows } = require('./db');

const UA = 'skymagic.app/1.0 ground-truth research (jw@earlyasset.com)';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS volcano_obs (
  fetched_ms  INTEGER NOT NULL,
  advisory_id TEXT    NOT NULL,  -- firId + seriesId, de-dupes repeats of the same SIGMET
  qualifier   TEXT,              -- e.g. "ERUPTION MT DUKONO"
  valid_from  INTEGER,
  valid_to    INTEGER,
  raw         TEXT,
  PRIMARY KEY (advisory_id, valid_from)
);
`;

async function record() {
  sql(SCHEMA);
  const res = await fetch('https://aviationweather.gov/api/data/isigmet?format=json', { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const all = await res.json();
  const ash = all.filter(x => x.hazard === 'VA');
  const fetchedMs = Date.now();
  let added = 0;
  for (const a of ash) {
    const advisoryId = `${a.firId || a.icaoId}-${a.seriesId}`;
    const validFrom = (a.validTimeFrom || 0) * 1000;
    const existing = rows(`SELECT 1 FROM volcano_obs WHERE advisory_id=${q(advisoryId)} AND valid_from=${n(validFrom)}`);
    if (existing.length) continue;
    sql(
      `INSERT INTO volcano_obs (fetched_ms, advisory_id, qualifier, valid_from, valid_to, raw) VALUES (` +
      [n(fetchedMs), q(advisoryId), q(a.qualifier), n(validFrom), n((a.validTimeTo || 0) * 1000), q(a.rawSigmet)].join(', ') +
      `);`
    );
    added++;
  }
  console.log(`${new Date(fetchedMs).toISOString()} · ${ash.length} active volcanic-ash advisor${ash.length === 1 ? 'y' : 'ies'} worldwide (${added} new)`);
  for (const a of ash) console.log(`  ${a.qualifier} (${a.firName || a.firId})`);
}

function report(opts) {
  const since = Date.now() - (opts.days || 30) * 86400000;
  const obs = rows(`SELECT fetched_ms, qualifier, valid_from FROM volcano_obs WHERE valid_from > ${n(since)} ORDER BY valid_from`);
  if (!obs.length) return console.log(`No volcanic-ash advisories logged in the last ${opts.days || 30} day(s).`);
  console.log(`\nVolcanic-ash advisories, last ${opts.days || 30}d — ${obs.length}\n`);
  for (const o of obs) console.log(`  ${new Date(o.valid_from).toISOString().slice(0, 16)}  ${o.qualifier}`);
}

const cmd = process.argv[2] || 'record';
const opts = {};
for (let i = 3; i < process.argv.length; i++) {
  const m = process.argv[i].match(/^--([^=]+)=(.*)$/);
  if (m) opts[m[1]] = /^\d+$/.test(m[2]) ? +m[2] : m[2];
}
if (cmd === 'record') record().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
else if (cmd === 'report') report(opts);
else { console.error(`Unknown command '${cmd}'. Use: record | report`); process.exit(1); }
