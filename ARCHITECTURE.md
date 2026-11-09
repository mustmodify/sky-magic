# Architecture

This document describes the codebase at a structural level: what the pieces
are, where responsibilities live, and the invariants that hold the design
together. For the goal and how to run, see [README.md](README.md). For why the
scoring curves look the way they do, see [HISTORY.md](HISTORY.md).

## Bird's-eye view

Focus Forecast answers one question: **for each sunrise and sunset in the next
72 hours, at each of a fixed list of Blue Ridge photography sites, how likely
is a photogenic sky — and when do I have to leave the house?**

```
Open-Meteo forecast API  ─┐
Open-Meteo multi-model    ├─► fetchAll() ─► raw cache (15 min) ─► buildPayload()
Open-Meteo air quality    │                                          │
OpenWeather air pollution │                                          ▼
NPS road-closures page   ─┘                              evalMetric(METRIC_TREE)
                                                         per (event × site)
                                                                     │
                                                                     ▼
        public/index.html  ◄──  GET /api/forecast  ◄──  events → sites → tree
```

Everything lives in two files:

| File | Role |
|---|---|
| `server.js` | Config, data fetching, the metric tree, scoring, HTTP server. No dependencies; Node 18+ (built-in `fetch`). Exports `{ CONFIG, getRaw, buildPayload, … }` and only listens when run directly. |
| `public/index.html` | The dashboard. Inline CSS/JS, renders `/api/forecast`, auto-refreshes every 15 min. |
| `history.js` | Score-history recorder (cron, every 4 h) and trend report. Writes SQLite via the `sqlite3` CLI — still no npm dependencies. |

There is deliberately no build step and no framework. Live state is one
in-memory cache of raw upstream responses; the only persistence is the
append-only score history (below), which nothing in the live path reads.

## Data sources

| Source | What it provides | Failure mode |
|---|---|---|
| Open-Meteo forecast API (`best_match`) | Hourly cloud (low/mid/high/total), RH, dew point, pressure, visibility, wind, precipitation, CAPE, direct/shortwave radiation; daily sunrise/sunset. Multi-location: one call covers every sample point. | Request fails → 500; the page shows the error. |
| Open-Meteo forecast API (multi-model) | `cloud_cover` from ECMWF, GFS, HRRR, NBM, UKMO for the model-consensus leaf. Roles: ECMWF/GFS medium-range synoptic (coarse ~25 km); HRRR 3 km detail ≤18–48 h; NBM 2.5 km calibrated blend to ~10 days; UKMO ~10 km independent mid-range. (NAM is not published by Open-Meteo; NBM stands in for the 8–48 h window.) | Missing model values → that model drops out of the blend. |
| Open-Meteo air-quality API (CAMS) | Hourly aerosol optical depth at site and offset points. | Null AOD → haze/saturation leaves return `null` and drop out. |
| OpenWeather Air Pollution API | Forecast surface PM2.5/AQI, one call per site. Optional — key from `.env` (`OPEN_WEATHER_KEY`), env var, or `.openweather-key`; re-read every cache refresh. | No key or 401 → PM2.5 leaf scores `null`; haze runs on AOD alone. |
| NPS Blue Ridge Parkway road-closures page | Gate status by milepost section, parsed with a regex over the stripped HTML. | Fetch/parse failure → access scores 2 ("unknown") with a link, never a fabricated answer. |

**Invariant: every data source is allowed to fail independently.** A `null`
leaf score drops out of its parent's merge and the remaining weights
renormalize. Nothing downstream assumes completeness.

## Sampling geometry

Forecast points are not just the site coordinates. For each site,
`buildPoints()` derives offsets along the **true solar bearing** for the
current declination (`sunBearing()` — sunrise/sunset azimuth swings ±~30°
around due east/west through the year at this latitude; due-E/W sampling would
miss the 70 mi light path by ~30 mi at the solstices). Each event samples
toward the sun: the rise bearing for sunrises, the set bearing for sunsets
(`ctx.dir`, keyed 'E'/'W' as logical direction names).

