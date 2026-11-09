// Serves the ground-truth collectors' data to the dashboard's "Data" panel —
// read-only, queries data/ground-truth.db directly. None of this feeds
// scoring yet (see docs/ground-truth-data-plan-2026-11-08.md); each source's
// `analysis` is explicit about that, and says what it WOULD mean if it were
// wired in, using the latest row actually collected.
const { q, n, rows } = require('./db');

const SOURCES = [
  { id: 'metar', name: 'METAR (airport sky observations)', table: 'metar_obs', options: [
    { id: 'KAVL', label: 'Asheville Regional (KAVL, 2120 ft)' },
    { id: 'KTNB', label: 'Boone/Watauga Med Center (KTNB, 3140 ft)' },
  ] },
  { id: 'afd', name: 'NOAA Area Forecast Discussion', table: 'afd_products', options: [{ id: 'GSP', label: 'Greenville-Spartanburg office' }] },
  { id: 'goes', name: 'GOES-19 satellite imagery', table: 'goes_obs', options: [
    { id: 'GEOCOLOR', label: 'GeoColor (true-color-ish, day only)' },
    { id: 'DayNightCloudMicroCombo', label: 'Day/Night Cloud Microphysics (fog-sensitive, works at night)' },
  ] },
  { id: 'webcam', name: 'Public webcam (sky texture)', table: 'webcam_obs', options: [{ id: 'mitchell-blueknob', label: 'Black Mountain Range cam (Blue Knob → Mitchell)' }] },
  { id: 'volcano', name: 'Volcanic ash advisories', table: 'volcano_obs', options: [{ id: 'global', label: 'Worldwide (VAAC SIGMETs)' }] },
  { id: 'cwop', name: 'CWOP station (dew-point/fog proxy)', table: 'cwop_obs', options: [
    { id: 'FW8293', label: 'Crooked Creek (1663m/5456ft)' },
    { id: 'FW8600', label: 'Sugar Hill FD 2 (1545m/5069ft)' },
  ] },
  { id: 'mitc', name: 'CLOUDS API (NC State Climate Office)', table: 'clouds_api_obs', options: [
    { id: 'MITC', label: 'Mount Mitchell State Park, ECONet (1894m/6215ft, ~1km from the real site)' },
    { id: 'BSKN7', label: 'Busick, RAWS (927m/3041ft, 9.3mi from Craggy)' },
  ] },
];

function listSources() {
  return SOURCES.map(({ id, name, options }) => ({ id, name, options }));
}

function safeRows(query) {
  try { return rows(query); } catch { return []; } // table may not exist yet if that collector hasn't run
}

function textureNote(stddev) {
  if (stddev == null) return 'no reading';
  if (stddev < 0.08) return 'very flat — reads as uniform (solid overcast or clear)';
  if (stddev < 0.18) return 'some texture';
  return 'strongly textured — reads as broken/structured sky';
}

function metarData(station = 'KAVL') {
  const raw = safeRows(`SELECT station, obs_ms, cover, clouds_json, flight_cat, raw FROM metar_obs WHERE station=${q(station)} ORDER BY obs_ms DESC LIMIT 20`);
  const latest = raw[0];
  const elevNote = station === 'KTNB' ? "~3140 ft — closer to the real sites' elevation than KAVL, but still 2000+ ft below Craggy/Mitchell" : "2120 ft, 1000+ ft lower and a different microclimate from any real site (JW's own point, 2026-11-08)";
  const analysis = !latest
    ? 'No observations collected yet.'
    : `${station} is NOT one of the three scored sites — ${elevNote} — so this never overrides a site score directly. ` +
      `Latest: ${latest.cover ?? '(cover unreported)'}${latest.clouds_json !== '[]' ? ' ' + JSON.parse(latest.clouds_json).map(c => c.base_ft ? `${c.cover}@${c.base_ft}ft` : c.cover).join(' ') : ''} at ${new Date(latest.obs_ms).toISOString()}. ` +
      `Intended use: a nowcast sanity check in the hours before an event — if this station reports real gaps (BKN) while a site's model coverage says solid 100%, that's the same mismatch pattern as the 2026-11-05 Home miss, and would argue for treating a near-term no-go as a gamble rather than a hard F.`;
  return { raw, analysis };
}

function afdData() {
  const raw = safeRows(`SELECT product_id, issuance_ms, cloud_keywords, substr(text,1,4000) as text FROM afd_products ORDER BY issuance_ms DESC LIMIT 10`);
  const latest = raw[0];
  const analysis = !latest
    ? 'No issuances collected yet.'
    : `Not a sensor reading — a human forecaster's synthesis of models + current obs, in prose. No parser here turns it into a number, so it can't feed scoring as-is. ` +
      `Latest issuance (${new Date(latest.issuance_ms).toISOString()}) keyword hits: ${latest.cloud_keywords || '(none)'}. ` +
      `Read it directly for confidence language ("models disagree," "breaks developing") before trusting a borderline near-term call — that kind of hedge is exactly the information the numeric tree can't carry.`;
  return { raw, analysis };
}

