#!/usr/bin/env node
// Horizon angle probe — how high does the land itself sit in the direction the
// sun rises and sets?
//
// Why this exists: `vantage` in server.js is one static number per site with no
// direction in it, so the model cannot tell that a spot is wide open to the
// west and walled off to the east. Sunrise and sunset colour lives in the
// lowest few degrees of sky, so a ridge only 3-4 degrees up eats the entire
// show while leaving a "great view" completely intact.
//
// Method: sample a DEM along the true solar bearing and take the largest
// elevation angle found. Distances are deliberately packed close-in as well as
// far out, because the blocker is often a neighbouring hill rather than a
// distant ridge.
//
// LIMITS, which are the point of reading the output sceptically:
//   - Copernicus GLO-90 is a ~90 m grid. Anything narrower than that — a single
//     knoll, a treeline, a house, a rooftop — is invisible to it.
//   - It is a terrain model, not a surface model. Mature trees on a near ridge
//     add several degrees that will never appear here.
//   - A near blocker sits between samples more easily than a far one, so
//     under-reporting is the expected failure direction at short range.
// Treat a WIDE OPEN verdict as "terrain does not block it", never as "the view
// is good". A BLOCKED verdict is the trustworthy half: the DEM found real rock.
//
// Usage: node tools/horizon.js            # the sites in server.js CONFIG
//        node tools/horizon.js --json     # machine-readable
//        node tools/horizon.js --site "Name" --lat 35.7 --lon -82.4

const fs = require('fs');
const path = require('path');

const R_EARTH_M = 6371000;
// Standard refraction: light bends toward the earth, so the horizon sits
// slightly lower than geometry alone predicts. 7/6 R is the usual survey
// approximation (k = 0.13).
const R_EFF_M = R_EARTH_M * 7 / 6;
const M_PER_MILE = 1609.344;
const DEG = Math.PI / 180;

// Packed near, spread far. The first few rings are inside or near one DEM cell
// and exist to catch an adjacent hill; beyond ~15 mi haze usually matters more
// than terrain anyway.
const SAMPLE_MILES = [0.06, 0.12, 0.19, 0.28, 0.4, 0.55, 0.75, 1.0, 1.4, 2.0,
                      2.8, 4.0, 5.5, 8.0, 11, 15, 20, 26];

// Solar declination at the three dates that bracket the year. The sunrise and
// sunset bearings swing about +/-30 degrees between solstices at this latitude,
// so a site can be open in June and walled off in December. One number for
// "sunrise" would hide that entirely.
const SEASONS = [
  { key: 'winter', label: 'Dec solstice', decl: -23.44 },
  { key: 'equinox', label: 'Equinox',     decl: 0 },
  { key: 'summer', label: 'Jun solstice', decl: 23.44 },
];

// True bearing of sunrise/sunset at a given declination, for flat-horizon
// geometry. Mirrors sunBearing() in server.js but takes declination directly
// so we can ask about a season instead of today.
function sunBearingDeg(dir, latDeg, declDeg) {
  const cosAz = Math.sin(declDeg * DEG) / Math.cos(latDeg * DEG);
  if (Math.abs(cosAz) > 1) return null;           // circumpolar; not at 35N
  const az = Math.acos(cosAz) / DEG;
  return dir === 'sunrise' ? az : 360 - az;
}

// Great-circle offset. The flat approximation in server.js is fine at 70 mi but
// costs nothing to do properly here.
function destPoint(latDeg, lonDeg, bearingDeg, distM) {
  const d = distM / R_EARTH_M, br = bearingDeg * DEG;
  const lat1 = latDeg * DEG, lon1 = lonDeg * DEG;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
  const lon2 = lon1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1),
                                 Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: +(lat2 / DEG).toFixed(5), lon: +(lon2 / DEG).toFixed(5) };
}

