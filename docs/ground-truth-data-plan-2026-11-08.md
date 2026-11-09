# Ground-truth data plan — METAR, satellite texture, sun-azimuth gaps (2026-11-08)

Scoping doc, not yet implemented. JW approved pursuing 1-3 below (via Jarvis,
2026-11-08) and asked to research further afield too. This lays out what each
source actually gives us, how AVL's distance becomes an asset (calibration)
rather than a liability, and what order to build in.

## Why this exists

Root cause from the 2026-11-05 Home miss: every leaf in the tree reads a
forecast-model grid-cell average. A 100% low-cloud reading is honest about
coverage and blind to texture — it can't tell a flat solid deck from a broken,
glowing one. Every source below is either an **observed** reading (not modeled)
or a way to measure **texture directly** instead of inferring it from CAPE.

## 1. METAR sky-condition layers (observed, cheap, nowcast-only)

- Source: aviationweather.gov's JSON API (free, no auth). Returns `sky_condition`
  per station: `FEW`/`SCT`/`BKN`/`OVC` with `cloud_base_ft_agl` per layer, hourly
  (more often when conditions change).
- `BKN` (5-7/8, has gaps) vs `OVC` (8/8, solid) is literally the broken-vs-solid
  read the deck-dynamics gradient/CAPE gate is currently approximating
  indirectly. This is a direct observation of it.
- Nearest station is KAVL (Asheville Regional), ~2200 ft elevation vs. Mitchell
  at 6684 ft — JW's point stands, this is not the same sky and shouldn't be
  scored as if it were.
- **Use for the actual sites**: nowcast corroboration only, same role live
  weather already plays in `detectNoGo` — i.e. in the last 1-3 hours before an
  event, "is KAVL reporting BKN with real gaps while our model says OVC" is a
  sanity check on the model's own confidence, not a forecast input, and should
  carry low weight for exactly the reason JW gave (different microclimate,
  different elevation).

## 2. GOES-19 (GOES-East) satellite imagery (observed, direct texture)

- Source: NOAA NODD program, free, no auth, full-res ABI imagery on AWS/GCP/Azure,
  ~5-10 min cadence, historical archive back years.
- Two implementation options:
  - **Raw pixel approach**: pull a small crop around each site's lat/lon from
    the visible/IR channel, compute brightness variance in that window.
    High variance = broken/textured, low variance = flat. No ML needed for a
    first pass, but it's a crop-and-compute pipeline we'd own and validate
    ourselves.
  - **NOAA's own Level-2 derived products** — "Cloud Top Pressure" (CTP) and
    "Cloud Cover Layers" (CCL) — already computed, already validated by NOAA,
    possibly cheaper to integrate than reinventing variance-from-pixels.
    Worth checking whether CCL's layering (it reports cloud fraction *by
    layer*, not just one areal number) alone closes part of the gap without
    any custom imagery work at all — this might be the highest-leverage,
    lowest-effort piece of this whole plan.
- Either way this is new pipeline work: fetch, crop/parse, cache, probably a
  cron job alongside the existing snapshot collector, mindful of the "shared
  free tier" lesson already in CLAUDE.md (Open-Meteo got knocked over once by
  an unpaced bulk job — this needs its own pacing from day one).

## 3. Sun-azimuth-aware gap detection (depends on 2)

- Once (2) gives real texture/gap location, the next question is JW's own
  framing from 2026-10-16: is the gap *along the sun's azimuth* at the event
  moment, not just "is there a gap somewhere." This needs georeferenced
  satellite data (lat/lon per pixel) plus the existing sun-position calc
  already in `server.js` for departure/alarm timing — the azimuth math exists,
  it just has nothing angularly-resolved to apply it to yet. Not startable
  before (2) has real pixel-to-ground mapping working.

## The AVL idea: calibration target, not a site proxy

JW's framing, which is the right one: AVL's sky is too different from any
real site to use directly, but AVL is the one place we *can* get an observed
ground truth (METAR BKN/OVC/base-height) **and** satellite coverage at the same
time. That makes AVL the calibration site for the method itself:

