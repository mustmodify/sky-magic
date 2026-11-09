#!/usr/bin/env node
// Ground truth, source: NC State Climate Office's CLOUDS API
// (api.climate.ncsu.edu) — covers ECONet, RAWS, COOP, ASOS/AWOS and USCRN
// through one unified hash, found via the Cardinal Station Scout tool.
//
//   node ground-truth/mitc-collect.js record
//   node ground-truth/mitc-collect.js report --location=MITC --days=3
//
// LOCATIONS, found via Cardinal Scout centered on Craggy (2026-11-09),
// filtered to hourly-or-better cadence (COOP stations are daily-only —
// North Fork 2 and the old "Mt Mitchell" COOP site were skipped for that
// reason, even though both are close):
//   MITC  (ECONet) Mount Mitchell State Park, 1894m/6215ft, 1-min cadence,
//         ~1km from this project's own verified `mitchell` coordinate —
//         by far the best match found this session.
//   BSKN7 (RAWS)   Busick, 927m/3041ft, hourly, 9.3mi from Craggy — resolves
//         the RAWS dead-end from 2026-11-08 (raws.dri.edu/wrcc.dri.edu were
//         both unreachable; this is the same data through a working channel).
//
// REQUIRES a personal NCSCO API hash — sign up free at
// https://accounts.climate.ncsu.edu, then set FF_CLOUDS_API_HASH in .env
// (or a bare .clouds-api-hash file, same fallback pattern as
// .openweather-key). The hash is tied to one person per the API's own
// terms ("may NOT be shared with other users") so this can't be set up on
// JW's behalf.
//
// Live-tested 2026-11-09 (JW's own hash) against both locations.
// body.data.<LOCATION> is an object keyed by "YYYY-MM-DD HH:MM:SS"
// (local/Eastern), each holding {airtemp2m: {value: "45.9", unit, score},
// dewtemp2m: {...}, rh2m: {...}} — all values are strings.
const fs = require('fs');
const path = require('path');
const { q, n, sql, rows } = require('./db');

function envVal(...names) {
  for (const k of names) if (process.env[k]) return process.env[k].trim();
  try {
    const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
    for (const k of names) {
      const m = env.match(new RegExp('^\\s*(?:export\\s+)?' + k + '\\s*=\\s*["\']?([^"\'\\r\\n]+)', 'm'));
      if (m) return m[1].trim();
    }
  } catch {}
  return null;
}

function hashFromFile() {
  try { return fs.readFileSync(path.join(__dirname, '..', '.clouds-api-hash'), 'utf8').trim() || null; }
  catch { return null; }
}

