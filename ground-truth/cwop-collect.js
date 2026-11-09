#!/usr/bin/env node
// Ground truth, source: CWOP personal weather stations, as an elevation-matched
// dew-point/fog proxy — NOT a sky/cloud-cover source (CWOP's APRS weather
// format has no cloud field at all). See ../docs/ground-truth-data-plan-2026-11-08.md
// and the "cwop-stations" memory for why this was built instead of a full
// per-state scrape: FW8293 (Crooked Creek, 1663m) and FW8600 (Sugar Hill FD,
// 1545m) are the two CWOP stations found near Mitchell/Craggy/Green Knob that
// are actually close in ELEVATION to the real sites (1499-2014m) — everything
// else nearby, including the existing METAR stations (KAVL 646m, KTNB 957m),
// sits 1500+ ft below them. Feeds the same question as `detectNoGo`'s
// "Possibly in cloud at the summit" check (server.js, 2026-10-16): dew-point
// spread near 0 means fog/cloud at the station's own elevation.
//
//   node ground-truth/cwop-collect.js record
//   node ground-truth/cwop-collect.js report --station=FW8293 --days=3
//
// Source: findU.com's rawposit.cgi, which mirrors live APRS-IS weather
// packets for a CWOP callsign as plain text lines, e.g.:
//   FW8293>APRS,TCPXX*,qAX,CWOP-7:@080000z3534.46N/08211.19W_000/000g000t049r000p000P000h86b10179L....DsWLL
// Format (standard APRS weather report): @DDHHMMz (UTC day/hour/min, no
// month/year — inferred against the current date), lat/lon in APRS DDMM.mm,
// _WDIR/WSPDgGUSTtTEMPrRAIN1hpRAIN24hPRAINmidnighthHUMbBARO(x10 mb).
const { q, n, sql, rows } = require('./db');

