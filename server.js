#!/usr/bin/env node
// SkyMagic (skymagic.app) — sunrise/sunset photography opportunity dashboard.
// No dependencies; Node 18+ (built-in fetch). Run: node server.js  → http://localhost:5813

const http = require('http');
const fs = require('fs');
const path = require('path');
const groundTruth = require('./ground-truth/api.js');

// ---------------------------------------------------------------------------
// Config — every duration is data, not hardcoded math, so updating one number
// recalculates every departure time.
// ---------------------------------------------------------------------------
const CONFIG = {
  port: +(process.env.FF_PORT || 5813),
  timezone: 'America/New_York',
  homeName: '26 Checkerberry Court',
  horizonHours: 72,
  cacheMinutes: 15,
  prep: {
    wakeMin: 20,          // wake up, get dressed
    packMin: 30,          // breakfast, camera bags, batteries
    setupMin: 5,          // tripod, filters, framing at the spot
    photoLeadMin: 20,     // be shooting 20 min BEFORE the event — both sides of it
    sunsetBufferMin: 15,  // extra buffer added to sunset departures
  },
  // Where the visitor gets ON the Parkway. This is not cosmetic: siteAccess()
  // only counts NPS closures lying BETWEEN the entry and the site, so the entry
  // decides the verdict. The Helene closure at MP 344.2-355.3 is why Green Knob
  // (MP 350.4) reads F from Ox Creek; enter north of it and the same evening
  // reads open. A wrong default therefore produces a confidently wrong F, or a
  // confidently wrong green light, which is worse.
  //
  // Mileposts are from the NPS/RomanticAsheville tables and are reliable.
  // Coordinates are approximate junction positions, carried for the routing leg
  // in wi-1476 and not used by any scoring path today.
  accessPoints: [
    { id: 'oxcreek', name: 'Ox Creek Rd (Bull Gap)',           milepost: 375.7, lat: 35.6663, lon: -82.4569 },
    { id: 'us70',    name: 'US 70 (Folk Art Center)',          milepost: 382.0, lat: 35.5852, lon: -82.4708 },
    { id: 'brpvc',   name: 'Parkway Visitor Center',           milepost: 384.0, lat: 35.5789, lon: -82.4617 },
    { id: 'us74a',   name: 'US 74A',                           milepost: 384.7, lat: 35.5726, lon: -82.4589 },
    { id: 'us25',    name: 'US 25 (Hendersonville Rd)',        milepost: 388.8, lat: 35.5254, lon: -82.4790 },
    { id: 'nc191',   name: 'NC 191 (Brevard Rd)',              milepost: 393.6, lat: 35.5033, lon: -82.5570 },
  ],
  // US 70 is the most-used Asheville entrance. It is only a fallback for a
  // visitor who has not chosen yet — the UI asks, because guessing someone's
  // gate silently is exactly how the wrong F gets served.
  defaultAccessPoint: 'us70',
  // horizon (advisory metadata, NOT scored): worst-case terrain elevation angle
  // in degrees along the sunrise and sunset bearings, from tools/horizon.js —
  // regenerate with `node tools/horizon.js --min-miles 1.0 --json`. Negative
  // means the land falls away. Read it asymmetrically: a BLOCKED reading is
  // trustworthy because the DEM found real rock, but a low number only means
  // "no distant ridge" — samples inside 1 mi are discarded as unusable (see
  // HISTORY.md 2026-09-03), so near hills, trees and buildings are invisible.
  sites: [
    // vantage (0–4, static): how much of the good sky the spot can actually
    // see — sunrise/sunset color lives in the lowest degrees of sky, so an
    // obstructed horizon loses the show even when the sky delivers.
    { id: 'mitchell',  name: 'Mount Mitchell (Summit Lot)', lat: 35.7649, lon: -82.2653, elevM: 2014, travelMin: 51, hikeMin: 15, hikeNote: 'paved walk to summit platform', milepost: 355.3, vantage: 4,   vantageNote: 'summit platform, open panorama', horizon: { sunrise: -1.7, sunset: -1.7, note: 'terrain open both ways' } },
    { id: 'craggy',    name: 'Craggy Pinnacle',             lat: 35.7050, lon: -82.3730, elevM: 1766, travelMin: 33, hikeMin: 20, hikeNote: '~0.7 mi each way',            milepost: 364.1, vantage: 4,   vantageNote: '360° bald summit', horizon: { sunrise: 0.0, sunset: -0.8, note: 'terrain open both ways; probed at the OSM summit 35.70345,-82.37790 — this lat/lon is 475 m off it' } },
    { id: 'greenknob', name: 'Green Knob Overlook',         lat: 35.717640, lon: -82.222689, elevM: 1499, travelMin: 88, hikeMin: 0,  hikeNote: 'right at the overlook',       milepost: 350.4, vantage: 3.5, vantageNote: 'open overlook, one direction', horizon: { sunrise: -1.3, sunset: 1.9, note: 'JW: best sunrise photos he has taken. East falls away; the Black Mountains raise the west ~1.9°' } },
    // Calibration reference: score the view from the house to sanity-check tuning.
    // vantage null on purpose: Home is a calibration proxy — the question it
    // answers is "if this sky were at Craggy, would it score well?" — so it is
    // graded on sky alone, never penalized for rooftops.
    // 2026-10-22: lat/lon WAS 35.6919494,-82.5157887 — ~900 m from JW's actual
    // backyard (35.68826911411407,-82.52467580364578, confirmed via satellite,
    // within 1 m — see skymagic-calibration-photos/README.md). Same shape of
    // bug as Green Knob. JW's own call on it: the stored point was wrong but
    // "probably close enough for previous calibrations... the sky is probably
    // the same" — so, unlike Green Knob, the old photo-calibrated curves are
    // NOT being treated as invalidated by this move; only the coordinate (and
    // the horizon probe below, re-run against the corrected point) changed.
    { id: 'home',      name: 'Home (calibration)',          lat: 35.68826911411407, lon: -82.52467580364578, elevM: 678, travelMin: 0, hikeMin: 0, hikeNote: 'step outside', milepost: null, vantage: null, vantageNote: 'calibration proxy — sky only', calibration: true, horizon: { sunrise: 4.4, sunset: 0.8, note: 'DEM re-probed 2026-10-22 at the corrected coordinate: sunrise 3.7-5.2° BLOCKED across the solstice range (hill to the east, matches JW), sunset 0.6-1.1° wide open to slightly raised — both milder than the pre-fix single-value estimate; this field is advisory only, not wired into scoring' } },
  ],
  // Distances (miles) for horizon-cloud and AOD sampling, offset toward the sun
  // (east for sunrise, west for sunset).
  cloudSampleMiles: [35, 70],
  // Cloud distance bands, derived from frame geometry (15–20 mm full-frame,
  // ~65% sky, deck ~2 km above eye — calibration photo 2026-07-28): the top
  // ~15–20% of sky is clouds within ~3 mi (the site's own grid cell); the
  // middle ~55% is ~2–9 mi; the far ~10–20% is ~9–24 mi. Below ~3° elevation
  // belongs to the Horizon metric. Multiple samples per band because HRRR
  // resolves ~1.9 mi cells — coverage is averaged across a band's samples
  // before scoring.
  cloudBands: { mid: [3, 5.5, 8], far: [12, 20] },
  aodSampleMiles: [40, 70],
  aodWeights: { local: 0.15, mid: 0.40, far: 0.45 }, // custom curve: low locally, peaks 40mi+, highest at 70mi
  // ECMWF/GFS: medium-range synoptic skill (coarse). HRRR: 3 km terrain
  // detail, ≤18–48 h. NBM: 2.5 km calibrated blend to ~10 days (the
  // finer-and-longer complement to HRRR). UKMO: independent dynamical core at
  // ~10 km — mid-range diversity between the global coarse pair and NBM.
  models: ['ecmwf_ifs025', 'gfs_seamless', 'gfs_hrrr', 'ncep_nbm_conus', 'ukmo_seamless'],
  modelLabels: { ecmwf_ifs025: 'ECMWF', gfs_seamless: 'GFS', gfs_hrrr: 'HRRR', ncep_nbm_conus: 'NBM', ukmo_seamless: 'UKMO' },
};

// Read a key from a real env var first, then from .env next to this script.
// Used for both the OpenWeather key and the FF_LOCAL private-mode flag.
function envVal(...names) {
  for (const k of names) if (process.env[k]) return process.env[k].trim();
  try {
    const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    for (const k of names) {
      const m = env.match(new RegExp('^\\s*(?:export\\s+)?' + k + '\\s*=\\s*["\']?([^"\'\\r\\n]+)', 'm'));
      if (m) return m[1].trim();
    }
  } catch {}
  return null;
}

// Private mode. The Home site is JW's back yard: it carries his coordinates,
// it is a calibration proxy rather than a place anyone can drive to, and its
// street address used to be printed on the dashboard. Public deployments must
// not see any of it, so LOCAL defaults to OFF and has to be switched on
// deliberately with FF_LOCAL=1 (env var or .env). Everything private is gated
// on this one flag rather than scattered per-field checks.
const LOCAL = /^(1|true|yes|on)$/i.test(envVal('FF_LOCAL') || '');

// Removed from the config, not merely hidden in the view: a public build never
// fetches weather for the house, never scores it, and cannot leak it through
// the HTML dashboard, the JSON:API or the MCP server, because it does not
// exist in any of them.
if (!LOCAL) CONFIG.sites = CONFIG.sites.filter(s => !s.calibration);

// OpenWeather Air Pollution API (optional). Key comes from an env var, from
// OPEN_WEATHER_KEY in a .env file, or from a bare .openweather-key file next to
// this script. Files are re-read on every cache refresh — no restart needed.
function owmKey() {
  const v = envVal('OPENWEATHER_API_KEY', 'OPEN_WEATHER_KEY');
  if (v) return v;
  try { return fs.readFileSync(path.join(__dirname, '.openweather-key'), 'utf8').trim() || null; }
  catch { return null; }
}