| Band | Distance | Used by |
|---|---|---|
| Site cell | 0 mi | near cloud band, fog & no-go checks, air metrics, deck dynamics, veil translucency |
| Cloud bands | near = site cell; mid = `cloudBands.mid` (3, 5.5, 8 mi); far = `cloudBands.far` (12, 20 mi) | "Clouds": per-band high/mid/low structure — coverage averaged across each band's sample points (HRRR resolves ~1.9 mi cells, so one sample would miss most of a band) — weighted by share of frame (0.20/0.55/0.25); color canvas and CAPE texture read the mid band |
| Horizon band | `cloudSampleMiles` (35, 70 mi) | light-path clearance and distant canvas |
| AOD curve | `aodSampleMiles` (40, 70 mi) | haze weighted 0.15/0.40/0.45 (site/mid/far); color saturation weighted 0.50/0.30/0.20 |

Band distances derive from frame geometry — a 15–20 mm full-frame shot with
~65% sky spans horizon to ~40° elevation; for a deck ~2 km above eye, the top
15–20% of sky is within ~3 mi, the middle ~55% is ~2–9 mi, the thin far band
is ~9–24 mi, and below ~3° belongs to Horizon. Calibrated from photos — see
HISTORY.md.

## The metric tree

Scoring is a recursive tree (`METRIC_TREE`). Every node is either:

- a **leaf**: `{ key, name, weight?, compute(ctx) → { score: 0–4 | null, value?: string } }`
- a **parent**: `{ key, name, weight?, merge, children, note?(ctx) }`

`evalMetric(def, ctx)` walks the tree and returns a plain serializable node
(`score`, `grade`, `color`, `value`, `note`, `children`) that the frontend
renders generically — adding a leaf requires zero frontend changes.

Merge patterns (`MERGES`):

| Pattern | Semantics |
|---|---|
| `mean` | Unweighted average of scored children. |
| `weighted` | Weight-normalized average (weights need not sum to 1; nulls drop out and renormalize). |
| `min` | Worst child wins — used for blockers ("no matter how nice the shape, a sealed light path caps it"). |
| `max` | Best child wins. |
| `outside-sensitive` | Weighted mean pushed away from the pivot 3: endpoints and pivot fixed, everything else stretched, so blends read decisively good or bad. Infinite slope at the pivot — grades near 3.0 can flip between refreshes by design. |

The **root is a metric too** — `outside-sensitive` over six children (Clouds
in frame, Horizon, Access, Humidity/clarity, Haze, Color potential) plus a
half-weight static Vantage leaf. Overall = root score, except:

**No-go veto.** `detectNoGo()` sits outside the tree. Heavy rain and closed
roads always force 0/F. Fog and socked-in force 0/F **only when the deck is
static** — `deckDynamics()` (±2 h low-cloud swing + wind) downgrades them to a
low-scored gamble ("expect windows").

Cross-leaf interactions are deliberate and few, each encoding one observed
physical coupling:

- `sunwardOpenness()` — an open horizon raises the floor for heavy decks
  (underlit ceiling ≠ gray dome).
- `brokenDeckLikely()` — open horizon + dry air, or a volatile deck, rescues
  "100% low cloud" readings that are really broken orographic cumulus.
- `veilTranslucent()` — direct-radiation fraction an hour sunward of the event
  distinguishes a thin cirrus veil from milky wash-out.

### ctx

One context object per (event × site) carries everything a leaf may need:
`{ site, wx, view, models, points, aq, owm, dir, ms, now, access,
mergeOverrides }`. Leaves read hourly values via `at(loc, key, ms)`
(nearest-hour lookup using each location's own `utc_offset_seconds`, so server
timezone never matters).

## Scoring conventions

- Scores live on a nominal **0–4** scale. Letter grades use plus/minus bands
  with Ruby-style exclusive ranges (`x...y` = ≥ x and < y):

  | F | D | D+ | C- | C | C+ | B- | B | B+ | A- | A | A+ |
  |---|---|----|----|---|----|----|---|----|----|---|----|
  | <0.7 | 0.7 | 1.3 | 1.7 | 2.0 | 2.3 | 2.7 | 3.0 | 3.3 | 3.7 | 4.0 | ≥4.3 |

  **Convention: a bare letter means the lowest score of its band** — when
  calibration feedback says "that's a C," encode 2.0.
