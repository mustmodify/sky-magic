// Shared helper: brightness variance of an image (or a crop of one) as a
// texture proxy — "broken and structured" reads high variance, "flat
// overcast or clear" reads low variance. No image-processing npm deps; shells
// out to ImageMagick (`convert`/`identify`), already on this host, the same
// way the rest of the project shells out to the sqlite3 CLI instead of adding
// a driver dependency.
//
// NOT geolocation-calibrated yet. A crop box here is a pixel rectangle, not a
// lat/lon — see goes-collect.js's own comment for why no per-site crop is
// trusted yet.
const { spawnSync } = require('child_process');

// geometry: ImageMagick crop spec "WxH+X+Y", or null for the whole image.
function textureStats(imgPath, geometry) {
  const args = [imgPath];
  if (geometry) args.push('-crop', geometry, '+repage');
  args.push('-colorspace', 'Gray', '-format', '%[fx:mean] %[fx:standard_deviation]\n', 'info:');
  const r = spawnSync('convert', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`convert: ${r.stderr || r.stdout}`);
  const [mean, stddev] = r.stdout.trim().split('\n')[0].trim().split(/\s+/).map(Number);
  return { mean, stddev };
}

module.exports = { textureStats };