const HASH = envVal('FF_CLOUDS_API_HASH') || hashFromFile();
const LOCATIONS = (process.env.FF_CLOUDS_API_LOCATIONS || 'MITC,BSKN7').split(',');
const VARS = 'airtemp2m,dewtemp2m,rh2m';
const BASE = 'https://api.climate.ncsu.edu/data';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS clouds_api_obs (
  location    TEXT    NOT NULL,
  obs_ms      INTEGER NOT NULL,
  fetched_ms  INTEGER NOT NULL,
  temp_f      REAL,
  dewpoint_f  REAL,
  humidity    REAL,
  raw         TEXT,
  PRIMARY KEY (location, obs_ms)
);
`;

// One-time migration: the original table (pre-2026-11-09, MITC-only) was
// named mitc_obs with no location column. Rebuild rather than ALTER.
function migrate() {
  const exists = rows(`SELECT name FROM sqlite_master WHERE type='table' AND name='mitc_obs'`);
  if (!exists.length) return;
  sql(`
    INSERT OR IGNORE INTO clouds_api_obs (location, obs_ms, fetched_ms, temp_f, dewpoint_f, humidity, raw)
      SELECT 'MITC', obs_ms, fetched_ms, temp_f, dewpoint_f, humidity, raw FROM mitc_obs;
    DROP TABLE mitc_obs;
  `);
  console.log('migrated mitc_obs into clouds_api_obs (tagged MITC)');
}

function buildUrl(location, { start, end, obtype }) {
  const params = new URLSearchParams({
    hash: HASH,
    loc: `location=${location}`,
    var: VARS,
    start, end,
    obtype: obtype || 'H,O',
    output: 'json',
  });
  return `${BASE}?${params.toString()}`;
}

// DST in the US: second Sunday of March through first Sunday of November.
// Same hand-written rule as webcam-collect.js (no Intl/tz-database dependency).
function isDST(y, mo, d) {
  if (mo < 3 || mo > 11) return false;
  if (mo > 3 && mo < 11) return true;
  const firstOfMonth = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay();
  if (mo === 3) { const secondSunday = 1 + ((7 - firstOfMonth) % 7) + 7; return d >= secondSunday; }
  const firstSunday = 1 + ((7 - firstOfMonth) % 7);
  return d < firstSunday;
}

// "2026-11-08 17:01:00" — local to the station (US/Eastern, confirmed live
// 2026-11-09: values matched the request's own local time window).
function easternToUtcMs(datetimeStr) {
  const m = datetimeStr.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  const offsetH = isDST(y, mo, d) ? 4 : 5;
  return Date.UTC(y, mo - 1, d, h + offsetH, mi, s);
}

async function recordLocation(location) {
  // Busick (RAWS, hourly) needs a wider window than MITC (ECONet, 1-min) to
  // reliably catch at least one reading per run.
  const start = location === 'MITC' ? '3 hours ago' : '12 hours ago';
  const url = buildUrl(location, { start, end: 'now' });
  const res = await fetch(url, { headers: { 'User-Agent': 'skymagic.app/1.0 ground-truth research (jw@earlyasset.com)' } });
  if (!res.ok) throw new Error(`${location}: HTTP ${res.status}: ${await res.text()}`);
  const body = await res.json();

  const byTime = body.data?.[location];
  if (!byTime || typeof byTime !== 'object') {
    console.error(`${location}: unexpected response shape — raw body follows for debugging:`);
    console.error(JSON.stringify(body, null, 2).slice(0, 2000));
    return;
  }

  const fetchedMs = Date.now();
  let inserted = 0, seen = 0;
  for (const [timeStr, vars] of Object.entries(byTime)) {
    const obsMs = easternToUtcMs(timeStr);
    if (!obsMs) continue;
    seen++;
    const tempF = vars.airtemp2m?.value != null ? parseFloat(vars.airtemp2m.value) : null;
    const dewF = vars.dewtemp2m?.value != null ? parseFloat(vars.dewtemp2m.value) : null;
    const rh = vars.rh2m?.value != null ? parseFloat(vars.rh2m.value) : null;
    const before = rows(`SELECT COUNT(*) c FROM clouds_api_obs WHERE location=${q(location)} AND obs_ms=${n(obsMs)}`)[0].c;
    sql(
      `INSERT OR IGNORE INTO clouds_api_obs (location, obs_ms, fetched_ms, temp_f, dewpoint_f, humidity, raw) VALUES (` +
      [q(location), n(obsMs), n(fetchedMs), n(tempF), n(dewF), n(rh), q(JSON.stringify(vars))].join(', ') +
      `);`
    );
    if (!before) inserted++;
  }
  console.log(`${location}: ${seen} readings seen, ${inserted} new`);
}

async function record() {
  if (!HASH) {
    console.error('FF_CLOUDS_API_HASH not set. Add FF_CLOUDS_API_HASH=... to .env or .clouds-api-hash before running this.');
    process.exitCode = 1;
    return;
  }
  sql(SCHEMA);
  migrate();
  for (const location of LOCATIONS) {
    try { await recordLocation(location); }
    catch (err) { console.error(err.message); }
  }
}

function report(opts) {
  const location = opts.location || LOCATIONS[0];
  const since = Date.now() - (opts.days || 3) * 86400000;
  const obs = rows(`SELECT obs_ms, temp_f, dewpoint_f, humidity FROM clouds_api_obs WHERE location=${q(location)} AND obs_ms > ${n(since)} ORDER BY obs_ms`);
  if (!obs.length) return console.log(`No ${location} rows in the last ${opts.days || 3} day(s). Run 'record' first.`);
  console.log(`\n${location} — ${obs.length} observations\n`);
  for (const o of obs) {
    const spread = o.dewpoint_f != null ? (o.temp_f - o.dewpoint_f).toFixed(1) : '?';
    console.log(`  ${new Date(o.obs_ms).toISOString().slice(0, 16)}  temp=${o.temp_f}F  dewpoint=${o.dewpoint_f}F  spread=${spread}F  rh=${o.humidity}%`);
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