// Apparent elevation angle of a point `distM` away that is `targetM` high,
// seen from an observer at `obsM`. Curvature drop grows with the square of
// distance and is what stops far-off peaks from blocking as much as they look
// like they should.
function elevationAngle(obsM, targetM, distM) {
  const drop = (distM * distM) / (2 * R_EFF_M);
  return Math.atan2(targetM - obsM - drop, distM) / DEG;
}

// Disk cache. The ground does not move, so a coordinate need only ever be
// looked up once — but on 2026-09-07 two sweeps of 57 sites exhausted
// Open-Meteo's hourly quota, which the dashboard shares, and took the live site
// down for the rest of the hour. Re-sweeps must be free.
const ELEV_CACHE = path.join(__dirname, 'elevation-cache.json');
let elevCache = {};
try { elevCache = JSON.parse(fs.readFileSync(ELEV_CACHE, 'utf8')); } catch {}
const ckey = p => `${p.lat},${p.lon}`;

async function elevations(points) {
  const missing = points.filter(p => !(ckey(p) in elevCache));
  if (missing.length) {
    const got = await fetchElevations(missing);
    missing.forEach((p, i) => { elevCache[ckey(p)] = got[i]; });
    try { fs.writeFileSync(ELEV_CACHE, JSON.stringify(elevCache)); } catch {}
  }
  return points.map(p => elevCache[ckey(p)] ?? null);
}

async function fetchElevations(points) {
  const out = [];
  for (let i = 0; i < points.length; i += 100) {           // API caps at 100/req
    const chunk = points.slice(i, i + 100);
    const url = 'https://api.open-meteo.com/v1/elevation'
      + `?latitude=${chunk.map(p => p.lat).join(',')}`
      + `&longitude=${chunk.map(p => p.lon).join(',')}`;
    // Open-Meteo enforces a per-minute cap and a long sweep will trip it, so
    // back off and retry rather than losing the whole run to one 429.
    let j = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const res = await fetch(url, { headers: { 'User-Agent': 'skymagic.app/1.0 (horizon probe)' } });
      if (res.ok) { j = await res.json(); break; }
      if (res.status !== 429) throw new Error(`elevation API ${res.status} ${await res.text().catch(() => '')}`);
      const wait = 20000 * (attempt + 1);
      process.stderr.write(`  rate limited, waiting ${wait / 1000}s\n`);
      await new Promise(r => setTimeout(r, wait));
    }
    if (!j) throw new Error('elevation API: still rate limited after 6 attempts');
    if (!Array.isArray(j.elevation)) throw new Error(`unexpected elevation payload: ${JSON.stringify(j).slice(0, 200)}`);
    out.push(...j.elevation);
    if (i + 100 < points.length) await new Promise(r => setTimeout(r, 1200));  // share the app's quota
  }
  return out;
}

// Verdict bands. Chosen from what the light actually does, not from taste:
// the coloured band at sunrise/sunset is a few degrees deep, so 1 degree of
// rock is survivable, 3 degrees removes most of the good light, and past 5 the
// sun is well up before it clears and the colour is over.
function verdict(angle) {
  if (angle < 1.0) return 'wide open';
  if (angle < 3.0) return 'slightly raised';
  if (angle < 5.0) return 'partly blocked';
  return 'BLOCKED';
}

// --min-miles drops the near field. See the 2026-09-03 validation run: on a
// ~90 m bare-earth DEM the samples inside ~1 mi are dominated by the model's
// own smoothing of the summit you are standing on, not by real terrain.
const MIN_MILES = +( (i => i > -1 ? process.argv[i + 1] : 0)(process.argv.indexOf('--min-miles')) ) || 0;