function goesData(product = 'GEOCOLOR') {
  const raw = safeRows(`SELECT sector, product, frame_ms, mean_gray, stddev_gray, file_path FROM goes_obs WHERE product=${q(product)} ORDER BY frame_ms DESC LIMIT 20`);
  const latest = raw[0];
  const productNote = product === 'DayNightCloudMicroCombo'
    ? 'CIRA\'s day-adapted Nighttime Microphysics RGB — separates fog/stratus from thicker cloud and thin cirrus, and keeps working after dark (unlike GeoColor, which goes to city-lights-only at night).'
    : 'true-color-ish composite, most readable in daylight; at night it falls back to a static city-lights basemap that is NOT live data (confirmed 2026-11-08 — don\'t read night-time GeoColor brightness as a live signal).';
  const analysis = !latest
    ? 'No frames collected yet.'
    : `NOT geolocated to any site — whole-sector brightness variance only. Two calibration attempts failed (no documented sector bounds anywhere reachable, and an empirical landmark fit missed by ~57km) — see docs/ground-truth-data-plan-2026-11-08.md and the chat log, 2026-11-08. On top of that, JW's own RAMMB-SLIDER screenshot showed under a dozen native pixels covering ~13km of terrain, while Mitchell/Craggy/Green Knob sit only 10-15km apart — likely too close together for this product to ever separate them, independent of calibration. ${productNote} ` +
      `Latest frame (${new Date(latest.frame_ms).toISOString()}): stddev ${latest.stddev_gray?.toFixed(4)} — regionally ${textureNote(latest.stddev_gray)}. ` +
      `Usable only as a REGIONAL flag (is the broader area textured/broken vs. flat/clear at all), never a per-site read.`;
  return { raw, analysis };
}

function webcamData() {
  const raw = safeRows(`SELECT cam, frame_ms, mean_gray, stddev_gray, sky_mean_gray, sky_stddev_gray, file_path FROM webcam_obs ORDER BY frame_ms DESC LIMIT 20`);
  const latest = raw[0];
  const analysis = !latest
    ? 'No frames collected yet.'
    : `Direct camera view of the sky toward Mitchell/Craggy — sky-band crop only (top 170px of the frame; the rest is trees/ridge, excluded). ` +
      `Latest frame (${new Date(latest.frame_ms).toISOString()}): sky stddev ${latest.sky_stddev_gray?.toFixed(4)} — ${textureNote(latest.sky_stddev_gray)}. ` +
      `If wired in, a high stddev here while a site's model-based cloud leaf reads uniform/flat would be the strongest available real-time evidence of exactly the "broken deck the model can't see" problem from the 2026-11-05 Home miss — stronger than the CAPE-texture proxy deckDynamics currently uses, because it's a direct look, not an inference.`;
  return { raw, analysis };
}

function volcanoData() {
  const raw = safeRows(`SELECT advisory_id, qualifier, valid_from, valid_to FROM volcano_obs ORDER BY valid_from DESC LIMIT 30`);
  const activeNow = raw.filter(r => r.valid_to > Date.now());
  const analysis = !raw.length
    ? 'No advisories collected yet.'
    : `${activeNow.length} active volcanic-ash advisor${activeNow.length === 1 ? 'y' : 'ies'} worldwide right now: ${activeNow.map(r => r.qualifier).join('; ') || '(none)'}. ` +
      `This is a coarse proxy (aviation ash-plume advisories, not a stratospheric-aerosol-loading measurement) for "is a major eruption boosting sunsets globally right now." None of the current advisories are large enough to be that kind of event — ordinary background volcanic activity. Would only matter as a slow, weeks-to-months-long seasonal flag, not a nightly signal, even if wired in.`;
  return { raw, analysis };
}

// LCL height AGL (meters) ≈ 125 × (T - Td) in °C — standard meteorological
// approximation (Espy's equation). Added these elevations have to be
// verified, not guessed — see CLAUDE.md "A hard-won habit" — so these are
// copied directly from CONFIG.sites in server.js, not re-derived.
const STATION_ELEV_M = { FW8293: 1663, FW8600: 1545 };
const REAL_SITES_M = { mitchell: 2014, craggy: 1766, greenknob: 1499 };

function estimateCloudBase(stationElevM, tempF, dewpointF) {
  const spreadC = ((tempF - dewpointF) * 5) / 9;
  const lclAglM = 125 * spreadC;
  const cloudBaseMslM = stationElevM + lclAglM;
  return { spreadC, lclAglM, cloudBaseMslM };
}

