#!/usr/bin/env node
// Run the horizon probe across every candidate site and emit a markup sheet.
// The probe can only ever VETO a direction (see HISTORY.md 2026-09-03 and
// 2026-09-07), so the output leaves JW's facing column blank and fills in only
// what terrain rules out. Slow on purpose: the elevation API is free and rate
// limited, and this is a one-off.
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');

const rows = fs.readFileSync(path.join(__dirname, 'candidate-sites.tsv'), 'utf8')
  .split('\n').filter(l => l && !l.startsWith('#') && !l.startsWith('name\t'))
  .map(l => { const [name, lat, lon, ele] = l.split('\t'); return { name, lat: +lat, lon: +lon, ele }; });

const only = process.argv.includes('--only') ? +process.argv[process.argv.indexOf('--only') + 1] : rows.length;
const out = [];
for (const r of rows.slice(0, only)) {
  process.stderr.write(`probing ${r.name}\n`);
  try {
    const j = JSON.parse(execFileSync('node', [path.join(__dirname, 'horizon.js'),
      '--site', r.name, '--lat', String(r.lat), '--lon', String(r.lon),
      '--min-miles', '1.0', '--json'], { encoding: 'utf8', maxBuffer: 1 << 24 }))[0];
    // Keep the three seasons separately. Collapsing them to a worst case turned
    // Tanbark Ridge — wide open in December, blocked only on the June bearing —
    // into "ruled out for sunrise", contradicting NPS for no reason. The sun
    // moves ~60 degrees along the horizon through the year; one number per
    // direction cannot represent that.
    const seas = (d, k) => j.directions[d].seasons[k];
    out.push({ ...r, demM: j.elevationM,
      sunrise: j.directions.sunrise.verdict, sunriseDeg: j.directions.sunrise.worstDeg,
      sunset: j.directions.sunset.verdict,   sunsetDeg: j.directions.sunset.worstDeg,
      srW: seas('sunrise','winter').horizonAngleDeg, srE: seas('sunrise','equinox').horizonAngleDeg, srS: seas('sunrise','summer').horizonAngleDeg,
      ssW: seas('sunset','winter').horizonAngleDeg,  ssE: seas('sunset','equinox').horizonAngleDeg,  ssS: seas('sunset','summer').horizonAngleDeg });
  } catch (e) {
    process.stderr.write(`  FAILED: ${String(e.message).slice(0, 120)}\n`);
    out.push({ ...r, error: true });
  }
}

const md = ['# Candidate sites — terrain screen',
  '',
  'Coordinates from OpenStreetMap, cross-checked against published elevations.',
  'The `terrain` columns are a DEM screen and read in ONE direction only: a',
  'BLOCKED verdict means real rock was found and is trustworthy; "wide open"',
  'only means no distant ridge, and cannot see near hills, trees or buildings.',
  'It rules spots out. It never rules one in.',
  '',
  'JW: fill in the two facing columns. Strike any spot you would not send',
  'someone to. Add the Craggy roadside pull-off, which is not mapped.',
  '',
  'Angles are degrees of terrain above level on the solar bearing for that date.',
  'Negative means the land falls away. Roughly: under 1 open, 1-3 raised, 3-5',
  'partly blocked, over 5 gone. The sun tracks ~60 degrees along the horizon',
  'through the year, so a spot can be open in December and walled off in June —',
  'read the season columns, not a single verdict.',
  '',
  '| spot | lat | lon | DEM m | sunrise Dec / Equ / Jun | sunset Dec / Equ / Jun | JW: sunrise? | JW: sunset? |',
  '|---|---|---|---|---|---|---|---|'];
for (const r of out) {
  md.push(r.error
    ? `| ${r.name} | ${r.lat} | ${r.lon} | — | probe failed | probe failed | | |`
    : `| ${r.name} | ${r.lat} | ${r.lon} | ${Math.round(r.demM)} | ${r.srW} / ${r.srE} / ${r.srS} | ${r.ssW} / ${r.ssE} / ${r.ssS} | | |`);
}
fs.writeFileSync(path.join(__dirname, 'candidate-screen.md'), md.join('\n') + '\n');
console.log(`wrote tools/candidate-screen.md — ${out.length} spots, ${out.filter(r => r.error).length} failed`);