const MILES_PER_DEG_LON = lat => 69.17 * Math.cos(lat * Math.PI / 180);
const MILES_PER_DEG_LAT = 69.05;

// True bearing (radians from north) of sunrise ('E') / sunset ('W') for the
// current solar declination. At 35.7°N this swings ±~30° around due east/west
// through the year (late July: rise ≈ 63°, set ≈ 297°) — at 70 mi out, due
// east/west would miss the actual light path by ~30 mi at the solstices.
function sunBearing(dir, lat) {
  const doy = Math.floor((Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 0)) / 86400000);
  const decl = 23.44 * Math.PI / 180 * Math.sin(2 * Math.PI * (284 + doy) / 365);
  const az = Math.acos(Math.sin(decl) / Math.cos(lat * Math.PI / 180));
  return dir === 'E' ? az : 2 * Math.PI - az;
}
function offsetPoint(site, miles, dir) {
  const az = sunBearing(dir, site.lat);
  return {
    lat: +(site.lat + miles * Math.cos(az) / MILES_PER_DEG_LAT).toFixed(4),
    lon: +(site.lon + miles * Math.sin(az) / MILES_PER_DEG_LON(site.lat)).toFixed(4),
  };
}

// ---------------------------------------------------------------------------
// Data fetching (cached)
// ---------------------------------------------------------------------------
let cache = { at: 0, raw: null, building: null };
// Seeded from disk further down, once loadCache is defined.

// Retries on 429 and 5xx. Open-Meteo's free tier enforces a per-minute cap, and
// on 2026-09-07 a burst of unrelated elevation queries exhausted it and took the
// dashboard down with a bare error — one upstream hiccup should not do that.
async function getJSON(url, attempt = 0) {
  const retry = async why => {
    if (attempt >= 3) throw new Error(`${why} ${url}`);
    await new Promise(r => setTimeout(r, 1500 * Math.pow(2, attempt)));
    return getJSON(url, attempt + 1);
  };
  // A network-level failure (DNS, refused connection, timeout before headers)
  // throws out of fetch() itself rather than returning a bad status, so it
  // used to skip the retry logic entirely. On 2026-10-06 a ~16h host DNS
  // outage (EAI_AGAIN) crashed four consecutive history.js cron runs this way
  // — each one burned its 3 retries inside a single invocation and gave up,
  // rather than the kind of transient blip this retry is meant to absorb.
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': 'skymagic.app/1.0 (sunrise-sunset photography planner)' } });
  } catch (err) {
    return retry(err.message);
  }
  if (!res.ok) {
    if (res.status === 429 || res.status >= 500) return retry(res.status);
    throw new Error(`${res.status} ${url}`);
  }
  // A 200 carrying a non-JSON body is just as transient as a 503 and must be
  // retried too. On 2026-09-08 20:07 the upstream answered OK with an HTML
  // error page; the parse threw, no retry happened, and only the stale-cache
  // fallback kept the dashboard alive on a four-hour-old forecast.
  const body = await res.text();
  try { return JSON.parse(body); }
  catch { return retry(`non-JSON body (${body.slice(0, 40).replace(/\s+/g, ' ')})`); }
}

function multiLocationURL(base, points, params) {
  const lats = points.map(p => p.lat).join(',');
  const lons = points.map(p => p.lon).join(',');
  return `${base}?latitude=${lats}&longitude=${lons}&${params}&forecast_days=5&timezone=${encodeURIComponent(CONFIG.timezone)}`;
}

// Points per site: [site, E@35, E@70, W@35, W@70] for weather; AOD uses 40/70.
function buildPoints(miles) {
  const pts = [];
  for (const s of CONFIG.sites) {
    pts.push({ site: s.id, role: 'local', lat: s.lat, lon: s.lon });
    for (const dir of ['E', 'W']) {
      for (const mi of miles) {
        const p = offsetPoint(s, mi, dir);
        pts.push({ site: s.id, role: dir + mi, lat: p.lat, lon: p.lon });
      }
    }
  }
  return pts;
}

async function fetchAll() {
  const wxPoints = buildPoints([...CONFIG.cloudBands.mid, ...CONFIG.cloudBands.far, ...CONFIG.cloudSampleMiles]);
  const aqPoints = buildPoints(CONFIG.aodSampleMiles);

  const wxURL = multiLocationURL('https://api.open-meteo.com/v1/forecast', wxPoints,
    'hourly=temperature_2m,relative_humidity_2m,dew_point_2m,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,pressure_msl,visibility,wind_speed_10m,precipitation,cape,direct_radiation,shortwave_radiation' +
    '&daily=sunrise,sunset&wind_speed_unit=mph');
  const modelURL = multiLocationURL('https://api.open-meteo.com/v1/forecast',
    CONFIG.sites.map(s => ({ lat: s.lat, lon: s.lon })),
    `hourly=cloud_cover&models=${CONFIG.models.join(',')}`);
  const aqURL = multiLocationURL('https://air-quality-api.open-meteo.com/v1/air-quality', aqPoints,
    'hourly=aerosol_optical_depth');

  const key = owmKey();
  const owmPromise = !key ? Promise.resolve(null) : Promise.all(CONFIG.sites.map(s =>
    getJSON(`https://api.openweathermap.org/data/2.5/air_pollution/forecast?lat=${s.lat}&lon=${s.lon}&appid=${key}`)
      .then(r => [s.id, r]).catch(err => { console.error('OpenWeather:', err.message); return [s.id, null]; })
  )).then(Object.fromEntries);

  const [wx, models, aq, access, owm] = await Promise.all([
    getJSON(wxURL),
    getJSON(modelURL),
    getJSON(aqURL),
    fetchParkwayStatus().catch(err => ({ error: String(err) })),
    owmPromise,
  ]);
  return { wx: [].concat(wx), models: [].concat(models), aq: [].concat(aq), access, owm, wxPoints, aqPoints };
}

// Nearest OpenWeather forecast entry within 90 minutes of the event.
function owmAt(siteOwm, ms) {
  if (!siteOwm?.list?.length) return null;
  let best = null;
  for (const e of siteOwm.list) {
    const dt = Math.abs(e.dt * 1000 - ms);
    if (dt <= 90 * 60000 && (!best || dt < best.dt)) best = { dt, e };
  }
  return best?.e ?? null;
}

