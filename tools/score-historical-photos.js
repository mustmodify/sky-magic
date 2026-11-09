#!/usr/bin/env node
// Runs JW's own calibration photos through the REAL scoring tree against
// REAL historical weather for each photo's exact date/time/location — not
// an approximation, not his caption. JW, 2026-11-09: "I wanted to see what
// the pictures I gave would actually score... You gave me this image. For
// that day and location, actual score was..."
//
//   node tools/score-historical-photos.js
//
// Writes results to tools/historical-photo-scores.json.
//
// Reuses the live scoring tree via server.js's exports (evalMetric,
// METRIC_TREE, at, localISOtoMs, clamp, gradeOf, MERGES, CONFIG) rather than
// reimplementing it, so a photo's computed grade is genuinely what the app
// would have said, not a hand-rolled approximation.
//
// Deliberately does NOT reuse server.js's own offsetPoint/sunBearing: those
// hardcode Date.now() for the day-of-year, correct for live forecasting
// within 72h but silently wrong for a photo from a different season or
// year. This script has its own date-parameterized versions instead.
//
// Known fidelity gaps, not fixable with free data: Open-Meteo's historical
// archive has no CAPE and no visibility (both return null for every hour,
// confirmed by a live check against 2024-03-03) — the CAPE-texture leaf and
// the visibility-based fog check both silently no-op (same null-drops-out
// behavior as a missing live data source). Cross-model consensus has no
// historical equivalent (there's no "the model said X three hours ago" for
// 2022) and PM2.5 needs a paid OpenWeather history tier, so both leaves/the
// consensus leaf read null too. AOD (historical aerosol optical depth) IS
// available and used.
const fs = require('fs');
const path = require('path');
const { CONFIG, evalMetric, METRIC_TREE, MERGES, at, clamp, gradeOf } = require('../server.js');

const PHOTOS_DIR = '/home/jw/projects/mustmodify/skymagic-calibration-photos';
const UA = 'skymagic.app/1.0 historical calibration scoring (jw@earlyasset.com)';
const MILES_PER_DEG_LAT = 69.05;
const MILES_PER_DEG_LON = lat => 69.17 * Math.cos(lat * Math.PI / 180);