async function probe(site) {
  const [siteElev] = await elevations([{ lat: site.lat, lon: site.lon }]);
  const plan = [];
  for (const dir of ['sunrise', 'sunset']) {
    for (const season of SEASONS) {
      const bearing = sunBearingDeg(dir, site.lat, season.decl);
      if (bearing == null) continue;
      for (const mi of SAMPLE_MILES.filter(m => m >= MIN_MILES)) {
        const distM = mi * M_PER_MILE;
        plan.push({ dir, season: season.key, bearing, mi, distM, ...destPoint(site.lat, site.lon, bearing, distM) });
      }
    }
  }
  const elevs = await elevations(plan);
  plan.forEach((p, i) => {
    p.elev = elevs[i];
    p.angle = p.elev == null ? null : elevationAngle(siteElev, p.elev, p.distM);
  });

  const result = { site: site.name, id: site.id, lat: site.lat, lon: site.lon, elevationM: siteElev, directions: {} };
  for (const dir of ['sunrise', 'sunset']) {
    const bySeason = {};
    for (const season of SEASONS) {
      const pts = plan.filter(p => p.dir === dir && p.season === season.key && p.angle != null);
      if (!pts.length) continue;
      const worst = pts.reduce((a, b) => (b.angle > a.angle ? b : a));
      bySeason[season.key] = {
        label: season.label,
        bearingDeg: +pts[0].bearing.toFixed(1),
        horizonAngleDeg: +worst.angle.toFixed(2),
        blockerMiles: worst.mi,
        blockerElevM: worst.elev,
        verdict: verdict(worst.angle),
      };
    }
    const angles = Object.values(bySeason).map(s => s.horizonAngleDeg);
    result.directions[dir] = {
      seasons: bySeason,
      // The year's best and worst case. A site whose two ends disagree is a
      // seasonal spot, and that is worth saying out loud rather than averaging.
      bestDeg: Math.min(...angles),
      worstDeg: Math.max(...angles),
      verdict: verdict(Math.max(...angles)),
    };
  }
  return result;
}

function loadSites() {
  const argv = process.argv;
  const flag = n => { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : null; };
  if (flag('--lat')) {
    return [{ id: 'adhoc', name: flag('--site') || 'ad hoc', lat: +flag('--lat'), lon: +flag('--lon') }];
  }
  // FF_LOCAL so the private calibration site is included when run locally —
  // it is the most informative validation case we have.
  process.env.FF_LOCAL = process.env.FF_LOCAL || '1';
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
  const sites = [];
  const re = /\{\s*id:\s*'([^']+)',\s*name:\s*'([^']+)',\s*lat:\s*(-?[\d.]+),\s*lon:\s*(-?[\d.]+)/g;
  let m;
  while ((m = re.exec(src))) sites.push({ id: m[1], name: m[2], lat: +m[3], lon: +m[4] });
  return sites;
}

(async () => {
  const sites = loadSites();
  const results = [];
  for (const s of sites) {
    results.push(await probe(s));
    await new Promise(r => setTimeout(r, 300));
  }
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  for (const r of results) {
    console.log(`\n${r.site}  (${r.lat}, ${r.lon})  ${Math.round(r.elevationM)} m`);
    for (const dir of ['sunrise', 'sunset']) {
      const d = r.directions[dir];
      console.log(`  ${dir.padEnd(8)} ${String(d.worstDeg).padStart(6)}° worst / ${String(d.bestDeg).padStart(6)}° best   ${d.verdict}`);
      for (const k of ['winter', 'equinox', 'summer']) {
        const s = d.seasons[k];
        if (!s) continue;
        console.log(`      ${s.label.padEnd(12)} bearing ${String(s.bearingDeg).padStart(5)}°  horizon ${String(s.horizonAngleDeg).padStart(6)}°  `
          + `blocker ${String(s.blockerMiles).padStart(5)} mi @ ${Math.round(s.blockerElevM)} m  ${s.verdict}`);
      }
    }
  }
  console.log('\nDEM is bare-earth at ~90 m: trees, buildings and narrow knolls are invisible.');
  console.log('"wide open" means terrain does not block it — not that the view is good.');
})().catch(e => { console.error('horizon probe failed:', e.message); process.exit(1); });