- Pull GOES texture (2) over KAVL's coordinates for as long a window as we can
  backfill, alongside METAR history for KAVL over the same window.
- Check: does satellite-pixel-variance actually predict observed BKN vs OVC at
  KAVL, and by how much, and with what lag/noise?
- If that correlation holds, we have evidence the *method* (variance → broken
  vs solid) works in general, which we can then trust applying to Home/Craggy/
  Mitchell even though none of them have their own METAR to check against
  directly. If it doesn't hold, we've learned that before trusting it on a
  real forecast, not after.
- This also gives a genuinely free, continuously-refreshing validation set —
  no need to wait for more JW photos to accumulate a sample.

## Other candidates found, roughly in order of promise

- **GOES GLM lightning data** (free, same NODD pipeline as ABI) — a real
  corroborator for the existing CAPE-towers signal: a scored "convective
  towers" read with actual lightning strikes nearby is a much stronger signal
  than CAPE alone, and lightning is unambiguous ground truth, not a model
  inference.
- **SunsetWx's published methodology** (US patent 10,459,119 + public writeups)
  — not a data source we can pull from, but worth noting their approach
  independently converged on "weight thin upper clouds heaviest, penalize
  thick low cloud" — validates the existing tree's general shape — and they
  explicitly flag aerosol/smoke data as something they wished they had more
  of, which we already have via CAMS AOD. Useful as a sanity check on
  direction, not a new integration.
- **NEXRAD radar** — turns out to be the wrong tool for this specific gap:
  it's built for precipitation, and clear-air/thin-cloud returns are weak or
  absent, so it won't see the kind of broken dry deck in the 11/05 miss. It
  could still be useful for a different, already-solved problem: corroborating
  an active-precipitation no-go (the existing fog/dew-spread check) with an
  actual reflectivity return, rather than inferring "there's rain in the way"
  from model fields alone. Parking this as a separate, lower-priority idea.
- **RAWS (fire-weather) network** — searched specifically for a station closer
  to Mitchell/Craggy than KAVL; nothing confirmed at useful elevation near
  these exact peaks. Worth one more targeted look (NIFC's RAWS station list is
  queryable) before ruling it out, but not promising enough to block on.
- **Mount Mitchell State Park's own weather station** (run by NC High Peaks
  Trail Association, nchighpeaks.org) — real station, real elevation, right
  location, but it's a volunteer-run station of unknown API/reliability. If it
  has any kind of sky-condition or even just a public webcam, that's closer
  ground truth than KAVL will ever be for the one site that matters most
  (Mitchell is the highest, most isolated-microclimate site). Worth JW
  checking if he knows anyone involved, or just trying the site's data feed
  directly — flagging rather than pursuing myself since it's a small,
  possibly-informal source that'd need hand-verification either way.

## More candidates, added after JW's follow-up (webcams, home station, NOAA narratives, volcanic aerosols)