// --- date-aware sun bearing (see header note) -------------------------------
function sunBearingForDate(dir, lat, dateMs) {
  const d = new Date(dateMs);
  const doy = Math.floor((dateMs - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000);
  const decl = 23.44 * Math.PI / 180 * Math.sin(2 * Math.PI * (284 + doy) / 365);
  const az = Math.acos(Math.sin(decl) / Math.cos(lat * Math.PI / 180));
  return dir === 'E' ? az : 2 * Math.PI - az;
}
function offsetPointForDate(site, miles, dir, dateMs) {
  const az = sunBearingForDate(dir, site.lat, dateMs);
  return {
    lat: +(site.lat + miles * Math.cos(az) / MILES_PER_DEG_LAT).toFixed(4),
    lon: +(site.lon + miles * Math.sin(az) / MILES_PER_DEG_LON(site.lat)).toFixed(4),
  };
}

// --- EXIF local-time -> UTC ms (US/Eastern, same hand-rolled DST rule used
// elsewhere in this project — ground-truth/webcam-collect.js, mitc-collect.js) --
function isDST(y, mo, d) {
  if (mo < 3 || mo > 11) return false;
  if (mo > 3 && mo < 11) return true;
  const firstOfMonth = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay();
  if (mo === 3) { const secondSunday = 1 + ((7 - firstOfMonth) % 7) + 7; return d >= secondSunday; }
  const firstSunday = 1 + ((7 - firstOfMonth) % 7);
  return d < firstSunday;
}
function exifToUtcMs(dt) {
  // "2024:03:03 18:40:05"
  const m = dt.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  const offsetH = isDST(y, mo, d) ? 4 : 5;
  return Date.UTC(y, mo - 1, d, h + offsetH, mi, s);
}

async function fetchJSON(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < 3) {
      const waitMs = 2000 * (attempt + 1);
      console.log(`\n  (429, backing off ${waitMs}ms)`);
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
}

function multiLocArchiveURL(base, points, params, dateStr) {
  const lats = points.map(p => p.lat).join(',');
  const lons = points.map(p => p.lon).join(',');
  return `${base}?latitude=${lats}&longitude=${lons}&start_date=${dateStr}&end_date=${dateStr}&${params}&timezone=America%2FNew_York`;
}

// Index a multi-location archive response the same shape server.js's
// indexPoints produces: { role: <single-location hourly result> }.
function indexByRole(points, locations) {
  const out = {};
  points.forEach((p, i) => { out[p.role] = locations[i]; });
  return out;
}

async function elevationsFor(coords) {
  if (!coords.length) return {};
  const lats = coords.map(c => c.lat).join(',');
  const lons = coords.map(c => c.lon).join(',');
  const d = await fetchJSON(`https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`);
  const out = {};
  coords.forEach((c, i) => { out[`${c.lat},${c.lon}`] = d.elevation[i]; });
  return out;
}

async function scorePhoto(photo, elevByCoord) {
  const ms = exifToUtcMs(photo.dt);
  if (!ms) return { file: photo.file, error: 'unparseable EXIF datetime' };
  const localHour = new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false });
  const dir = +localHour < 12 ? 'E' : 'W';
  const kind = dir === 'E' ? 'sunrise' : 'sunset';

  const configSite = ['mitchell', 'craggy', 'greenknob', 'home'].includes(photo.tag)
    ? CONFIG.sites.find(s => s.id === photo.tag) : null;
  const site = configSite || {
    id: `photo_${photo.file}`, name: `ad-hoc (${photo.lat.toFixed(4)},${photo.lon.toFixed(4)})`,
    lat: photo.lat, lon: photo.lon,
    elevM: elevByCoord[`${photo.lat},${photo.lon}`] ?? null,
    vantage: null, vantageNote: null, milepost: null,
  };

  const miles = [...CONFIG.cloudBands.mid, ...CONFIG.cloudBands.far, ...CONFIG.cloudSampleMiles];
  const wxPoints = [{ role: 'local', lat: site.lat, lon: site.lon }];
  for (const mi of miles) { const p = offsetPointForDate(site, mi, dir, ms); wxPoints.push({ role: dir + mi, lat: p.lat, lon: p.lon }); }
  const aqPoints = [{ role: 'local', lat: site.lat, lon: site.lon }];
  for (const mi of CONFIG.aodSampleMiles) { const p = offsetPointForDate(site, mi, dir, ms); aqPoints.push({ role: dir + mi, lat: p.lat, lon: p.lon }); }

  const dateStr = new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD
  const wxURL = multiLocArchiveURL('https://archive-api.open-meteo.com/v1/archive', wxPoints,
    'hourly=temperature_2m,relative_humidity_2m,dew_point_2m,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,pressure_msl,visibility,wind_speed_10m,precipitation,cape,direct_radiation,shortwave_radiation', dateStr);
  const aqURL = multiLocArchiveURL('https://air-quality-api.open-meteo.com/v1/air-quality', aqPoints, 'hourly=aerosol_optical_depth', dateStr);

  let wxLocs, aqLocs;
  try {
    [wxLocs, aqLocs] = await Promise.all([fetchJSON(wxURL), fetchJSON(aqURL)]);
  } catch (err) {
    return { file: photo.file, error: `fetch failed: ${err.message}` };
  }
  // Single-location responses come back as a plain object, not an array —
  // normalize both shapes to arrays so indexByRole always works.
  const wxArr = Array.isArray(wxLocs) ? wxLocs : [wxLocs];
  const aqArr = Array.isArray(aqLocs) ? aqLocs : [aqLocs];
  const points = indexByRole(wxPoints, wxArr);
  const aq = indexByRole(aqPoints, aqArr);

  const ctx = {
    site, wx: points.local, models: { hourly: { time: [] } }, points, aq,
    owm: null, dir, ms, now: ms, access: { status: 'unknown', label: 'N/A (historical)', sections: [], score: 2 },
    mergeOverrides: null,
  };
  const root = evalMetric(METRIC_TREE, ctx);
  const overall = +clamp(root.score ?? 0, 0, 4.3).toFixed(2);

  // Full tree, for the "how did we get here" modal on the audit page — JW,
  // 2026-11-09, looking at #135: "show me where we see 'near clouds' and
  // 'mid clouds' and 'far clouds'" (those are depth 3, under Clouds > Distance
  // bands; the original two-level cut didn't go deep enough).
  const shallow = n => ({ key: n.key, name: n.name, score: n.score, grade: n.grade, value: n.value, weight: n.weight, children: (n.children || []).map(shallow) });
  return {
    file: photo.file, dt: photo.dt, kind, site: site.id, siteLabel: site.name,
    lat: site.lat, lon: site.lon, caption: photo.caption || null,
    overall, grade: gradeOf(overall),
    metrics: root.children.map(shallow),
  };
}

