#!/usr/bin/env node
// Ground truth, source: GOES-19 (GOES-East) sector quicklooks, two products
// (observed, ~5-10 min cadence, free, no auth — NOAA STAR CDN).
//
//   node ground-truth/goes-collect.js record
//   node ground-truth/goes-collect.js report --product=GEOCOLOR --days=3
//
// NOT geolocation-calibrated to Home/Craggy/Mitchell. Two real attempts at a
// per-site crop both failed: (1) STAR documents no bounding box/projection
// for this sector anywhere reachable (checked STAR's own pages and
// RAMMB-SLIDER), and (2) an empirical landmark calibration (ABI fixed-grid
// math + 2 coastline points, held out a 3rd to validate) missed by 95px
// (~57km) — see chat log 2026-11-08. On top of that, JW's own screenshot of
// RAMMB-SLIDER at the real zoom level showed under a dozen native pixels
// covering ~13km of terrain — Mitchell/Craggy/Green Knob are only 10-15km
// apart, closer together than this product's own effective resolution, so
// per-site differentiation may not be achievable from this product at all,
// independent of calibration precision. Guessing a crop box here would also
// repeat the exact mistake this project got burned by twice already
// (greenknob and home both had wrong coordinates silently feeding real
// scores — see CLAUDE.md, "A hard-won habit"). So: archive full frames +
// whole-image texture only, as a REGIONAL signal, not a per-site one.
//
// PRODUCTS: GEOCOLOR (true-color-ish, day only — goes dark/city-lights-only
// at night) and DayNightCloudMicroCombo (CIRA's day-adapted Nighttime
// Microphysics RGB — separates fog/stratus from thicker cloud and thin
// cirrus, and unlike GEOCOLOR it actually works at night). Both confirmed
// live on the same CDN path pattern; other candidates probed the same way
// (AirMass, Sandwich, FireTemperature exist too; NightMicrophysics,
// DayCloudPhase, DustDebra, DaySnowFog, SplitWindowDifference, GLM do not
// under these exact names on this CDN — 404s, not fetched).
const fs = require('fs');
const path = require('path');
const { q, n, sql, rows } = require('./db');
const { textureStats } = require('./image-texture');

const UA = 'skymagic.app/1.0 ground-truth research (jw@earlyasset.com)';
const SECTOR = process.env.FF_GOES_SECTOR || 'se'; // southeast CONUS sector, covers western NC
const PRODUCTS = (process.env.FF_GOES_PRODUCTS || 'GEOCOLOR,DayNightCloudMicroCombo').split(',');
const ARCHIVE_DIR = path.join(__dirname, '..', 'data', 'goes-archive');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS goes_obs (
  sector      TEXT    NOT NULL,
  product     TEXT    NOT NULL,
  frame_ms    INTEGER NOT NULL,  -- from the CDN's Last-Modified header
  fetched_ms  INTEGER NOT NULL,
  file_path   TEXT    NOT NULL,
  mean_gray   REAL,
  stddev_gray REAL,
  PRIMARY KEY (sector, product, frame_ms)
);
`;

// One-time migration: the original table (pre-2026-11-09) had no `product`
// column and a (sector, frame_ms) primary key — every row in it is GEOCOLOR.
// Rebuild rather than ALTER, since SQLite can't change a primary key in place.
function migrate() {
  const cols = rows(`PRAGMA table_info(goes_obs)`).map(c => c.name);
  if (!cols.length || cols.includes('product')) return;
  sql(`
    CREATE TABLE goes_obs_migrated (
      sector TEXT NOT NULL, product TEXT NOT NULL, frame_ms INTEGER NOT NULL,
      fetched_ms INTEGER NOT NULL, file_path TEXT NOT NULL, mean_gray REAL, stddev_gray REAL,
      PRIMARY KEY (sector, product, frame_ms)
    );
    INSERT INTO goes_obs_migrated (sector, product, frame_ms, fetched_ms, file_path, mean_gray, stddev_gray)
      SELECT sector, 'GEOCOLOR', frame_ms, fetched_ms, file_path, mean_gray, stddev_gray FROM goes_obs;
    DROP TABLE goes_obs;
    ALTER TABLE goes_obs_migrated RENAME TO goes_obs;
  `);
  console.log('migrated goes_obs to the multi-product schema (existing rows tagged GEOCOLOR)');
}

async function recordProduct(product) {
  const url = `https://cdn.star.nesdis.noaa.gov/GOES19/ABI/SECTOR/${SECTOR}/${product}/latest.jpg`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${product}: HTTP ${res.status}`);
  const lastMod = res.headers.get('last-modified');
  const frameMs = lastMod ? new Date(lastMod).getTime() : Date.now();
  const existing = rows(`SELECT 1 FROM goes_obs WHERE sector=${q(SECTOR)} AND product=${q(product)} AND frame_ms=${n(frameMs)}`);
  if (existing.length) { console.log(`${product}: already have frame ${new Date(frameMs).toISOString()}`); return; }

  const buf = Buffer.from(await res.arrayBuffer());
  const localPath = path.join(ARCHIVE_DIR, `${SECTOR}_${product}_${frameMs}.jpg`);
  fs.writeFileSync(localPath, buf);

  let stats;
  try { stats = textureStats(localPath, null); }
  catch (err) { console.error(`${product}: texture calc failed: ${err.message}`); stats = { mean: null, stddev: null }; }

  const fetchedMs = Date.now();
  sql(
    `INSERT INTO goes_obs (sector, product, frame_ms, fetched_ms, file_path, mean_gray, stddev_gray) VALUES (` +
    [q(SECTOR), q(product), n(frameMs), n(fetchedMs), q(localPath), n(stats.mean), n(stats.stddev)].join(', ') +
    `);`
  );
  console.log(`${product}: frame ${new Date(frameMs).toISOString()} whole-image mean=${stats.mean} stddev=${stats.stddev}`);
}

async function record() {
  sql(SCHEMA);
  migrate();
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  for (const product of PRODUCTS) {
    try { await recordProduct(product); }
    catch (err) { console.error(err.message); }
  }
}

function report(opts) {
  const product = opts.product || PRODUCTS[0];
  const since = Date.now() - (opts.days || 3) * 86400000;
  const obs = rows(`SELECT frame_ms, mean_gray, stddev_gray FROM goes_obs WHERE sector=${q(SECTOR)} AND product=${q(product)} AND frame_ms > ${n(since)} ORDER BY frame_ms`);
  if (!obs.length) return console.log(`No GOES rows for ${SECTOR}/${product} in the last ${opts.days || 3} day(s). Run 'record' first.`);
  console.log(`\nGOES-19 sector ${SECTOR}, product ${product} — ${obs.length} frame(s)\n`);
  for (const o of obs) console.log(`  ${new Date(o.frame_ms).toISOString().slice(0, 16)}  mean=${o.mean_gray?.toFixed(4)}  stddev=${o.stddev_gray?.toFixed(4)}`);
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