// --- Blue Ridge Parkway gate status -----------------------------------------
async function fetchParkwayStatus() {
  const res = await fetch('https://www.nps.gov/blri/planyourvisit/roadclosures.htm',
    { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)' } });
  if (!res.ok) throw new Error(`NPS page ${res.status}`);
  let text = (await res.text())
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');

  // Table rows read: "<from> - <to> <crossroads> <Status> <notes...>"
  const rowRe = /(\d{1,3}(?:\.\d)?)\s*-\s*(\d{1,3}(?:\.\d)?)\s+(.*?)\s+(Open|Closed|Ungated|Partial\s+[Cc]losure)\b/g;
  const rows = [];
  let m;
  while ((m = rowRe.exec(text)) !== null) {
    rows.push({ from: parseFloat(m[1]), to: parseFloat(m[2]), crossroads: m[3].slice(0, 120), status: m[4].replace(/\s+/g, ' '), noteStart: rowRe.lastIndex });
  }
  rows.forEach((r, i) => {
    const end = i + 1 < rows.length ? text.lastIndexOf(String(rows[i + 1].from), rows[i + 1].noteStart) : r.noteStart + 200;
    r.note = text.slice(r.noteStart, Math.max(r.noteStart, end)).trim().slice(0, 240);
  });
  return { rows, fetchedAt: new Date().toISOString(), source: 'https://www.nps.gov/blri/planyourvisit/roadclosures.htm' };
}

function resolveEntry(entryId) {
  return CONFIG.accessPoints.find(a => a.id === entryId)
      || CONFIG.accessPoints.find(a => a.id === CONFIG.defaultAccessPoint);
}

function siteAccess(site, access, entry) {
  if (site.milepost == null) {
    // Off-Parkway spots (Max Patch, Bearwallow, a rooftop) never touch the
    // Parkway closure table. They have their own gates and seasons, which this
    // function does not model.
    return { status: 'open', label: 'No Parkway drive needed', sections: [], score: 4 };
  }
  if (!access || access.error || !access.rows || !access.rows.length) {
    return { status: 'unknown', label: 'Unknown — check NPS site', sections: [], score: 2 };
  }
  const lo = Math.min(site.milepost, entry.milepost);
  const hi = Math.max(site.milepost, entry.milepost);
  // Sections overlapping the drive from the chosen entry to the site.
  const sections = access.rows.filter(r => Math.min(r.from, r.to) < hi - 0.05 && Math.max(r.from, r.to) > lo + 0.05);
  const worst = sections.reduce((w, r) => {
    const rank = /closed/i.test(r.status) && !/partial/i.test(r.status) ? 3 : /partial/i.test(r.status) ? 2 : 1;
    return rank > w.rank ? { rank, row: r } : w;
  }, { rank: 0, row: null });
  if (worst.rank >= 3) return { status: 'closed', label: `Closed: MP ${worst.row.from}–${worst.row.to}`, sections, score: 0, noGo: 'Parkway section closed en route' };
  if (worst.rank === 2) return { status: 'partial', label: `Partial closure: MP ${worst.row.from}–${worst.row.to}`, sections, score: 2 };
  if (worst.rank === 1) return { status: 'open', label: `Gates open ${entry.name} → site`, sections, score: 4 };
  return { status: 'unknown', label: 'Route not found in NPS table', sections, score: 2 };
}

// ---------------------------------------------------------------------------
// Time helpers — Open-Meteo returns local ISO strings without offset; convert
// using utc_offset_seconds so server TZ doesn't matter.
// ---------------------------------------------------------------------------
const localISOtoMs = (iso, offsetSec) => Date.parse(iso + 'Z') - offsetSec * 1000;
function hourIndex(loc, ms) {
  const first = localISOtoMs(loc.hourly.time[0], loc.utc_offset_seconds);
  const idx = Math.round((ms - first) / 3600000);
  return idx >= 0 && idx < loc.hourly.time.length ? idx : -1;
}
const at = (loc, key, ms) => { const i = hourIndex(loc, ms); return i < 0 ? null : loc.hourly[key]?.[i] ?? null; };

const fmtTime = ms => new Intl.DateTimeFormat('en-US', { timeZone: CONFIG.timezone, hour: 'numeric', minute: '2-digit' }).format(ms);
const fmtDay = ms => new Intl.DateTimeFormat('en-US', { timeZone: CONFIG.timezone, weekday: 'short', month: 'short', day: 'numeric' }).format(ms);

// ---------------------------------------------------------------------------
// Scoring — every metric returns 0..4. Overall = mean, forced to 0 on a no-go.
// ---------------------------------------------------------------------------
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (v, x0, y0, x1, y1) => y0 + (clamp(v, Math.min(x0, x1), Math.max(x0, x1)) - x0) * (y1 - y0) / (x1 - x0);

// 4 inside [idealLo, idealHi]; linear ramps to floor values outside.
function bandScore(v, idealLo, idealHi, { belowFloor = 0, aboveFloor = 0, hardLo = 0, hardHi = 100 } = {}) {
  if (v == null) return null;
  if (v >= idealLo && v <= idealHi) return 4;
  if (v < idealLo) return lerp(v, hardLo, belowFloor, idealLo, 4);
  return lerp(v, idealHi, 4, hardHi, aboveFloor);
}

// ---------------------------------------------------------------------------
// Metric tree — a metric is either a leaf ({compute}) or a parent ({children,
// merge}). Merge patterns: mean | weighted | min | max. Null-scored children
// drop out and weights renormalize, so a missing data source degrades that
// branch instead of zeroing it. The overall score is just the root node.
// ---------------------------------------------------------------------------
// Outside-sensitive weighting: a weighted mean pushed away from a pivot.
// Endpoints and pivot are fixed (0→0, pivot→pivot, 4→4); everything else
// stretches outward, so a blend reads decisively good or decisively not
// instead of clustering at C. Pivot moved from 3.0 to 2.9 and exponent from
// 0.42 to 0.4, 2026-11-09 — final values in the retune below this file's
// "Root weights" comment; both were fit together against real history, not
// independently, so changing one without the other will skew the letter-
// group balance documented there.
const PIVOT = 2.9;
const outsideSensitive = x => x >= PIVOT ? PIVOT + (4 - PIVOT) * ((x - PIVOT) / (4 - PIVOT)) ** 0.4 : PIVOT - PIVOT * ((PIVOT - x) / PIVOT) ** 0.4;

const MERGES = {
  mean: cs => cs.reduce((a, c) => a + c.score, 0) / cs.length,
  weighted: cs => cs.reduce((a, c) => a + c.score * (c.weight ?? 1), 0) / cs.reduce((a, c) => a + (c.weight ?? 1), 0),
  min: cs => Math.min(...cs.map(c => c.score)),
  max: cs => Math.max(...cs.map(c => c.score)),
  // Stacked excellence: leaves top out at 4.0, so only a chorus of
  // near-perfect children can push a blend past it. Trigger/amount/child
  // threshold retuned 2026-11-09 alongside the root weights below — with
  // access and vantage no longer propping up the blend, real x rarely gets
  // close to the old 3.7 trigger at all, which left A and A+ at ~0.3%/0.0%
  // across the full real history. JW: "NO A or A+ values?" — +0.2 per
  // child at ≥3.6 once the blend reaches 2.8. Retuned again alongside PIVOT
  // once JW flagged that F was reading 0% (the first version of this fix
  // never reapplied real no-go overrides) and that the five letter groups
  // (F/D/C/B/A) should each land in a 10-30% band ("20% +/- 10"), checked
  // against all 13,837 historical snapshots with road-closure-only no-gos
  // correctly excluded (see detectNoGo/buildPayload) rather than counted as F.
  // Weight-0 children (access, vantage) are excluded from this count, not
  // just from the weighted mean: access sits at a flat 4.0 on almost every
  // non-closure night, which would otherwise award the bonus almost for free.
  'outside-sensitive': cs => {
    const x = MERGES.weighted(cs);
    const bonus = x >= 2.8 ? 0.2 * cs.filter(c => (c.weight ?? 1) > 0 && c.score >= 3.6).length : 0;
    return outsideSensitive(x) + bonus;
  },
};

function evalMetric(def, ctx) {
  const node = { key: def.key, name: typeof def.name === 'function' ? def.name(ctx) : def.name };
  if (def.weight != null) node.weight = def.weight;
  if (def.children) {
    node.merge = ctx.mergeOverrides?.[def.key] || def.merge || 'mean';
    node.children = def.children.map(c => evalMetric(c, ctx));
    const scored = node.children.filter(c => c.score != null);
    node.score = scored.length ? +clamp(MERGES[node.merge](scored), 0, 4.3).toFixed(2) : null;
  } else {
    const r = def.compute(ctx) || {};
    node.score = r.score == null ? null : +(+r.score).toFixed(2);
    if (r.value != null) node.value = String(r.value);
  }
  const note = def.note?.(ctx);
  if (note) node.note = note;
  node.grade = node.score == null ? '?' : gradeOf(node.score);
  node.color = node.score == null ? 'yellow' : colorOf(node.score);
  return node;
}

// ctx = { wx, models, points, aq, owm, dir ('E'|'W'), ms, now, access }
// A band's value is the mean over its sample points (near = the site cell;
// mid/far = the CONFIG.cloudBands distances toward the sun).
const pct = v => v == null ? null : `${Math.round(v)}%`;
const bandLocs = (ctx, band) =>
  band === 'near' ? [ctx.wx] : CONFIG.cloudBands[band].map(mi => ctx.points[ctx.dir + mi]).filter(Boolean);
function bandVal(ctx, band, key) {
  const vals = bandLocs(ctx, band).map(loc => at(loc, key, ctx.ms)).filter(v => v != null);
  return vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : null;
}

// Coverage can't tell a thin translucent veil from a milky wash-out; direct
// radiation can. Backtest across the photo set: May 4 2026 (99% high cloud,
// direct fraction 0.60) was "the color!!!" while the blocked Jun 2 sky read
// 0.00. Sampled an hour sunward of the event (before sunset / after sunrise);
// trusted only when total radiation is strong enough to mean anything.
const veilTranslucent = ctx => {
  const offset = ctx.dir === 'W' ? -3600000 : 3600000;
  const dr = at(ctx.wx, 'direct_radiation', ctx.ms + offset);
  const sw = at(ctx.wx, 'shortwave_radiation', ctx.ms + offset);
  return dr != null && sw != null && sw >= 50 && dr / sw >= 0.4;
};

// A totally empty sky at this altitude isn't ugly, just plain — Craggy sunrise
// 2026-07-30 (thin far wisps only, near/mid/far all read 0% at every
// altitude) scored a near-failing C- (1.81) under the old floor of 1 (D). JW:
// "nothing that made it bad per se... but the lack of mid-ground clouds,
// cumulonimbus, cirrocumulus, altocumulus etc. means it can't be higher than
// a C+." Floor raised so a fully clear band lands mid-C+, never crossing into
// B- — bump it deserves, ceiling it can't earn without real structure.
//
// 2026-10-22: briefly tried loosening this floor whenever low/mid showed
// structure (to stop absent cirrus dragging down a good low deck under the
// weighted average below). Superseded the same day by JW's own fix one
// level up — see altitudeChildren's merge — which solves it more directly
// and without this leaf having to guess whether a layer it knows nothing
// about might be "good": reverted to the plain floor.
const highLeaf = band => ctx => {
  const v = bandVal(ctx, band, 'cloud_cover_high');
  const score = bandScore(v, 20, 70, { belowFloor: 1.8, aboveFloor: 0.5 });
  if (score != null && score < 3 && v >= 70 && veilTranslucent(ctx)) {
    return { score: 3, value: `${pct(v)} (thin veil — direct light passing)` };
  }
  return { score, value: pct(v) };
};
// "AS LONG AS THERE IS COLOR": when the sunward horizon is open, light sneaks
// under a heavy deck and turns it into a lit ceiling (calibration photo: full
// gray deck over Craggy, glow strip beneath — lovely). When the gap is shut,
// the same deck is a gray dome. Openness raises the floor for heavy coverage.
const sunwardOpenness = ctx => {
  const loc = horizonLoc(ctx, CONFIG.cloudSampleMiles[0]);
  const low = loc ? at(loc, 'cloud_cover_low', ctx.ms) : null;
  return low == null ? 0.5 : clamp(1 - (low - 10) / 60, 0, 1);
};

const midAltLeaf = band => ctx => {
  const v = bandVal(ctx, band, 'cloud_cover_mid');
  // Underlit heavy deck is "a C (2.0) at best" — openness lifts the floor to 2, no higher.
  const floor = 0.5 + 1.5 * sunwardOpenness(ctx);
  // belowFloor raised alongside highLeaf's — see its comment (Craggy 2026-07-30).
  return { score: bandScore(v, 10, 50, { belowFloor: 2.5, aboveFloor: floor }), value: pct(v) };
};
// Scattered low cumulus over the ridges is the drama (see the Green Knob
// calibration photo — orange-lit puffs at 30–40% coverage); only a
// solidifying deck hurts. The horizon metric guards the light path.
// Coarse grids report ridge-hugging broken cumulus as "100% low cloud". When
// the sunward horizon is wide open and the dew spread says nobody is socked
// in, a solid-low reading is probably broken orographic cloud with sunbursts
// (backtest: Oct 9 2022 Craggy, ERA5 said 100% low — the sky was magnificent).
// Fast-moving decks: at Craggy the low cloud can swing from fog to crystal in
// minutes (June 23 2026 photo — "sometimes you couldn't see the mountains at
// all, other times they were crystal clear"). Sample low cloud ±2h around the
// event plus wind; a volatile deck means windows of clarity, not a lost event.
//
// A second kind of volatility, added 2026-11-06: the site itself can read
// fully socked in while the sky isn't uniform AT ALL — a near/mid deck sealed
// shut over a far band that's already clearing, built from CAPE readings that
// say the deck is cellular/towering rather than a flat stable slab. Home,
// 2026-11-05 sunset: site-view and near-low both 100% ("Socked in" fired), but
// far-low read 13% (A) and texture read CAPE 1563 — "convective towers" — in
// the very same snapshot. JW's photos 22 minutes later showed a broken,
// colorful A sky, confirmed directly: "it was an A so... we should fix that."
// Gate on BOTH the gradient and the texture, not either alone: 2026-10-16 had
// the same huge near/far gradient (100% vs 0%) but CAPE 23 ("slab-prone", a
// flat stable deck with nowhere to break) — and that F was correct, the
// clouds really did roll in solid (see HISTORY.md 2026-10-16). A big gradient
// with a stable-air CAPE reading is just a deck that hasn't reached the far
// sample yet, not one that's breaking up.
const deckDynamics = ctx => {
  const lows = [];
  for (let dh = -2; dh <= 2; dh++) {
    const v = at(ctx.wx, 'cloud_cover_low', ctx.ms + dh * 3600000);
    if (v != null) lows.push(v);
  }
  const wind = at(ctx.wx, 'wind_speed_10m', ctx.ms) ?? 0;
  const swing = lows.length > 1 ? Math.max(...lows) - Math.min(...lows) : 0;
  const siteLow = at(ctx.wx, 'cloud_cover_low', ctx.ms);
  const farLow = bandVal(ctx, 'far', 'cloud_cover_low');
  const gradient = siteLow != null && farLow != null ? siteLow - farLow : 0;
  const cape = bandVal(ctx, 'mid', 'cape');
  const towers = cape != null && cape > 1500; // leafTexture's own "convective towers" label
  return {
    swing, wind, gradient, cape,
    dynamic: swing >= 40 || (wind >= 18 && swing >= 20) || (gradient >= 50 && towers),
  };
};

const brokenDeckLikely = ctx => {
  if (deckDynamics(ctx).dynamic) return true;
  const t = at(ctx.wx, 'temperature_2m', ctx.ms), dp = at(ctx.wx, 'dew_point_2m', ctx.ms);
  return sunwardOpenness(ctx) >= 0.7 && t != null && dp != null && t - dp >= 4;
};

const lowLeaf = band => ctx => {
  const v = bandVal(ctx, band, 'cloud_cover_low');
  if (v == null) return { score: null };
  // v<=5 used to flatly score 3.2 ("even a single great cloud earns full
  // marks") — fine under the old weighted average, where it got diluted
  // toward the band's other leaves regardless. Now that altitudeChildren
  // merges by MAX (2026-10-22, JW's call — "we should be taking the highest
  // score for any cloud type," so an absent cirrus layer can't drag down a
  // good low deck), this leaf's floor can single-handedly BECOME the band's
  // score, so "literally 0%" and "a 4% wisp" can no longer read the same:
  // ramped from 2.4 at v=0 up to the original 3.2 at v=5, so that a band
  // with nothing at any altitude still lands at the Craggy 2026-07-30
  // mid-C+ target via MAX(high 1.8, mid 2.5, low 2.4) = 2.5, not B-.
  let score = v <= 5 ? lerp(v, 0, 2.4, 5, 3.2) : v <= 45 ? 4 : v <= 70 ? lerp(v, 45, 4, 70, 2) : lerp(v, 70, 2, 100, 0);
  if (score < 2 && brokenDeckLikely(ctx)) return { score: 2, value: `${pct(v)} (likely broken)` };
  return { score, value: pct(v) };
};
// The site's own clouds also matter as a view-blocker: a solid deck overhead
// (or being inside one) hides the framed sky no matter how good it is out there.
const leafSiteView = ctx => {
  const low = at(ctx.wx, 'cloud_cover_low', ctx.ms), total = at(ctx.wx, 'cloud_cover', ctx.ms);
  if (low == null && total == null) return { score: null };
  const l = low ?? 0, t = total ?? 0;
  // No-blockage case drops out (null) rather than scoring 4.0, 2026-11-09.
  // JW, looking at two 2026-09-27 photos: near/mid genuinely read 0% cloud
  // at every altitude there (confirmed against the raw archive data, not
  // just the photo) and the far band was only 0-2% — a plain empty sky,
  // which the project already calibrated to cap at C+ (2026-07-30 Craggy,
  // via `lowLeaf`'s ramp). Under the old `min` merge this leaf's 4.0 "fine"
  // placeholder was harmless, since min could only ever pull the score DOWN
  // toward whichever child read lowest. Once clouds moved to `weighted`
  // (same day, the 2024-05-07 site-view-veto fix), that same placeholder
  // started adding real positive credit for an empty sky having nothing to
  // block, which is how these two landed at B/A- instead of the calibrated
  // C+ ceiling. This leaf's own header comment says its whole job is
  // catching a view-blocking deck; it was never meant to reward absence of
  // cloud, only to penalize a real blocker. Returning null when there's no
  // blockage (same null-drops-out-of-the-blend behavior as a missing data
  // source elsewhere in this file) restores that: a real problem (l>=60 or
  // t>=95) still scores and still weighs in, same as the 2024-05-07 fix
  // (which used the t>=95 branch, unaffected by this change); "no problem"
  // just no longer outvotes what the band leaves already determined.
  const score = l >= 85 ? 0.5 : l >= 60 ? lerp(l, 60, 2.5, 85, 1) : t >= 95 ? 2.5 : null;
  if (score != null && score < 2 && brokenDeckLikely(ctx)) {
    return { score: 2, value: `site low ${Math.round(l)}% · total ${Math.round(t)}% (likely broken)` };
  }
  if (score == null) return { score: null, value: `site low ${Math.round(l)}% · total ${Math.round(t)}% (unblocked)` };
  return { score, value: `site low ${Math.round(l)}% · total ${Math.round(t)}%` };
};

// Cross-model consensus: HRRR weighted up inside its ~18h horizon, NBM carries
// the 8–48h window, ECMWF/GFS always in the mix.
const leafConsensus = ctx => {
  const entries = [];
  for (const mkey of CONFIG.models) {
    const v = at(ctx.models, `cloud_cover_${mkey}`, ctx.ms);
    if (v != null) entries.push([CONFIG.modelLabels[mkey], v]);
  }
  if (!entries.length) return { score: null };
  const leadH = (ctx.ms - ctx.now) / 3600000;
  // HRRR: dominant inside its fresh-run window (hourly cycles, ≤18 h), still
  // weighted above the globals through 48 h — its radar-assimilation edge
  // fades with lead time but its 3 km terrain never does. No data past 48 h.
  const weights = { ECMWF: 1, GFS: 1, UKMO: 1, HRRR: leadH <= 18 ? 2 : 1.4, NBM: leadH >= 8 && leadH <= 48 ? 1.5 : 1 };
  const wsum = entries.reduce((a, [k]) => a + (weights[k] ?? 1), 0);
  const blend = entries.reduce((a, [k, v]) => a + v * (weights[k] ?? 1), 0) / wsum;
  const vals = entries.map(([, v]) => v);
  const spread = vals.length > 1 ? Math.max(...vals) - Math.min(...vals) : 0;
  return {
    score: bandScore(blend, 25, 80, { belowFloor: 1.5, aboveFloor: 0.5 }),
    value: `blend ${Math.round(blend)}% (${entries.map(([k, v]) => `${k} ${v}`).join(' · ')})${spread > 30 ? ' — models disagree' : ''}`,
  };
};

// Texture proxy, experimental (coast photo lesson: 55% broken granular
// altocumulus ≫ 55% slab, but grids only report coverage). CAPE correlates
// with cellular/cumuliform fields; stable air favors slabs. Light weight —
// here to play with over time. Moot when the framed sky is nearly empty.
const leafTexture = ctx => {
  const cape = bandVal(ctx, 'mid', 'cape');
  const total = bandVal(ctx, 'mid', 'cloud_cover');
  if (cape == null || total == null || total < 10) return { score: null };
  const score =
    cape <= 100 ? 2 :                          // stable: slab-prone
    cape <= 500 ? lerp(cape, 100, 2, 500, 4) : // mild instability: breaking up
    cape <= 1500 ? 4 :                         // cellular cumulus territory
    lerp(cape, 1500, 4, 3000, 2.5);            // storm-tower drama, with risk
  const label = cape <= 100 ? 'slab-prone' : cape <= 1500 ? 'cellular likely' : 'convective towers';
  return { score, value: `CAPE ${Math.round(cape)} J/kg — ${label}` };
};

const horizonLoc = (ctx, mi) => ctx.points[ctx.dir + mi];
// The gate for underlighting: clouds ON the horizon toward the sun. Non-
// monotonic per the calibration photos — a sprinkle (~10–25%) decorates the
// glow band (Craggy sunset: "some horizon clouds... nice"), while a heavy band
// seals the gap and a promising deck stays gray (the home failure shot).
const leafLowClear = mi => ctx => {
  const loc = horizonLoc(ctx, mi); const low = loc ? at(loc, 'cloud_cover_low', ctx.ms) : null;
  if (low == null) return { score: null };
  const s = low <= 5 ? 3.5 : low <= 10 ? lerp(low, 5, 3.5, 10, 4) : low <= 25 ? 4
    : low <= 50 ? lerp(low, 25, 4, 50, 1.5) : low <= 75 ? lerp(low, 50, 1.5, 75, 0.5) : lerp(low, 75, 0.5, 100, 0);
  return { score: s, value: `low ${Math.round(low)}%` };
};
const leafCanvas = mi => ctx => {
  const loc = horizonLoc(ctx, mi); if (!loc) return { score: null };
  const mid = at(loc, 'cloud_cover_mid', ctx.ms) ?? 0, high = at(loc, 'cloud_cover_high', ctx.ms) ?? 0;
  return { score: bandScore(mid * 0.5 + high * 0.5, 20, 80, { belowFloor: 1.5, aboveFloor: 2 }), value: `mid ${Math.round(mid)}% · high ${Math.round(high)}%` };
};
// Light-path blocker — merged with `min` so it caps the distance sample no
// matter how nice the cloud shape looks. Post-sunset light grazes UNDER mid
// and high decks (heavy-deck Craggy photo: total ~90%+ yet the glow got
// through), so low cloud dominates the effective blockage.
const leafBlocker = mi => ctx => {
  const loc = horizonLoc(ctx, mi);
  const low = loc ? at(loc, 'cloud_cover_low', ctx.ms) : null;
  const mid = loc ? at(loc, 'cloud_cover_mid', ctx.ms) : null;
  if (low == null && mid == null) return { score: null };
  const eff = (low ?? 0) + 0.5 * (mid ?? 0);
  return { score: eff >= 90 ? 1.5 : eff >= 75 ? 2.5 : 4, value: `low ${Math.round(low ?? 0)}% + ½·mid ${Math.round(mid ?? 0)}%` };
};
const horizonDistanceDef = mi => ({
  key: `h${mi}`, name: `${mi} mi out`, merge: 'min', children: [
    { key: `h${mi}-shape`, name: 'Cloud shape', merge: 'weighted', children: [
      { key: `h${mi}-low`, name: 'Low clear', weight: 0.7, compute: leafLowClear(mi) },
      { key: `h${mi}-canvas`, name: 'Color canvas', weight: 0.3, compute: leafCanvas(mi) },
    ] },
    { key: `h${mi}-block`, name: 'Light path', compute: leafBlocker(mi) },
  ],
});

const leafRH = ctx => { const rh = at(ctx.wx, 'relative_humidity_2m', ctx.ms); return { score: bandScore(rh, 40, 70, { belowFloor: 3, aboveFloor: 0 }), value: pct(rh) }; };
const leafPressure = ctx => {
  const p = at(ctx.wx, 'pressure_msl', ctx.ms); if (p == null) return { score: null };
  return { score: p >= 1020 ? 4 : p >= 1013 ? lerp(p, 1013, 3, 1020, 4) : p >= 1005 ? lerp(p, 1005, 1.5, 1013, 3) : 1, value: `${p} hPa` };
};
const leafDewSpread = ctx => {
  const t = at(ctx.wx, 'temperature_2m', ctx.ms), dp = at(ctx.wx, 'dew_point_2m', ctx.ms);
  if (t == null || dp == null) return { score: null };
  const s = t - dp;
  return { score: s >= 5 ? 4 : s >= 2 ? lerp(s, 2, 2, 5, 4) : lerp(s, 0, 0.5, 2, 2), value: `spread ${s.toFixed(1)} °C` };
};

const leafAOD = ctx => {
  const [midMi, farMi] = CONFIG.aodSampleMiles;
  const w = CONFIG.aodWeights;
  const pts = [[ctx.aq.local, w.local, 'site'], [ctx.aq[ctx.dir + midMi], w.mid, `${midMi}mi`], [ctx.aq[ctx.dir + farMi], w.far, `${farMi}mi`]];
  const parts = pts.map(([loc, ww, lbl]) => [loc ? at(loc, 'aerosol_optical_depth', ctx.ms) : null, ww, lbl]).filter(([v]) => v != null);
  if (!parts.length) return { score: null };
  const aod = parts.reduce((a, [v, ww]) => a + v * ww, 0) / parts.reduce((a, [, ww]) => a + ww, 0);
  const score = aod <= 0.1 ? 4 : aod <= 0.25 ? lerp(aod, 0.1, 4, 0.25, 1.5) : aod <= 0.5 ? lerp(aod, 0.25, 1.5, 0.5, 0.5) : Math.max(0, lerp(aod, 0.5, 0.5, 0.8, 0));
  return { score, value: `${aod.toFixed(3)} weighted (${parts.map(([v, , l]) => `${l} ${v}`).join(' · ')})` };
};
const leafPM25 = ctx => {
  const e = owmAt(ctx.owm, ctx.ms);
  const pm = e?.components?.pm2_5;
  if (pm == null) return { score: null };
  const score = pm <= 12 ? 4 : pm <= 35 ? lerp(pm, 12, 4, 35, 2.5) : pm <= 55 ? lerp(pm, 35, 2.5, 55, 1) : Math.max(0, lerp(pm, 55, 1, 150, 0));
  return { score, value: `${pm.toFixed(1)} µg/m³${e.main?.aqi ? ` · AQI ${e.main.aqi}/5` : ''}` };
};

// Color potential — distinct from Haze. Haze asks "can light get through the
// distance path"; this asks "will what arrives be saturated". Aerosols are
// non-monotonic for color: very clean = pure but tame golds, moderate load =
// saturated reds/pinks, heavy or humid haze = washed-out milk. Weighted toward
// the site itself, since saturation comes from overhead scattering.
const leafSaturation = ctx => {
  const [midMi, farMi] = CONFIG.aodSampleMiles;
  const pts = [[ctx.aq.local, 0.5, 'site'], [ctx.aq[ctx.dir + midMi], 0.3, `${midMi}mi`], [ctx.aq[ctx.dir + farMi], 0.2, `${farMi}mi`]];
  const parts = pts.map(([loc, ww, lbl]) => [loc ? at(loc, 'aerosol_optical_depth', ctx.ms) : null, ww, lbl]).filter(([v]) => v != null);
  if (!parts.length) return { score: null };
  const aod = parts.reduce((a, [v, ww]) => a + v * ww, 0) / parts.reduce((a, [, ww]) => a + ww, 0);
  const score =
    aod <= 0.05 ? 3 :                       // very clean: pure golds, less drama
    aod <= 0.08 ? lerp(aod, 0.05, 3, 0.08, 4) :
    aod <= 0.22 ? 4 :                       // the sweet spot: saturated reds/pinks
    aod <= 0.45 ? lerp(aod, 0.22, 4, 0.45, 1.5) :
    aod <= 0.7 ? lerp(aod, 0.45, 1.5, 0.7, 0.5) : 0.5;
  return { score, value: `AOD ${aod.toFixed(3)} (site-weighted)` };
};
// Dry haze stays colorful; humid haze swells and scatters white.
const leafColorPurity = ctx => {
  const rh = at(ctx.wx, 'relative_humidity_2m', ctx.ms);
  if (rh == null) return { score: null };
  const score = rh <= 50 ? 4 : rh <= 75 ? lerp(rh, 50, 4, 75, 2.5) : rh <= 90 ? lerp(rh, 75, 2.5, 90, 1) : 0.5;
  return { score, value: `RH ${Math.round(rh)}%` };
};
// Something in the framed sky has to catch the color.
const leafColorCanvas = ctx => {
  const high = bandVal(ctx, 'mid', 'cloud_cover_high'), mid = bandVal(ctx, 'mid', 'cloud_cover_mid');
  if (high == null && mid == null) return { score: null };
  const canvas = (high ?? 0) + 0.5 * (mid ?? 0);
  return { score: bandScore(canvas, 15, 75, { belowFloor: 1, aboveFloor: 1.5, hardHi: 150 }), value: `high ${Math.round(high ?? 0)}% + ½·mid ${Math.round(mid ?? 0)}%` };
};

// Root merges outside-sensitive: middling blends read decisively "skip it",
// good ones read decisively "go" — ?merge.overall=mean to compare.
// Each distance band carries its own altitude breakdown, so per-band
// prediction accuracy is inspectable on the dashboard.
// 2026-10-22, JW's call: don't blend cirrus against mid/low cloud, take the
// best of the three. "We shouldn't be averaging cirrus versus other
// clouds... an absent cirrus layer drags down a great low or mid deck." This
// is the canvas side only — a thick low deck that actually blocks the sun or
// horizon still counts against the shot through `leafSiteView` (merged by
// `min` at the Clouds level, not inside this band) and `detectNoGo`, neither
// of which reads these per-band leaf scores at all. No per-leaf weight here
// any more (see the merge on the parent band node) — kept only as a label
// for which altitude a leaf is reading, not how much it counts.
const altitudeChildren = band => [
  { key: `${band}-high`, name: 'High (cirrus)', compute: highLeaf(band) },
  { key: `${band}-midlvl`, name: 'Mid-level', compute: midAltLeaf(band) },
  { key: `${band}-low`, name: 'Low (cumulus)', compute: lowLeaf(band) },
];

// Root weights, 2026-11-09 — JW: "forget our final-score validations from
// the past. Create more of a normal distribution." Root-caused the 2026-11-07
// "two piles" finding past the pivot itself: branch-level history
// (13,837 real snapshots) showed access=4.000 on literally every non-closure
// night (siteAccess only ever returns {0,2,4}, never a continuum), vantage
// pinned per-site at a static constant, and air/haze also commonly sitting
// near their own ceiling. Equal-weighted, those near-constant branches
// diluted the two that actually carry the night's real signal (clouds,
// horizon) enough to produce a hard spike at x≈3.4 (16.4% of all historical
// snapshots, landing in B+ regardless of pivot choice) — not a transform
// artifact, a real clump in the input.
//
// Access (weight 0): JW — "access should be preventing values from being
// shown, not actually affecting grades." Originally a real closure forced
// the night to F via detectNoGo's accessInfo.noGo, same as a weather no-go
// — but JW caught that this was still wrong in a different way: "road
// closure should remove a site, not affect the grade." A closure means you
// can't get there, not that the sky is bad, so as of buildPayload
// (2026-11-09) a closure-only site is dropped from that event entirely
// rather than graded F — see the comment there. Its weighted-blend
// contribution here was separately redundant regardless, so it stays
// zeroed; still computed, just no longer part of the score.
//
// Vantage (weight 0): JW — "it's relevant if you were comparing two sites,
// but that's never really what's happening for me... I know what they're
// like." A static per-site rating of the viewpoint's own scenic quality,
// never varying night to night, telling him nothing about tonight. Zeroed
// for the same reason as access, kept visible for context.
//
// air/haze stay in the blend (both are real, live weather reads — RH,
// pressure, dewpoint spread, AOD, PM2.5 — not static like vantage or
// structurally redundant like access) but weighted down, since their
// thresholds run generous enough to read near-ceiling often and were still
// contributing to the residual clump after access/vantage were removed.
// Simulated against the full real history (13,837 snapshots): max single
// grade bucket dropped from 39.6% (B+) to 18.4% (C+), with real spread
// across C/C+/B-/B/B+ instead of one dominant pile. This supersedes the
// 2026-11-07 "waiting on direction" entry in CLAUDE.md — direction given.
const METRIC_TREE = {
  key: 'overall', name: 'Overall', merge: 'outside-sensitive',
  children: [
    { key: 'clouds', name: 'Clouds', weight: 1.5, merge: 'weighted',
      // merge changed from 'min' to 'weighted', 2026-11-09. JW, looking at a
      // real photo (2024-05-07 sunset, Home — textured high deck, glowing
      // horizon, computed D+): "clouds in two zones being good and a third
      // zone being mediocre shouldn't fall to the lowest level." That photo
      // had bands=4.0 (near/mid/far all read a textured, thin-veil high
      // deck with light passing through) but site-view=2.5 (total cloud
      // 100% at the site's own cell, low cloud only 3%) — under `min`, the
      // whole branch collapsed to 2.5 regardless of what the bands actually
      // saw. site-view's own check (server.js: "the site's own clouds also
      // matter as a view-blocker... a solid deck overhead hides the framed
      // sky no matter how good it is out there") is a real concern, but a
      // weaker instrument than it was being trusted as: it only reads raw
      // total/low cloud_cover at one grid cell, with no veil-vs-opaque
      // distinction, while the band leaves already DO distinguish a thin
      // veil passing direct light from a solid deck. And the genuinely
      // severe case site-view exists to catch — truly socked in, can't see
      // anything — is already a hard no-go via detectNoGo's own "Socked in"
      // check (total>=95 AND low>=80), independent of this branch entirely.
      // In the 2024-05-07 photo, low was only 3% — nowhere near that
      // threshold, so detectNoGo correctly did NOT fire; site-view's own
      // moderate-penalty case (t>=95, any low%) was flagging something the
      // no-go logic had already judged not severe. So: site-view stays a
      // real input (weight 0.5, not deleted — a genuinely blocked view
      // still matters even short of a hard no-go) but can no longer veto
      // three good band readings on its own.
      note: ctx => {
        const d = deckDynamics(ctx);
        return d.swing >= 30 || d.wind >= 15
          ? `deck in motion: low cloud swings ${d.swing}% within ±2 h, wind ${Math.round(d.wind)} mph — expect windows`
          : null;
      },
      children: [
      // Distance bands weighted by their share of the frame (~15–20 mm FF,
      // ~65% sky): near = top of frame, mid-ground = the money zone, far =
      // the thin band above the horizon glow.
      { key: 'bands', name: 'Distance bands', merge: 'weighted', children: [
        { key: 'near', name: 'Near — top of frame (≲3 mi)', weight: 0.20, merge: 'max', children: altitudeChildren('near') },
        { key: 'mid', name: 'Mid-ground (~2–9 mi)', weight: 0.55, merge: 'max', children: altitudeChildren('mid') },
        { key: 'far', name: 'Far (~9–24 mi)', weight: 0.25, merge: 'max', children: altitudeChildren('far') },
        { key: 'consensus', name: 'Model consensus (site)', weight: 0.12, compute: leafConsensus },
        { key: 'texture', name: 'Texture (CAPE)', weight: 0.08, compute: leafTexture },
      ] },
      { key: 'site-view', name: 'Sight line from site', weight: 0.5, compute: leafSiteView },
    ] },
    { key: 'horizon', name: 'Horizon', weight: 1.3, merge: 'mean', children: CONFIG.cloudSampleMiles.map(horizonDistanceDef) },
    { key: 'access', name: 'Access', weight: 0,
      compute: ctx => ({ score: ctx.access.score, value: ctx.access.label }),
      note: ctx => { const c = (ctx.access.sections || []).find(r => /clos/i.test(r.status)); return c ? `MP ${c.from}–${c.to} ${c.status}${c.note ? ': ' + c.note.slice(0, 90) : ''}` : null; } },
    { key: 'air', name: 'Clarity', weight: 0.6, merge: 'mean', children: [
      { key: 'rh', name: 'Rel. humidity', compute: leafRH },
      { key: 'pressure', name: 'Pressure (MSL)', compute: leafPressure },
      { key: 'dew', name: 'Fog risk', compute: leafDewSpread },
    ], note: ctx => {
      const vis = at(ctx.wx, 'visibility', ctx.ms), wind = at(ctx.wx, 'wind_speed_10m', ctx.ms);
      return [vis != null ? `visibility ${Math.round(vis / 1000)} km` : null, wind != null ? `wind ${Math.round(wind)} mph` : null].filter(Boolean).join(' · ') || null;
    } },
    { key: 'haze', name: 'Haze', weight: 0.5, merge: 'weighted', children: [
      { key: 'aod', name: 'AOD (CAMS)', weight: 0.7, compute: leafAOD },
      { key: 'pm25', name: 'PM2.5 (OpenWeather)', weight: 0.3, compute: leafPM25 },
    ] },
    { key: 'color', name: 'Color', weight: 1.0, merge: 'weighted', children: [
      { key: 'saturation', name: 'Saturation (aerosols)', weight: 0.5, compute: leafSaturation },
      { key: 'purity', name: 'Purity (dry air)', weight: 0.3, compute: leafColorPurity },
      { key: 'canvas', name: 'Canvas (clouds)', weight: 0.2, compute: leafColorCanvas },
    ] },
    { key: 'vantage', name: 'Vantage', weight: 0,
      compute: ctx => ({ score: ctx.site.vantage, value: ctx.site.vantageNote }) },
  ],
};

// A volatile deck downgrades fog/socked-in from a hard no-go to a gamble the
// scores can express — one moment fogged in, the next open and magnificent.
function detectNoGo(wxLoc, ms, dyn, site) {
  const reasons = [];
  const rh = at(wxLoc, 'relative_humidity_2m', ms);
  const t = at(wxLoc, 'temperature_2m', ms);
  const dp = at(wxLoc, 'dew_point_2m', ms);
  const vis = at(wxLoc, 'visibility', ms);
  const total = at(wxLoc, 'cloud_cover', ms);
  const low = at(wxLoc, 'cloud_cover_low', ms);
  const precip = at(wxLoc, 'precipitation', ms);
  if (!dyn?.dynamic) {
    if (vis != null && vis < 1000) reasons.push(`Fog likely (visibility ${Math.round(vis)} m)`);
    else if (rh != null && t != null && dp != null && rh >= 96 && t - dp <= 1.5) reasons.push(`Fog likely (RH ${rh}%, dew spread ${(t - dp).toFixed(1)}°C)`);
    if (total != null && low != null && total >= 95 && low >= 80) reasons.push(`Socked in (${total}% total, ${low}% low cloud)`);
  }
  // Summit immersion — deliberately OUTSIDE the !dyn.dynamic guard above.
  // That guard exists for a view-BLOCKING deck between the site and the
  // horizon, which can open a window (June 23 2026 Craggy: fog wall to
  // glowing undercast in three minutes — the evidence the "gamble" framing
  // is built on). Being physically inside the cloud is a different claim: it
  // doesn't matter which direction you look, and a volatile hourly forecast
  // doesn't mean it resolves in your favor — JW spent two straight hours
  // fogged in at Craggy on 2026-10-04 while the forecast read "deck in
  // motion." The existing fog checks also missed it on their own terms: RH
  // 87% and a 2.1C spread fell just under the 96%/1.5C ground-fog threshold
  // that was calibrated for a valley site, and cloud_cover_low read only 11%
  // at the site even though total was 100% -- the overcast wasn't filed
  // under "low" by the model's own banding, but a 5,600ft summit sitting in
  // it doesn't care which band. This checks dew-point spread directly
  // instead, and applies only to the two true summits (elevM >= 1600, i.e.
  // Craggy and Mitchell) where "inside the deck" is physically plausible.
  // CONFIRMED against exactly one instance (Craggy, 2026-10-04); Mitchell is
  // included on the same physics but has no confirmed case of its own yet.
  // See wi-1819, ground-truth/observations.jsonl, HISTORY.md 2026-10-16.
  if (site?.elevM >= 1600 && t != null && dp != null && total != null) {
    const spread = t - dp;
    if (spread <= 2.5 && total >= 85) reasons.push(`Possibly in cloud at the summit (dew spread ${spread.toFixed(1)}°C, total cloud ${total}%)`);
  }
  if (precip != null && precip >= 4) reasons.push(`Heavy rain (${precip} mm/hr)`);
  // accessInfo.noGo (a closed Parkway section) is deliberately NOT folded in
  // here any more — see buildPayload, 2026-11-09. JW: "road closure should
  // remove a site, not affect the grade." A closure means you can't get
  // there, which is a different claim than "the sky there is bad" — the two
  // used to be conflated into one F grade. Weather no-gos (above) still mean
  // the sky genuinely isn't worth it and still produce F.
  return reasons;
}

// Grade rubric (Ruby-style x...y: >= x and < y). "A letter" in calibration
// feedback means the LOWEST score of its band — "a C" is 2.0.
// 0...0.7 F · 0.7...1.3 D · 1.3...1.7 D+ · 1.7...2.0 C- · 2.0...2.3 C ·
// 2.3...2.7 C+ · 2.7...3.0 B- · 3.0...3.3 B · 3.3...3.7 B+ · 3.7...4.0 A- ·
// 4.0...4.3 A · >= 4.3 A+ (values above 4.0 are reachable only via the
// stacked-excellence bonus in the outside-sensitive merge).
const gradeOf = s =>
  s >= 4.3 ? 'A+' : s >= 4.0 ? 'A' : s >= 3.7 ? 'A-' :
  s >= 3.3 ? 'B+' : s >= 3.0 ? 'B' : s >= 2.7 ? 'B-' :
  s >= 2.3 ? 'C+' : s >= 2.0 ? 'C' : s >= 1.7 ? 'C-' :
  s >= 1.3 ? 'D+' : s >= 0.7 ? 'D' : 'F';
const colorOf = s => s >= 3.7 ? 'green' : s >= 2.7 ? 'lightgreen' : s >= 1.7 ? 'yellow' : 'red';

// ---------------------------------------------------------------------------
// Assemble the forecast payload
// ---------------------------------------------------------------------------
function indexPoints(points, locations) {
  const bySite = {};
  points.forEach((p, i) => {
    bySite[p.site] = bySite[p.site] || {};
    bySite[p.site][p.role] = locations[i];
  });
  return bySite;
}

function buildPayload(raw, mergeOverrides, entryId) {
  const entry = resolveEntry(entryId);
  const now = Date.now();
  const horizonEnd = now + CONFIG.horizonHours * 3600000;
  const wxBySite = indexPoints(raw.wxPoints, raw.wx);
  const aqBySite = indexPoints(raw.aqPoints, raw.aq);
  const modelsBySite = {};
  CONFIG.sites.forEach((s, i) => { modelsBySite[s.id] = raw.models[i]; });

  // Events: union of sunrise/sunset in the next 72h (per-site times differ by <1 min; use first site's for the event, per-site for math).
  const ref = wxBySite[CONFIG.sites[0].id].local;
  const events = [];
  for (const kind of ['sunrise', 'sunset']) {
    for (const iso of ref.daily[kind]) {
      const ms = localISOtoMs(iso, ref.utc_offset_seconds);
      if (ms > now && ms <= horizonEnd) events.push({ kind, ms });
    }
  }
  events.sort((a, b) => a.ms - b.ms);

  const eventsOut = events.map(ev => {
    const dirPrefix = ev.kind === 'sunrise' ? 'E' : 'W';
    const sitesOut = CONFIG.sites.map(site => {
      const wxLoc = wxBySite[site.id].local;
      const accessInfo = siteAccess(site, raw.access, entry);
      const ctx = {
        site, wx: wxLoc, models: modelsBySite[site.id], points: wxBySite[site.id],
        aq: aqBySite[site.id], owm: raw.owm?.[site.id],
        dir: dirPrefix, ms: ev.ms, now, access: accessInfo, mergeOverrides,
      };
      const root = evalMetric(METRIC_TREE, ctx);
      const weatherNoGo = detectNoGo(wxLoc, ev.ms, deckDynamics(ctx), site);
      // A closed Parkway section means you can't get there — a different
      // claim than "the sky there is bad." JW, 2026-11-09: "road closure
      // should remove a site, not affect the grade." Closure-only (no
      // weather reason) drops the site from this event entirely, below.
      // When a real weather no-go is ALSO present, the closure is folded in
      // as context (both facts shown) but isn't what's doing the gating —
      // the weather alone already would have.
      if (accessInfo.noGo && !weatherNoGo.length) return null;
      const noGo = accessInfo.noGo && weatherNoGo.length ? [...weatherNoGo, accessInfo.noGo] : weatherNoGo;
      const overall = noGo.length ? 0 : +(root.score ?? 0).toFixed(2);

      // Departure chain — all dynamic from CONFIG. Plans target PHOTO TIME
      // (photoLeadMin before the event), not the event itself.
      const bufferMin = ev.kind === 'sunset' ? CONFIG.prep.sunsetBufferMin : 0;
      const photoMs = ev.ms - CONFIG.prep.photoLeadMin * 60000;
      const departMs = photoMs - (site.travelMin + site.hikeMin + CONFIG.prep.setupMin + bufferMin) * 60000;
      const alarmMs = departMs - (CONFIG.prep.packMin + CONFIG.prep.wakeMin) * 60000;

      return {
        id: site.id, name: site.name,
        // Home is a calibration proxy, not a destination — the API ranks
        // without it (see buildOpportunities) so a backyard view never
        // becomes "the worst site tonight".
        calibration: !!site.calibration,
        overall, grade: gradeOf(overall), color: noGo.length ? 'red' : colorOf(overall),
        noGo,
        merge: root.merge,
        metrics: root.children,
        eventTime: fmtTime(ev.ms),
        plan: {
          travelMin: site.travelMin, hikeMin: site.hikeMin, hikeNote: site.hikeNote,
          setupMin: CONFIG.prep.setupMin, bufferMin,
          photo: fmtTime(photoMs), photoMs,
          depart: fmtTime(departMs), departMs,
          alarm: ev.kind === 'sunrise' ? fmtTime(alarmMs) : null, alarmMs: ev.kind === 'sunrise' ? alarmMs : null,
        },
      };
    }).filter(Boolean);
    sitesOut.sort((a, b) => b.overall - a.overall);
    // Rank destinations only. Home scores the same sky but is a calibration
    // proxy, not a place to drive to, so it must never be named "best" — it
    // outscored Mitchell 3.67 to 3.56 on 2026-08-26 and would have been.
    // buildOpportunities already filtered this way; the dashboard did not.
    const rankable = sitesOut.filter(s => !s.calibration);
    return {
      kind: ev.kind, ms: ev.ms, time: fmtTime(ev.ms), day: fmtDay(ev.ms),
      hoursOut: +((ev.ms - now) / 3600000).toFixed(1),
      best: rankable[0] ? { name: rankable[0].name, grade: rankable[0].grade, color: rankable[0].color, overall: rankable[0].overall } : null,
      sites: sitesOut,
    };
  });

  const nextEvent = eventsOut[0];
  return {
    generatedAt: new Date(now).toISOString(),
    timezone: CONFIG.timezone,
    home: LOCAL ? CONFIG.homeName : null,
    local: LOCAL,
    statusBar: nextEvent?.best?.color ?? 'yellow',
    stale: raw.staleSince ? { since: new Date(raw.staleSince).toISOString(), minutes: Math.round((now - raw.staleSince) / 60000) } : null,
    entry: { id: entry.id, name: entry.name, milepost: entry.milepost, chosen: !!entryId && entry.id === entryId },
    accessPoints: CONFIG.accessPoints.map(a => ({ id: a.id, name: a.name, milepost: a.milepost })),
    access: raw.access && !raw.access.error
      ? { ok: true, fetchedAt: raw.access.fetchedAt, source: raw.access.source }
      : { ok: false, error: raw.access?.error },
    events: eventsOut,
    config: { prep: CONFIG.prep, models: Object.values(CONFIG.modelLabels), aodWeights: CONFIG.aodWeights, openWeather: !!raw.owm && Object.values(raw.owm).some(Boolean), mergeOverrides: mergeOverrides ?? null, mergePatterns: Object.keys(MERGES) },
  };
}

// Cache the raw upstream data only — scoring is cheap arithmetic, so the tree
// is re-evaluated per request, which lets ?merge.<key>=<pattern> experiment
// with mixing algorithms live.
// Serving a stale forecast beats serving nothing. A sunrise three hours out does
// not change much in fifteen minutes, and someone deciding whether to set an
// alarm is far better off with data an hour old and labelled than with an error
// page. Only give up if there is genuinely nothing cached.
const STALE_LIMIT_MS = 6 * 3600000;

// Last good upstream payload, persisted. An in-memory cache only helps a warm
// process: on 2026-09-07 the service was restarted during an upstream 429 and
// had nothing to fall back on, so the dashboard served an error page. A public
// deployment restarts for all sorts of reasons and must not depend on having
// been lucky about when.
const CACHE_FILE = path.join(__dirname, 'data', 'last-good.json');

function saveCache(raw, at) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ at, raw }));
  } catch (e) { console.error('could not persist cache:', e.message); }
}