async function main() {
  const limitArg = process.argv.find(a => a.startsWith('--limit='));
  const limit = limitArg ? +limitArg.split('=')[1] : Infinity;
  const retryFailed = process.argv.includes('--retry-failed');
  const outPath = path.join(__dirname, 'historical-photo-scores.json');

  const tagged = JSON.parse(fs.readFileSync(path.join(PHOTOS_DIR, 'tagged.json'), 'utf8'));
  let withGPS = tagged.filter(t => t.lat != null && t.lon != null && t.dt);
  console.log(`${tagged.length} total, ${withGPS.length} have GPS + timestamp.`);

  let existing = {};
  if (retryFailed) {
    const prev = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    existing = Object.fromEntries(prev.map(r => [r.file, r]));
    const failedFiles = new Set(prev.filter(r => r.error).map(r => r.file));
    withGPS = withGPS.filter(t => failedFiles.has(t.file));
    console.log(`--retry-failed: re-scoring ${withGPS.length} previously-failed photo(s) only, keeping the rest as-is.`);
  }
  if (limit < withGPS.length) { withGPS = withGPS.slice(0, limit); console.log(`--limit=${limit}: scoring first ${limit} only.`); }

  const adHoc = withGPS.filter(t => !['mitchell', 'craggy', 'greenknob', 'home'].includes(t.tag));
  const uniqueCoords = [...new Map(adHoc.map(t => [`${t.lat},${t.lon}`, { lat: t.lat, lon: t.lon }])).values()];
  console.log(`Looking up elevation for ${uniqueCoords.length} ad-hoc coordinates...`);
  const elevByCoord = await elevationsFor(uniqueCoords);

  let i = 0;
  for (const photo of withGPS) {
    i++;
    process.stdout.write(`[${i}/${withGPS.length}] ${photo.file}... `);
    try {
      const r = await scorePhoto(photo, elevByCoord);
      existing[photo.file] = r;
      console.log(r.error ? `ERROR: ${r.error}` : `${r.grade} (${r.overall})`);
    } catch (err) {
      existing[photo.file] = { file: photo.file, error: err.message };
      console.log(`ERROR: ${err.message}`);
    }
    // Be polite to the free tier — this project got burned by a bulk sweep
    // exhausting the shared Open-Meteo quota once already (CLAUDE.md, "The
    // free tier is shared"), and a second back-to-back full run of this
    // script hit 429s on roughly a fifth of requests (2026-11-09) — longer
    // gap now, plus retry-with-backoff in fetchJSON above.
    await new Promise(r => setTimeout(r, 700));
  }

  const results = Object.values(existing);
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  const ok = results.filter(r => !r.error);
  console.log(`\nDone. ${ok.length}/${results.length} scored successfully. Written to ${outPath}`);
}

main().catch(err => { console.error(err); process.exit(1); });