- Leaves top out at 4.0. Parent blends may exceed 4.0 (clamped at 4.3 — an
  A+ is the ceiling; what more do you want) only
  via the `outside-sensitive` stacked-excellence bonus: +0.1 per child scoring
  ≥ 3.9, granted only when the blend itself is already ≥ 3.7. A+ therefore
  requires a chorus of near-perfect metrics and is nearly mythical by design.
- Colors follow grade bands: deep green = A-band (≥ 3.7), light green =
  B-band (2.7...3.7), yellow = C-band (1.7...2.7), red = D/F or no-go. Color
  is never the only signal (icon + letter + number accompany it).
- Ideal-band leaves use `bandScore(v, idealLo, idealHi, {floors…})` — 4 inside
  the band, linear ramps outside. Several curves are intentionally
  **non-monotonic** (a sprinkle of horizon cloud beats a bare horizon; moderate
  AOD beats ultra-clean air).
- **D/F must mean something actively in the way — a flat cloud wall, a sealed
  light path — never mere absence.** A plain, empty sky belongs in the C
  range: unremarkable, not penalized. (Craggy 2026-07-30: a totally clear
  sky at a given altitude was flooring `highLeaf`/`midAltLeaf` at D/D+; JW —
  "a D is evidence of something in the sky we don't want... not a plain sky."
  Floors raised so empty reads C-range, not B, since it also isn't *good*.)
  When picking a `belowFloor`/`aboveFloor` for a new leaf, ask which case
  you're describing before choosing the grade band.
- Curve constants are calibrated against real photos and each carries a
  comment citing the photo that shaped it. Do not "clean up" these numbers
  without a photo that disagrees.

## Departure planning

All timing constants are data in `CONFIG` (per-site `travelMin`/`hikeMin`,
global wake/pack/setup/photo-lead/sunset-buffer). Plans target **photo time**
— `photoLeadMin` (20 min) before the event, so shooting brackets it — and
work backward: depart = photo time − travel − hike − setup − sunset buffer;
alarm = depart − pack − wake. Always derived at request time — change one
number and every event recalculates. Nothing about timing is precomputed or
stored.

## HTTP surface

| Route | Behavior |
|---|---|
| `GET /` | Serves `public/index.html`. |
| `GET /api/forecast` | Builds the full payload from cached raw data. Accepts `?merge.<nodeKey>=<pattern>` overrides for live experimentation; the page passes its own query string through, so `/?merge.overall=mean` works. |
| `GET /api/opportunities.json` | JSON:API collection: one resource per event, best/worst score across destinations, and a `go` block (best site + photo/depart/alarm times). |
| `GET /api/opportunities/<id>.json` | One event plus its sites in `included`. `<id>` is `YYYY-MM-DD-<kind>`, a bare `YYYY-MM-DD` (both of that day's events), or `next`. `?depth=N` (1–6) expands the subscore tree. |

The JSON:API surface exists for a phone on the road, which shaped it:

- **Ids are guessable** — `2026-07-29-sunset`, not an opaque key. A date alone
  is ambiguous (every day has two events) so it returns both; `next` resolves
  to the soonest.
- **Two round trips, maximum.** The collection carries enough to act on
  (where, and when to leave); the member carries the reasoning.
- **Every time is given twice** — `local` (human string in the site's zone) and
  `at` (UTC ISO). Neither form is a parse away from the other on a phone.
- **Ranking excludes calibration sites.** Home scores the same sky but isn't a
  destination; it appears in `included` flagged `calibration_only` and never
  becomes "best" or "worst" (`CONFIG.sites[].calibration`).
- **Links are built from the request `Host`** so they stay clickable through a
  tunnel or over the LAN. CORS is open (`*`) — public forecast data, no auth,
  no writes.

**Caching invariant:** only *raw upstream responses* are cached (15 min).
Scoring is cheap arithmetic and re-runs per request — this is what makes merge
overrides, config edits, and the OpenWeather key hot-reloadable without a
restart (key files are re-read at each refresh).

## Score history (`history.js`)

A cron job (`7 */4 * * *`) snapshots the entire scored tree — every event ×
site × metric node, ~1000 rows — into `data/history.db`. Two tables:
`snapshots` (when, and whether the payload came from the live server or an
in-process build) and `scores` (one row per node, carrying `event_ms`,
`lead_hours`, `site`, dotted `path`, `depth`, score/grade/value).

**The key is `event_ms`, not the snapshot time.** That is what makes a
*trajectory* queryable: the same Thursday sunset scored at 60 h out, 56 h out,
52 h out… `report` renders those as sparklines with net change, churn per
step, and an aggregate drift-by-lead-time table — the difference between a
systematic bias (scores brighten as events near) and honest noise.

Design constraints, in priority order:

1. **No npm dependencies** — SQLite is driven through the `sqlite3` CLI
   (Node 20 predates built-in `node:sqlite`).
2. **A snapshot must not depend on the server being up.** `history.js` prefers
   `GET /api/forecast` on localhost (free — the server's raw cache is ≤15 min
   old) and falls back to `require('./server.js')` and building the payload
   in-process. Hence the `require.main === module` guard in `server.js`.
3. **Never lose a data point to a hiccup** — upstream failures retry 3× at 45 s
   before the run gives up; failures land in `log/history.log`.
4. **Recording is read-only with respect to scoring.** No live code path reads
   the history; deleting `data/history.db` costs history and nothing else.

Cost is ~100 KB per snapshot (~200 MB/year at 6/day). `prune --days=N` exists
but retention is deliberately generous — old forecasts are the raw material
for verifying predictions against what the sky actually did.

## Deployment

The app runs as a **user systemd service**, not a bare `node server.js` in a
terminal — a 2026-07-29 power outage rebooted the box and the hand-started
process never came back, which is exactly the failure mode a daemon exists to
prevent.

| Unit | Purpose |
|---|---|
| `~/.config/systemd/user/focus-forecast.service` | Runs `node server.js`, `Restart=on-failure`, `WantedBy=default.target` — starts on boot without a login, same shape as this host's `ducks.service`/`grid.service`. |
| `~/.config/systemd/user/avahi-alias-lense.service` | `avahi-publish -a -R lense.local <LAN IP>` — publishes the LAN mDNS name, mirroring the existing `avahi-alias-ducks`/`avahi-alias-grid` units (`/etc/avahi/hosts` is unused on this host; aliases are per-unit `avahi-publish` processes instead). |
| `/etc/nginx/sites-available/lense.local` | Reverse-proxies port 80 → 5813 for `http://lense.local`, symlinked into `sites-enabled` — same shape as `ducks.local`/`grid.local`. |

No code depends on any of this — `server.js` still binds `CONFIG.port` and
runs the same whether started by systemd, cron, or a bare shell. This is host
configuration, not application behavior, which is why it lives here rather
than in `CONFIG`.

## Frontend

One page, no dependencies. Layout per the original design notes: a left edge
bar colored by the next opportunity, the opportunity list (event sections,
each with per-site cards: big grade block, mini metric blocks, departure line,
expandable detail tree), and a sunset-art panel on the right (a faded
full-screen backdrop below the large breakpoint). Note: the design notes'
"Happy Thoughts image" referred to a separate app of JW's; Focus Forecast is
deliberately independent of it, with a future integration planned via API. The
detail view renders the metric tree recursively — node name, value, score,
merge/weight tags, notes — so the UI is a pure function of the tree shape.
Light and dark themes via `prefers-color-scheme`.

## Extension points

| To add… | Touch |
|---|---|
| A tracked quantity in history | Nothing — `history.js` walks the tree generically, so any new metric starts being recorded on the next 4-hour snapshot. |
| A site | One entry in `CONFIG.sites` (coords, times, milepost or `null`, vantage or `null`). Sample points, access parsing, and the UI follow automatically. |
| A leaf metric | One `compute` function + one line in `METRIC_TREE`. Prefer a small weight first (see CAPE) and let it earn more. |
| A merge pattern | One entry in `MERGES`; instantly usable via `?merge.` overrides. |
| A data source | Fetch in `fetchAll()`, thread through `ctx`, let leaves return `null` when it's absent. |
| Curve tuning | Edit the leaf, cite the evidence (photo/date) in a comment. Backtest against the archive APIs when the evidence is dated (see `scratchpad` pattern in HISTORY.md). |