const STATIONS = (process.env.FF_CWOP_STATIONS || 'FW8293,FW8600').split(',');
const STATION_NOTES = {
  FW8293: 'Crooked Creek, 1663m/5456ft — 16km from Green Knob',
  FW8600: 'Sugar Hill FD 2, 1545m/5069ft — 17km from Green Knob',
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cwop_obs (
  station     TEXT    NOT NULL,
  obs_ms      INTEGER NOT NULL,
  fetched_ms  INTEGER NOT NULL,
  temp_f      REAL,
  humidity    REAL,
  dewpoint_f  REAL,     -- computed (Magnus formula), CWOP doesn't report it directly
  wind_dir    INTEGER,
  wind_mph    REAL,
  gust_mph    REAL,
  baro_mb     REAL,
  raw         TEXT,
  PRIMARY KEY (station, obs_ms)
);
`;

// Magnus-Tetens approximation, same form used elsewhere for dew-point spread checks.
function dewPointF(tempF, humidityPct) {
  if (tempF == null || humidityPct == null || humidityPct <= 0) return null;
  const tempC = (tempF - 32) * 5 / 9;
  const a = 17.625, bC = 243.04;
  const gamma = Math.log(humidityPct / 100) + (a * tempC) / (bC + tempC);
  const dewC = (bC * gamma) / (a - gamma);
  return dewC * 9 / 5 + 32;
}

// @DDHHMMz has no month/year. If the packet's day is more than 2 days ahead
// of today (UTC), it must be from last month (e.g. today is the 2nd, packet
// day is 30/31); otherwise assume the current month.
function resolveObsMs(day, hour, min, nowMs) {
  const now = new Date(nowMs);
  let year = now.getUTCFullYear(), month = now.getUTCMonth();
  if (day > now.getUTCDate() + 2) {
    month -= 1;
    if (month < 0) { month = 11; year -= 1; }
  }
  return Date.UTC(year, month, day, hour, min, 0);
}

function parsePacket(line, nowMs) {
  const m = line.trim().match(/^([A-Z0-9\-]+)>APRS.*?:@(\d{2})(\d{2})(\d{2})z.*?_(\d{3})\/(\d{3})g(\d{3})t(-?\d{3})r(\d{3})p(\d{3})P(\d{3})h(\d{2})b(\d{5})/);
  if (!m) return null;
  const [, station, dd, hh, mm, wdir, wspd, gust, temp, , , , hum, baro] = m;
  const obsMs = resolveObsMs(+dd, +hh, +mm, nowMs);
  const tempF = +temp;
  const humidity = +hum === 0 ? 100 : +hum; // APRS encodes 100% as "00"
  return {
    station, obsMs,
    tempF, humidity,
    dewpointF: dewPointF(tempF, humidity),
    windDir: +wdir, windMph: +wspd, gustMph: +gust,
    baroMb: (+baro) / 10,
    raw: line.trim(),
  };
}

async function fetchStation(id) {
  const url = `http://www.findu.com/cgi-bin/rawposit.cgi?call=${encodeURIComponent(id)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'skymagic.app/1.0 ground-truth research (jw@earlyasset.com)' } });
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`);
  const text = await res.text();
  const nowMs = Date.now();
  return text.split('<br>').map(l => parsePacket(l, nowMs)).filter(Boolean).filter(p => p.station === id);
}

async function record() {
  sql(SCHEMA);
  const fetchedMs = Date.now();
  let totalNew = 0;
  for (const id of STATIONS) {
    let packets;
    try { packets = await fetchStation(id); }
    catch (err) { console.error(`${id}: ${err.message}`); continue; }
    if (!packets.length) { console.log(`${id}: no observations returned`); continue; }
    let inserted = 0;
    for (const p of packets) {
      const before = rows(`SELECT COUNT(*) c FROM cwop_obs WHERE station=${q(p.station)} AND obs_ms=${n(p.obsMs)}`)[0].c;
      sql(
        `INSERT OR IGNORE INTO cwop_obs (station, obs_ms, fetched_ms, temp_f, humidity, dewpoint_f, wind_dir, wind_mph, gust_mph, baro_mb, raw) VALUES (` +
        [q(p.station), n(p.obsMs), n(fetchedMs), n(p.tempF), n(p.humidity), n(p.dewpointF), n(p.windDir), n(p.windMph), n(p.gustMph), n(p.baroMb), q(p.raw)].join(', ') +
        `);`
      );
      if (!before) inserted++;
    }
    totalNew += inserted;
    const latest = packets[packets.length - 1];
    console.log(`${id} (${STATION_NOTES[id] || ''}): ${packets.length} packets seen, ${inserted} new. Latest: temp=${latest.tempF}F dewpoint=${latest.dewpointF?.toFixed(1)}F spread=${(latest.tempF - latest.dewpointF).toFixed(1)}F at ${new Date(latest.obsMs).toISOString()}`);
  }
  console.log(`${new Date(fetchedMs).toISOString()} · ${totalNew} new observation(s) across ${STATIONS.length} station(s)`);
}

function report(opts) {
  const station = opts.station || STATIONS[0];
  const since = Date.now() - (opts.days || 3) * 86400000;
  const obs = rows(`SELECT obs_ms, temp_f, humidity, dewpoint_f, wind_dir, wind_mph FROM cwop_obs WHERE station=${q(station)} AND obs_ms > ${n(since)} ORDER BY obs_ms`);
  if (!obs.length) return console.log(`No CWOP rows for ${station} in the last ${opts.days || 3} day(s). Run 'record' first.`);
  console.log(`\n${station} (${STATION_NOTES[station] || ''}) — ${obs.length} observations\n`);
  for (const o of obs) {
    const spread = o.dewpoint_f != null ? (o.temp_f - o.dewpoint_f).toFixed(1) : '?';
    console.log(`  ${new Date(o.obs_ms).toISOString().slice(0, 16)}  temp=${o.temp_f}F  dewpoint=${o.dewpoint_f?.toFixed(1) ?? '?'}F  spread=${spread}F  wind=${o.wind_dir}@${o.wind_mph}mph`);
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
