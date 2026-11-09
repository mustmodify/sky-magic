#!/usr/bin/env node
// Ground truth, source: public webcam snapshots (observed, highest-res, free).
//
//   node ground-truth/webcam-collect.js record
//   node ground-truth/webcam-collect.js report --days=3
//
// NC High Peaks' Black Mountain Range cam looks SE from Blue Knob toward
// Mount Mitchell and Green Knob — a direct camera view, not a satellite grid
// cell, of the sky that matters for two of the three real sites. Checked the
// first archived frame (2026-11-07) by eye: it's 1920x1080, ridgeline/trees
// fill the bottom ~85%, so only the top ~170px is clear sky — SKY_CROP below
// reflects that, not a guess. Re-check it occasionally; the cam's framing
// could change. Still just texture/variance for now, not object/cloud-shape
// detection — see docs/ground-truth-data-plan-2026-11-08.md.
const SKY_CROP = '1920x170+0+0';
//
// The page lists the current frame's filename, which changes every refresh,
// so each run re-reads the listing page to find today's actual image path
// before downloading it.
const fs = require('fs');
const path = require('path');
const { q, n, sql, rows } = require('./db');
const { textureStats } = require('./image-texture');

const UA = 'Mozilla/5.0 (skymagic.app ground-truth research, jw@earlyasset.com)';
const SLIDESHOW_URL = 'https://www.nchighpeaks.org/cam/slideshow.php';
const ARCHIVE_DIR = path.join(__dirname, '..', 'data', 'webcam-archive');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS webcam_obs (
  cam           TEXT    NOT NULL,
  frame_ms      INTEGER NOT NULL,  -- parsed from the filename's own timestamp
  fetched_ms    INTEGER NOT NULL,
  file_path     TEXT    NOT NULL,
  mean_gray     REAL,              -- whole frame, mostly trees/ridge — reference only
  stddev_gray   REAL,
  sky_mean_gray   REAL,            -- SKY_CROP band only — the actual signal
  sky_stddev_gray REAL,
  PRIMARY KEY (cam, frame_ms)
);
`;

async function latestFrameUrl() {
  const res = await fetch(SLIDESHOW_URL, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`slideshow page: HTTP ${res.status}`);
  const html = await res.text();
  // e.g. src="./192.168.1.112_01_20261107183054_TIMING.jpg"
  const m = html.match(/src="\.?\/?([\w.]+_(\d{14})_[A-Z]+\.jpg)"/);
  if (!m) throw new Error('could not find a frame filename on the slideshow page');
  const [, filename, stamp] = m;
  // stamp: YYYYMMDDHHMMSS, local to the camera — treat as US/Eastern, same TZ
  // as the rest of this project's events (server.js CONFIG.timezone).
  const y = +stamp.slice(0, 4), mo = +stamp.slice(4, 6), d = +stamp.slice(6, 8);
  const h = +stamp.slice(8, 10), mi = +stamp.slice(10, 12), s = +stamp.slice(12, 14);
  // Rough UTC conversion (EST/EDT, +5/+4h) — good enough for a texture
  // timestamp; not used for anything that needs exact precision.
  const offsetH = isDST(y, mo, d) ? 4 : 5;
  const frameMs = Date.UTC(y, mo - 1, d, h + offsetH, mi, s);
  return { url: new URL(filename, SLIDESHOW_URL).href, frameMs, filename };
}

// DST in the US: second Sunday of March through first Sunday of November.
function isDST(y, mo, d) {
  if (mo < 3 || mo > 11) return false;
  if (mo > 3 && mo < 11) return true;
  const firstOfMonth = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay();
  if (mo === 3) { const secondSunday = 1 + ((7 - firstOfMonth) % 7) + 7; return d >= secondSunday; }
  const firstSunday = 1 + ((7 - firstOfMonth) % 7);
  return d < firstSunday;
}

async function record() {
  sql(SCHEMA);
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const { url, frameMs, filename } = await latestFrameUrl();
  const existing = rows(`SELECT 1 FROM webcam_obs WHERE cam='mitchell-blueknob' AND frame_ms=${n(frameMs)}`);
  if (existing.length) return console.log(`mitchell-blueknob: already have frame ${new Date(frameMs).toISOString()}`);

  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`frame fetch: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const localPath = path.join(ARCHIVE_DIR, `mitchell-blueknob_${frameMs}.jpg`);
  fs.writeFileSync(localPath, buf);

  let stats, skyStats;
  try { stats = textureStats(localPath, null); }
  catch (err) { console.error(`texture calc failed: ${err.message}`); stats = { mean: null, stddev: null }; }
  try { skyStats = textureStats(localPath, SKY_CROP); }
  catch (err) { console.error(`sky-crop texture calc failed: ${err.message}`); skyStats = { mean: null, stddev: null }; }

  const fetchedMs = Date.now();
  sql(
    `INSERT INTO webcam_obs (cam, frame_ms, fetched_ms, file_path, mean_gray, stddev_gray, sky_mean_gray, sky_stddev_gray) VALUES (` +
    [q('mitchell-blueknob'), n(frameMs), n(fetchedMs), q(localPath), n(stats.mean), n(stats.stddev), n(skyStats.mean), n(skyStats.stddev)].join(', ') +
    `);`
  );
  console.log(`mitchell-blueknob: frame ${filename} (${new Date(frameMs).toISOString()}) sky mean=${skyStats.mean} stddev=${skyStats.stddev} (whole-frame mean=${stats.mean} stddev=${stats.stddev})`);
}

function report(opts) {
  const since = Date.now() - (opts.days || 3) * 86400000;
  const obs = rows(`SELECT frame_ms, sky_mean_gray, sky_stddev_gray FROM webcam_obs WHERE cam='mitchell-blueknob' AND frame_ms > ${n(since)} ORDER BY frame_ms`);
  if (!obs.length) return console.log(`No webcam rows in the last ${opts.days || 3} day(s). Run 'record' first.`);
  console.log(`\nmitchell-blueknob — ${obs.length} frame(s)\n`);
  for (const o of obs) console.log(`  ${new Date(o.frame_ms).toISOString().slice(0, 16)}  sky mean=${o.sky_mean_gray?.toFixed(4)}  stddev=${o.sky_stddev_gray?.toFixed(4)}`);
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