function loadCache() {
  try {
    const { at, raw } = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (at && raw) { console.log(`warm start: last-good cache ${Math.round((Date.now() - at) / 60000)} min old`); return { at, raw }; }
  } catch {}
  return null;
}

async function getRaw() {
  const ttl = CONFIG.cacheMinutes * 60000;
  const age = cache.raw ? Date.now() - cache.at : Infinity;
  if (cache.raw && age < ttl) return cache.raw;
  if (!cache.building) {
    cache.building = fetchAll()
      .then(raw => { const at = Date.now(); cache = { at, raw, building: null }; saveCache(raw, at); return raw; })
      .catch(err => {
        cache.building = null;
        const errAge = Date.now() - cache.at;
        if (cache.raw && errAge < STALE_LIMIT_MS) {
          console.error(`upstream refresh failed (${err.message.slice(0, 80)}); serving cache ${Math.round(errAge / 60000)} min old`);
          cache.raw.staleSince = cache.at;
          return cache.raw;
        }
        throw err;
      });
  }
  // Stale-while-revalidate (2026-10-23): a merely-expired cache is served
  // immediately and the refresh above keeps running in the background.
  // Previously every request blocked on cache.building once the TTL passed,
  // so one slow/retrying upstream call (getJSON backs off up to ~10.5s
  // across 3 attempts, on top of the calls themselves) stalled every request
  // for that whole span — this is what produced the "SkyMagic unreachable:
  // timeout" report on 2026-10-23, matching upstream retry log lines from
  // the same night. Only block here when there's nothing usable to serve.
  if (cache.raw && age < STALE_LIMIT_MS) {
    cache.building.catch(() => {});
    return cache.raw;
  }
  return cache.building;
}

