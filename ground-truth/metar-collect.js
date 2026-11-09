#!/usr/bin/env node
// Ground truth, source 1: METAR sky-condition layers (observed, not modeled).
//
//   node ground-truth/metar-collect.js record            poll configured stations once
//   node ground-truth/metar-collect.js report --station=KAVL --days=3
//
// Why: aviationweather.gov reports actual observed sky layers (FEW/SCT/BKN/OVC
// + base height), which is a direct read of "is this deck broken or solid" —
// the exact thing every forecast leaf in server.js can only infer from areal
// coverage %. See docs/ground-truth-data-plan-2026-11-08.md.
//
// KAVL (Asheville Regional, 646 ft elevation) is the only usable station —
// JW's own point: it's a different microclimate from any real site (all
// 1500ft+ higher), so this is NOT wired into scoring. Its purpose for now is
// (a) a logged side-by-side comparison against what the model said for the
// same hours, and (b) the calibration target for the GOES/webcam texture
// collectors — see goes-collect.js.
const { q, n, sql, rows } = require('./db');

// KAVL (Asheville Regional, 2120 ft) is the baseline. KTNB (Boone/Watauga Med
// Center, ~3140 ft) added 2026-11-08 — JW flagged Avery County's 7A8 (no
// onsite AWOS, checked and ruled out) which led to this one via its "nearby
// stations" listing; still 2000+ ft below the real sites but closer than
// KAVL, worth collecting side by side rather than swapping.
const STATIONS = (process.env.FF_METAR_STATIONS || 'KAVL,KTNB').split(',');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS metar_obs (
  station     TEXT    NOT NULL,
  obs_ms      INTEGER NOT NULL,  -- obsTime from the API, already UTC
  fetched_ms  INTEGER NOT NULL,
  temp_c      REAL,
  dewp_c      REAL,
  wind_dir    INTEGER,
  wind_kt     INTEGER,
  visib       TEXT,
  cover       TEXT,              -- overall sky cover code (CLR/FEW/SCT/BKN/OVC/VV)
  clouds_json TEXT,              -- [{cover, base_ft}, ...] per layer, as reported
  flight_cat  TEXT,
  raw         TEXT,
  PRIMARY KEY (station, obs_ms)
);
`;

async function fetchStation(id) {
  const url = `https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(id)}&format=json`;
  const res = await fetch(url, { headers: { 'User-Agent': 'skymagic.app/1.0 ground-truth research (jw@earlyasset.com)' } });
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`);
  const body = await res.json();
  return body[0] || null;
}

async function record() {
  sql(SCHEMA);
  const fetchedMs = Date.now();
  let inserted = 0, seen = 0;
  for (const id of STATIONS) {
    let obs;
    try { obs = await fetchStation(id); }
    catch (err) { console.error(`${id}: ${err.message}`); continue; }
    if (!obs) { console.log(`${id}: no observation returned`); continue; }
    seen++;
    const obsMs = obs.obsTime * 1000;
    const clouds = JSON.stringify((obs.clouds || []).map(c => ({ cover: c.cover, base_ft: c.base ?? null })));
    sql(
      `INSERT OR IGNORE INTO metar_obs (station, obs_ms, fetched_ms, temp_c, dewp_c, wind_dir, wind_kt, visib, cover, clouds_json, flight_cat, raw) VALUES (` +
      [q(obs.icaoId), n(obsMs), n(fetchedMs), n(obs.temp), n(obs.dewp), n(obs.wdir), n(obs.wspd), q(obs.visib), q(obs.cover), q(clouds), q(obs.fltCat), q(obs.rawOb)].join(', ') +
      `);`
    );
    const already = rows(`SELECT COUNT(*) c FROM metar_obs WHERE station=${q(id)} AND obs_ms=${n(obsMs)}`)[0];
    inserted++;
    console.log(`${id}: obs ${new Date(obsMs).toISOString()} cover=${obs.cover ?? '(unreported)'} layers=${clouds} fltCat=${obs.fltCat ?? '(unreported)'}`);
  }
  console.log(`${new Date(fetchedMs).toISOString()} · ${seen} station(s) checked`);
}

function report(opts) {
  const station = opts.station || STATIONS[0];
  const since = Date.now() - (opts.days || 3) * 86400000;
  const obs = rows(`SELECT obs_ms, cover, clouds_json, flight_cat FROM metar_obs WHERE station=${q(station)} AND obs_ms > ${n(since)} ORDER BY obs_ms`);
  if (!obs.length) return console.log(`No METAR rows for ${station} in the last ${opts.days || 3} day(s). Run 'record' first.`);
  console.log(`\n${station} — ${obs.length} observations\n`);
  for (const o of obs) {
    const layers = JSON.parse(o.clouds_json || '[]').map(c => c.base_ft != null ? `${c.cover}@${c.base_ft}ft` : c.cover).join(' ') || '(clear)';
    console.log(`  ${new Date(o.obs_ms).toISOString().slice(0, 16)}  ${(o.cover || '?').padEnd(4)} ${(o.flight_cat || '?').padEnd(4)}  ${layers}`);
  }
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