- **Public webcams.** nchighpeaks.org (Mount Mitchell) already surfaced above
  under RAWS. Also worth checking: NCDOT traffic cams along the Parkway (often
  posted for road conditions, not sky, but still show the horizon), and
  regional ski-resort cams (Beech/Sugar Mountain, higher elevation than KAVL,
  closer microclimate to Mitchell/Craggy than Asheville's airport). None of
  these are structured data — would need a fetch + crop + maybe the same
  variance trick as GOES (2), just at much higher resolution and much lower
  cost since there's no satellite pipeline involved. Good candidate for an
  early, cheap trial of the "measure texture directly" idea before building
  the full GOES pipeline.
- **Home weather station data.** If JW has his own station (or wants one) at
  the actual Home coordinate, that's literally ground truth at the exact site
  with zero model-grid averaging — strongest possible signal for Home
  specifically, but obviously only covers one of the three real sites. Worth
  asking directly whether he has one already (Ambient Weather, Tempest, etc.
  all have free APIs) before assuming it needs to be built.
- **NOAA Area Forecast Discussions (AFD).** Free text product from the local
  NWS office (GSP covers this area), issued ~4x/day. Written by a human
  forecaster in plain language, often states cloud-trend confidence explicitly
  ("models disagree on timing of clearing," "expect breaks developing by
  evening") in a way no single model field does. Not structured data — would
  need text parsing/keyword extraction, maybe a good target for an LLM-based
  signal (summarize the AFD's cloud-confidence into a number) rather than
  hand-written parsing rules. Flagging as an idea, not scoping it further yet.
- **Volcanic stratospheric aerosols (JW's question).** Real effect, not
  folklore: major eruptions put SO2 into the stratosphere, which converts to
  sulfate aerosol that scatters light and boosts sunset/sunrise vibrancy
  worldwide for weeks to months afterward (Pinatubo 1991 is the textbook case;
  Hunga Tonga 2022 and smaller Kamchatka/Alaska eruptions since are more
  recent examples). Measurable via NASA's OMPS Limb Profiler (tracks
  stratospheric aerosol by altitude post-eruption) and the Smithsonian Global
  Volcanism Program's weekly narrative eruption report (easiest "is anything
  active right now" check). Important distinction: this is a slow background
  signal (weeks/months), not a nightly one — on an active-plume night every
  sunset everywhere gets a boost, so it'd be a seasonal flag/multiplier, not a
  per-event leaf. Low priority relative to 1-3 above (rare, slow-changing,
  CAMS AOD already captures some tropospheric aerosol contribution) but cheap
  to add as a standing "any major eruption active" check against the GVP feed.

## Combining multiple signals for the same thing (JW, 2026-11-08)

Once 2+ of these sources read on the same question (e.g. "is this deck broken
or solid," read by GOES texture, a webcam crop, and METAR BKN/OVC all at
once), don't default to averaging. JW's framing: there isn't one right
combiner — pick whichever fits the evidence, possibly different ones for
different questions:

- **worst-of** (min) — right when any one source catching a problem should
  dominate (the existing `access`/`vantage` cap logic already works this way).
- **best-of** (max) — right when sources mostly under-report and any one
  catching the real structure should win (this is the already-approved fix to
  Clouds' cirrus/low/mid blend, 2026-10-22).
- **plain average/weighted** — right when sources are independently noisy
  estimates of the same continuous thing and errors are expected to cancel.
- **conditional / threshold switch** — e.g. "trust METAR's BKN/OVC over the
  model's coverage number only when they disagree by more than N," or "below
  5% model coverage, use the model; above it, defer to the satellite read" —
  right when one source is known to be unreliable only in a specific regime.

This is the same question the root-merge recalibration proposal is already
sitting on (JW, 2026-11-07), and the answer should come from looking at where
each source agrees/disagrees once there's real data, not from guessing a
combiner up front. Build the collectors first, log them side by side, then
pick (or mix) combiners per question with real disagreement data in hand.

## Proposed build order

1. METAR ingestion (KAVL to start) as a logged, non-scoring side channel —
   cheapest, fastest, and gives us the first real BKN/OVC observations to
   start comparing against model output immediately, before any satellite
   work is ready.
2. GOES Level-2 CCL/CTP products over KAVL + the three real sites, logged
   alongside (1) — check whether NOAA's own derived layering already helps
   before building custom pixel-variance code.
3. If (2)'s off-the-shelf products aren't enough, build the raw pixel-variance
   crop pipeline, calibrated against the KAVL METAR history from (1).
4. Sun-azimuth gap detection, once (3) or (2) gives georeferenced texture.
5. Camera + vision model (JW's #4) — his call on timing, orthogonal to the
   above.

Nothing here is wired into scoring yet. Per the same discipline as the
root-merge recalibration proposal: build the data pipeline and the calibration
correlation first, show JW what it actually says, then decide what (if
anything) feeds into a leaf or the no-go logic.