// ---------------------------------------------------------------------------
// JSON:API — /api/opportunities.json
//
// Built for a phone on the road: guessable URLs, one round trip for the
// overview, one for the detail. Resource ids are `YYYY-MM-DD-<kind>`
// ("2026-07-29-sunset") — a bare date is ambiguous, since every day has both a
// sunrise and a sunset. A date alone still works as a filter, and `next`
// resolves to the next event, so all of these are typeable from memory:
//
//   /api/opportunities.json                       every event in the horizon
//   /api/opportunities/next.json                  the next one, with sites
//   /api/opportunities/2026-07-29-sunset.json     one event, with sites
//   /api/opportunities/2026-07-29.json            that day's events, with sites
//   …?depth=3                                     deeper subscore tree
// ---------------------------------------------------------------------------
const isoDate = ms => new Intl.DateTimeFormat('en-CA', { timeZone: CONFIG.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
const eventId = ev => `${isoDate(ev.ms)}-${ev.kind}`;

// Times are given twice on purpose: a human string in the site's timezone (for
// reading on a phone) and a UTC instant (for anything that does math).
const timePair = (human, ms) => ({ local: human, at: ms == null ? null : new Date(ms).toISOString() });

// Subscores, trimmed to `depth` levels. depth=1 is the top-level metrics; go
// deeper to see which band or leaf is doing the damage.
function subscores(nodes, depth) {
  const out = {};
  for (const nd of nodes || []) {
    out[nd.key] = {
      name: nd.name, score: nd.score, grade: nd.grade, color: nd.color,
      ...(nd.value != null ? { value: nd.value } : {}),
      ...(nd.note ? { note: nd.note } : {}),
      ...(depth > 1 && nd.children?.length ? { children: subscores(nd.children, depth - 1) } : {}),
    };
  }
  return out;
}

function siteResource(ev, site, depth) {
  return {
    type: 'site-forecasts',
    id: `${eventId(ev)}:${site.id}`,
    attributes: {
      site: site.id,
      name: site.name,
      calibration_only: site.calibration,
      score: site.overall,
      grade: site.grade,
      color: site.color,
      no_go: site.noGo,
      event_time: timePair(site.eventTime, ev.ms),
      photo_time: timePair(site.plan.photo, site.plan.photoMs),
      depart_time: timePair(site.plan.depart, site.plan.departMs),
      alarm_time: timePair(site.plan.alarm, site.plan.alarmMs),
      legs: {
        travel_min: site.plan.travelMin, hike_min: site.plan.hikeMin,
        setup_min: site.plan.setupMin, buffer_min: site.plan.bufferMin,
        hike_note: site.plan.hikeNote,
      },
      subscores: subscores(site.metrics, depth),
    },
  };
}

function opportunityResource(ev, base, depth) {
  const id = eventId(ev);
  // Rank destinations only. Home scores the same sky but you can't drive to
  // it, so letting it win "best" or lose "worst" would be noise.
  const ranked = ev.sites.filter(s => !s.calibration);
  const best = ranked[0] || null;        // sites arrive sorted by score, desc
  const worst = ranked[ranked.length - 1] || null;
  return {
    type: 'opportunities',
    id,
    attributes: {
      event: `${ev.kind} ${isoDate(ev.ms)}`,
      kind: ev.kind,
      date: isoDate(ev.ms),
      event_time: timePair(ev.time, ev.ms),
      hours_out: ev.hoursOut,
      best_score: best?.overall ?? null,
      best_score_grade: best?.grade ?? null,
      best_site: best?.name ?? null,
      worst_score: worst?.overall ?? null,
      worst_score_grade: worst?.grade ?? null,
      worst_site: worst?.name ?? null,
      // Enough to act on without a second request: where to go and when to go.
      go: best ? { site: best.name, photo_time: best.plan.photo, depart_time: best.plan.depart, alarm_time: best.plan.alarm } : null,
    },
    relationships: {
      sites: { data: ev.sites.map(s => ({ type: 'site-forecasts', id: `${id}:${s.id}` })) },
    },
    links: { self: `${base}/api/opportunities/${id}.json` },
  };
}

function buildOpportunities(payload, base, { id = null, depth = 1 } = {}) {
  let events = payload.events;
  if (id === 'next') events = events.slice(0, 1);
  else if (id) events = events.filter(ev => eventId(ev) === id || isoDate(ev.ms) === id);

  if (id && !events.length) {
    return { status: 404, body: { errors: [{ status: '404', title: 'No such opportunity', detail: `No event '${id}' inside the ${CONFIG.horizonHours}h horizon.`, links: { about: `${base}/api/opportunities.json` } }] } };
  }

  const data = events.map(ev => opportunityResource(ev, base, depth));
  const body = {
    jsonapi: { version: '1.0' },
    links: { self: `${base}/api/opportunities${id ? `/${id}` : ''}.json`, ...(id ? { collection: `${base}/api/opportunities.json` } : {}) },
    meta: {
      generated_at: payload.generatedAt,
      timezone: payload.timezone,
      horizon_hours: CONFIG.horizonHours,
      scale: '0–4, letter bands F…A+ (a bare letter is the bottom of its band)',
      ranked_sites_exclude: CONFIG.sites.filter(s => s.calibration).map(s => s.id),
      access: payload.access,
    },
    data,
    // The collection stays light; asking for an event includes its sites.
    ...(id ? { included: events.flatMap(ev => ev.sites.map(s => siteResource(ev, s, depth))) } : {}),
  };
  // JSON:API: a request for one resource returns an object, not an array. A
  // bare date can match two events (sunrise + sunset), so that stays a list.
  const singular = id === 'next' || /^\d{4}-\d{2}-\d{2}-(sunrise|sunset)$/.test(id || '');
  if (singular && data.length === 1) body.data = data[0];
  return { status: 200, body };
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/forecast') {
      let overrides = null;
      for (const [k, v] of url.searchParams) {
        if (k.startsWith('merge.') && MERGES[v]) (overrides = overrides || {})[k.slice(6)] = v;
      }
      const payload = buildPayload(await getRaw(), overrides, url.searchParams.get('entry'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    } else if (/^\/api\/opportunities(\/[^/]+)?(\.json)?$/.test(url.pathname)) {
      // Links are built from the request host so they stay clickable through a
      // tunnel or over the LAN, not just on localhost.
      const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0];
      const base = `${proto}://${req.headers.host || `localhost:${CONFIG.port}`}`;
      const seg = url.pathname.replace(/^\/api\/opportunities\/?/, '').replace(/\.json$/, '');
      const depth = clamp(parseInt(url.searchParams.get('depth') || '1', 10) || 1, 1, 6);
      const { status, body } = buildOpportunities(buildPayload(await getRaw(), null, url.searchParams.get('entry')), base, { id: seg || null, depth });
      res.writeHead(status, { 'Content-Type': 'application/vnd.api+json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(body, null, 2));
    } else if (url.pathname === '/api/ground-truth.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sources: groundTruth.listSources() }));
    } else if (/^\/api\/ground-truth\/[\w-]+\.json$/.test(url.pathname)) {
      const sourceId = url.pathname.match(/^\/api\/ground-truth\/([\w-]+)\.json$/)[1];
      const data = groundTruth.getSourceData(sourceId, url.searchParams.get('option'));
      if (!data) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: `Unknown source '${sourceId}'` })); }
      else { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); }
    } else if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html')));
    } else if (url.pathname === '/scores') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(path.join(__dirname, 'public', 'scores.html')));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err.message || err) }));
  }
});

// Only listen when run directly — `require('./server.js')` gives tools like
// history.js the scoring pipeline without starting a second HTTP server.
const warm = loadCache();
if (warm) cache = { at: warm.at, raw: warm.raw, building: null };

if (require.main === module) {
  server.listen(CONFIG.port, () => console.log(`SkyMagic → http://localhost:${CONFIG.port}`));
}

module.exports = {
  CONFIG, MERGES, getRaw, buildPayload, gradeOf, colorOf,
  // Exposed 2026-11-09 for tools/score-historical-photo.js — JW wants real
  // computed scores for his calibration photos ("for that day and
  // location, actual score was..."), which means running actual historical
  // weather through the real scoring tree, not approximating it. These let
  // an external script build a faithful ctx and call the same code path
  // buildPayload uses, instead of forking the logic. Deliberately NOT
  // exporting offsetPoint/sunBearing/buildPoints: sunBearing hardcodes
  // Date.now() for the day-of-year (fine for live forecasting within 72h,
  // silently wrong for a photo from a different season/year), so the
  // historical script has its own date-parameterized version instead of
  // reusing these as-is.
  evalMetric, METRIC_TREE, at, localISOtoMs, clamp,
};