function cwopData(station = 'FW8293') {
  const raw = safeRows(`SELECT station, obs_ms, temp_f, humidity, dewpoint_f, wind_dir, wind_mph, baro_mb FROM cwop_obs WHERE station=${q(station)} ORDER BY obs_ms DESC LIMIT 30`);
  const latest = raw[0];
  const elevNote = station === 'FW8293' ? '1663m/5456ft, 16km from Green Knob' : '1545m/5069ft, 17km from Green Knob';
  const analysis = !latest
    ? 'No observations collected yet.'
    : (() => {
        const spread = latest.temp_f - latest.dewpoint_f;
        const read = spread < 2 ? 'near-zero spread — consistent with fog/cloud at the station\'s own elevation right now' : spread < 5 ? 'small spread — damp, possibly in or near cloud base' : 'clear spread — station is not in cloud';
        const stationElevM = STATION_ELEV_M[station];
        const { lclAglM, cloudBaseMslM } = estimateCloudBase(stationElevM, latest.temp_f, latest.dewpoint_f);
        const siteCompare = Object.entries(REAL_SITES_M)
          .map(([site, elevM]) => `${site} ${elevM}m: ${cloudBaseMslM <= elevM ? 'likely IN cloud' : `clear by ~${Math.round(cloudBaseMslM - elevM)}m`}`)
          .join(', ');
        return `${station} (${elevNote}) — no cloud-cover field exists in CWOP data, so this can only ever be a dew-point/fog proxy, not a direct sky read. ` +
          `Latest: temp ${latest.temp_f}F, dewpoint ${latest.dewpoint_f?.toFixed(1)}F, spread ${spread.toFixed(1)}F at ${new Date(latest.obs_ms).toISOString()} — ${read}. ` +
          `Estimated cloud base (Espy's equation, LCL AGL ≈ 125m × spread°C): ${Math.round(lclAglM)}m AGL → ~${Math.round(cloudBaseMslM)}m MSL. Compared to the three real sites: ${siteCompare}. ` +
          `This is a rough estimate (assumes a well-mixed boundary layer, no inversion) from ONE off-site station — treat it as a directional flag, not a precise forecast. ` +
          `Intended use: the same test as detectNoGo's "Possibly in cloud at the summit" check (server.js, 2026-10-16), but run at a station much closer in elevation to Craggy/Green Knob than KAVL or KTNB.`;
      })();
  return { raw, analysis };
}

const CLOUDS_API_ELEV_M = { MITC: 1894, BSKN7: 927 };
const CLOUDS_API_NOTES = {
  MITC: "1894m/6215ft, ~1km from the real 'mitchell' site — by far the closest ground-truth station of anything built this session",
  BSKN7: "927m/3041ft (RAWS, hourly), 9.3mi from Craggy — resolves the RAWS access gap from 2026-11-08 (raws.dri.edu/wrcc.dri.edu were unreachable); same data, working channel. CAUTION: 9 miles is far in this terrain — the 839m/2753ft elevation gap to Craggy likely matters more than the horizontal distance (unconfirmed working hypothesis, not a settled rule). A valley station can sit under an inversion/fog layer while a ridge 800m+ higher is clear, or the reverse. Treat this as its own data point, not a stand-in for the real sites",
};

function mitcData(location = 'MITC') {
  const raw = safeRows(`SELECT obs_ms, temp_f, dewpoint_f, humidity FROM clouds_api_obs WHERE location=${q(location)} ORDER BY obs_ms DESC LIMIT 30`);
  const latest = raw[0];
  const elevM = CLOUDS_API_ELEV_M[location];
  const analysis = !latest
    ? 'No observations collected yet.'
    : (() => {
        const spread = latest.temp_f - latest.dewpoint_f;
        const read = spread < 2 ? 'near-zero spread — likely IN cloud/fog right now' : spread < 5 ? 'small spread — damp, possibly in or near cloud base at the station itself' : 'clear spread — the station itself is not in cloud';
        const { lclAglM, cloudBaseMslM } = estimateCloudBase(elevM, latest.temp_f, latest.dewpoint_f);
        const siteCompare = Object.entries(REAL_SITES_M)
          .map(([site, siteElevM]) => `${site} ${siteElevM}m: ${cloudBaseMslM <= siteElevM ? 'likely IN cloud' : `clear by ~${Math.round(cloudBaseMslM - siteElevM)}m`}`)
          .join(', ');
        return `${location} (${CLOUDS_API_NOTES[location]}) — no cloud-cover field here either, just temp/RH/dewpoint. ` +
          `Latest: temp ${latest.temp_f}F, dewpoint ${latest.dewpoint_f}F, spread ${spread.toFixed(1)}F, RH ${latest.humidity}% at ${new Date(latest.obs_ms).toISOString()} — ${read}. ` +
          `Estimated cloud base (Espy's equation, same method as the CWOP source): ${Math.round(lclAglM)}m AGL → ~${Math.round(cloudBaseMslM)}m MSL. Compared to the three real sites: ${siteCompare}. ` +
          `Intended use: a candidate for the "Possibly in cloud at the summit" check (server.js, 2026-10-16)${location === 'MITC' ? ' — the strongest one built this session, since MITC sits only ~120m below Mitchell\'s own summit and needs minimal projection' : ''}.`;
      })();
  return { raw, analysis };
}

const HANDLERS = { metar: metarData, afd: afdData, goes: goesData, webcam: webcamData, volcano: volcanoData, cwop: cwopData, mitc: mitcData };

function getSourceData(sourceId, optionId) {
  const fn = HANDLERS[sourceId];
  if (!fn) return null;
  return optionId ? fn(optionId) : fn();
}

module.exports = { listSources, getSourceData };
