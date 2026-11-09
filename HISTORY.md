# History

A decision log: what changed, and — more importantly for this project — the
evidence that drove it. Most scoring decisions here were calibrated against
real photographs; each entry names its evidence. Newest entries at the bottom.

The project was built and calibrated in an intensive session on 2026-07-28,
seeded by voice-conversation notes (metrics, sites, travel/prep times, scoring
scale, dashboard layout).

## 2026-07-28 — Initial build

Node server on port 5813, no dependencies. Five metrics from the design notes
(local clouds, surrounding clouds at 35/70 mi, Parkway access, humidity &
clarity, AOD), 0–4 scoring with A–F grades, auto-zero no-gos, dynamic
departure/alarm calculation from config constants, dashboard with big/small
color blocks and a sunset-art panel (built as "Happy Thoughts" from the design
notes — see the 2026-07-28 naming entry below for the correction). Data: Open-Meteo forecast +
air-quality APIs, four cloud models (ECMWF, GFS, HRRR, NBM — NAM isn't
published by Open-Meteo; NBM covers the 8–48 h window), NPS road-closures page
parsed for gate status between Ox Creek (Bull Gap, MP 375.7) and each site.
Horizon and AOD sampling made direction-aware (east for sunrise, west for
sunset) — the notes said "east," which only makes sense for sunrise.

Real consequence from day one: Green Knob's Parkway section (MP 344.2–355.3)
was Helene-closed, so it graded F on access, not on weather.

## 2026-07-28 — OpenWeather PM2.5

Added as a 70/30 cross-check blend into the haze metric (CAMS AOD is a column
model; OpenWeather PM2.5 is forecast surface particulate). Key is optional and
hot-reloaded from `.env`/`.openweather-key`; everything degrades gracefully
without it.

## 2026-07-28 — The metric tree

JW: *"A metric should presumably be able to have both child metrics and a
merge pattern (like highest value, average, ...)."* Scoring refactored into a
recursive tree — leaves compute, parents merge (`mean`, `weighted`, `min`,
`max`), nulls drop out and weights renormalize. The overall score became the
root node; the horizon "blocker cap" became an honest `min` merge; the API
returns the whole tree and the UI renders it generically. Home
(35.6919, -82.5158) added as a calibration site.

## 2026-07-28 — Color potential

JW observed from home: hazy, but the color was "a little subtle but pretty" —
exposing that the AOD benchmark ("below 0.1 ideal") treats aerosols as purely
bad when the physics is non-monotonic. New top-level metric with three leaves:
saturation (peak 4.0 at AOD 0.08–0.22, site-weighted 50/30/20 since color
comes from overhead scattering), purity (dry air keeps haze colorful), canvas
(something must catch the color). Haze kept its meaning: transmission through
the distance path. The two metrics deliberately disagree on hazy-but-pretty
days.

## 2026-07-28 — Outside-sensitive weighting

JW supplied the curve (`3 ± stretch around pivot 3`, exponent 0.42). Added as
a merge pattern; A/B-tested via new `?merge.<key>=<pattern>` request overrides
(raw data cached, tree re-evaluated per request). Mid-tree placements diluted
to nothing; at the root it turned a board of indistinguishable B-minus mush
into a decision ("skip Tuesday, go Thursday"). Adopted as the root's default
merge. Known trade-off: infinite slope at the pivot means grades hovering near
3.0 can flip between refreshes.

## 2026-07-28 — View clouds (photo calibration begins)

JW: overhead clouds *"are NOT in the photo"* — then, correcting the
over-rotation: some are, *"but generally no."* "Local clouds" re-aimed as
"View clouds": structure sampled at `viewMiles` toward the sun, site deck
demoted to a `min`-merged view blocker, overhead kept a small (0.13 → 0.15)
voice. Calibration photos that shaped the numbers:

- **Green Knob sunrise** — drama carried by scattered low cumulus over
  intermediate ridges (~5–12 mi): `viewMiles` set to 10; low cloud 15–45% in
  the view band re-scored as *ideal* (it had been a penalty); mid-level weight
  raised vs high cirrus.
- **Valley sunset ("closest clouds that can be in the picture")** — nearest
  in-frame clouds sit ~2–4 mi out, inside the site's own grid cell: overhead
  leaf renamed "Near clouds (site cell)," weight bumped.
- **Home failure shot** — clouds ON the horizon pinched the glow and a
  promising deck stayed gray: horizon "Low clear" made the dominant gate
  (weight 0.7) with a harsher curve.
- **Craggy sunset ("some horizon clouds... nice; that one cloud is GREAT")** —
  made Low-clear non-monotonic: ~10–25% low at the horizon *beats* a bare
  horizon; a single great cloud (~5–15% view coverage) earns full marks.

## 2026-07-28 — "AS LONG AS THERE IS COLOR"

Heavy-deck Craggy photo: full gray ceiling, open sunward strip, the whole
scene glowed. Encoded as `sunwardOpenness()`: an open horizon raises the floor
for heavy mid decks — capped at 2.0 after JW graded the lit gray deck *"a C
(2.0) at best."* The light-path blocker also switched from total cover to
`low + ½·mid`, since post-sunset light grazes under mid/high decks.

## 2026-07-28 — The Oct 9 2022 backtest and the broken-deck rescue

First archival backtest (ERA5): the "magnificent" Craggy sunset of
2022-10-09. Model verdict B 3.31 — a correct "go" — but the view metric
scored 0.5 because ERA5 called the site 100% low cloud when the photo shows
broken cumulus with sunbursts. Coarse grids routinely report ridge-hugging
broken cumulus as solid overcast. Added `brokenDeckLikely()`: solid-low
readings with a wide-open sunward horizon and healthy dew spread floor the
view blockers at 2.0 ("likely broken"). Re-backtest: A 3.61.

## 2026-07-28 — Deck dynamics

JW, on Craggy 2026-06-23: *"One moment it'll be fogged in, the next it's
completely open and magnificent."* Two photos three minutes apart (9:05 fog
wall → 9:08 glowing undercast) document it; archive data confirms a 96 %
low-cloud swing through that sunset. Added `deckDynamics()` (±2 h swing +
wind): fog/socked-in no-gos only fire on a *static* deck; volatile decks
become a scored gamble with a "deck in motion — expect windows" note; deck
motion also triggers the broken-deck rescue. (Initially misfiled as a
same-night live validation; corrected — the photos were from June 23. A true
live-forecast validation night is still an open item.)

## 2026-07-28 — Near-cloud structure credit

Home, 2026-06-28: gray midground clouds, *"too close to catch the colors, but
still helpful"* for visual interest. Low cloud added to the near-clouds leaf
at ⅓ credit (structure only; deliberately excluded from the color canvas).

## 2026-07-28 — CAPE texture (experimental)

A coastal photo (explanatory only, not calibration) showed why granular broken
altocumulus ≫ a slab at identical coverage — and that grids report coverage,
not granularity. CAPE added as a 0.08-weight texture proxy under the framed
sky (stable = slab-prone 2.0; 500–1500 J/kg cellular 4.0; >1500 storm-tower
taper). Unvalidated; "throw it in with light weight and we can play with it
over time."

## 2026-07-28 — Vantage, and what Home is for

Home photo 2026-06-02: the color was there, the view was not ("I don't have a
clear view of the sky here"). Added a static per-site Vantage leaf at half
weight (Mitchell/Craggy 4.0, Green Knob 3.5). Immediately corrected on JW's
instruction: **Home is a calibration proxy, scored on sky alone** (vantage
`null`) — the question it answers is "if this sky were at Craggy, would it
score well?", so it must never be penalized for rooftops. Also located the
June 30 sunrise via its coordinates: the Parkway stretch near Craven Gap /
Tanbark Ridge (MP ~376.7) — a candidate fifth site, not yet added.

## 2026-07-28 — The May 4 color backtest and the veil proxy

Home, 2026-05-04: *"a kind of B sky, but the color!!!"* Archive backtest:
site-weighted AOD 0.119 (dead center of the saturation sweet spot), RH 41 % —
Color potential 3.80. The color curve's first archival validation. It also
exposed the coverage-can't-see-thickness problem: 99 % high cloud that evening
was a thin translucent veil, not milk. Direct-radiation test across all seven
dated photos separated the cases cleanly (thin veils 0.46–0.69 direct
fraction; the blocked Jun 2 sky 0.00). Added `veilTranslucent()`: ≥70 % high
cloud with direct fraction ≥0.4 (and enough total radiation to trust) floors
the high-cirrus leaf at 3.0.

## 2026-07-28 — Plus/minus rubric

JW replaced the coarse A–F bands with a plus/minus rubric (Ruby-style
exclusive ranges; see ARCHITECTURE.md § Scoring conventions), with the
convention that a bare letter in feedback means the *bottom* of its band.
Deliberately raises standards: the old 2.5 "B" is now a C+. The photo-anchored
constants were **not** shifted — they were already letter-anchored and land on
their intended letters under the new bands ("gray deck is a C (2.0) at best" =
exactly the new C). Blends may now exceed 4.0 via a stacked-excellence bonus
in `outside-sensitive` (+0.1 per child ≥ 3.9 when the blend is already ≥ 3.7,
clamp 4.3), making A+ reachable in principle and mythical in practice.
Grade colors follow the new bands (deep green = A-band, light green = B-band,
yellow = C-band, red = D/F/no-go).

## 2026-07-28 — B gets its own green

Dashboard color scale split: deep green = A, light green = B (yellow = C,
red = D/F/no-go). ARCHITECTURE.md and this file written.

## 2026-07-28 — "Happy Thoughts" is a different app

The design notes' "Happy Thoughts image on the right" turned out to refer to a
**separate app JW created** — the voice transcript had merged two projects'
notes. Decision: Focus Forecast stays independent; the two will be merged via
API in the future. The name was removed from this app's UI, code, and docs
(the panel keeps the generated sunset SVG, which JW liked; on mobile it
renders as a faded full-screen backdrop instead of a top panel).

## 2026-07-28 — Clouds split into distance bands (the clouds conversation)

JW's long-trailed clouds concern, stated at last: the single "clouds in frame"
number hid *where* the clouds are, and JW wants to check prediction accuracy
per band. Using a reference photo (~65% sky, 15–20 mm full-frame framing), the
sky divides into near clouds (top ~15–20% of frame), mid-ground (~55%), and
far (~10–20%), with the horizon below. Frame geometry maps those to sampling
distances: near ≈ within 3 mi (the site's own grid cell), mid-ground ≈ 2–9 mi
(sampled at 8), far ≈ 9–24 mi (sampled at 20) — dovetailing with the existing
Horizon metric at 35/70 mi. "Clouds in frame" restructured: three band nodes
weighted by share of frame (0.20/0.55/0.25), each carrying its own
High/Mid-level/Low altitude leaves so per-band accuracy is inspectable on the
dashboard (click the metric). The old "near clouds (site cell)" composite leaf
was absorbed by the near band; consensus and CAPE ride alongside the bands;
the sight-line blocker still `min`-caps the whole metric.

## 2026-07-28 — Score history (the app grows a memory)

JW: *"track the overall and subscores every 4 hours… I'd be interested to see
if they always trend in a certain direction or if they are up and down."* Until
now the app was purely stateless — it could tell you what tonight looks like,
but never what it had said yesterday, so no claim it made was ever checkable.

`history.js` snapshots the whole scored tree (every event × site × node,
~1000 rows) into SQLite, keyed by **event time** rather than snapshot time, so
a single Thursday sunset accumulates a trajectory as it approaches. `report`
shows it as a sparkline per event with net change and churn per step, plus a
drift-by-lead-time aggregate. The distinction that matters: a consistent
positive drift is a *bias* (models resolving toward optimism, or our curves
rewarding the detail that only near-term models resolve) and is correctable;
symmetric churn is genuine uncertainty and should eventually be shown as a
range on the dashboard rather than a single confident letter.

Two design notes. SQLite goes through the `sqlite3` CLI — Node 20 predates
`node:sqlite`, and the alternative was the project's first npm dependency.
And the recorder prefers the running server's `/api/forecast` (free, cache is
≤15 min old) but falls back to building the payload in-process, so a snapshot
still lands if the server is down; `server.js` grew a
`require.main === module` guard and a module export for that. Cron at
`7 */4 * * *`, log in `log/history.log`.

Nothing on the live path reads the history yet. It has to accumulate first.

## 2026-07-28 — `/api/opportunities.json` (the road interface)

The endpoint parked back during the clouds conversation, built to JW's draft
with three changes, each from the same premise — *this gets read on a phone,
possibly in a parking lot, possibly with one bar of signal*:

1. **Ids carry the kind**: `2026-07-29-sunset`, not `2026-07-29`. Every day has
   two events; a bare date can't name one. It still works as a filter (returns
   both), and `next` resolves to the soonest — all three forms typeable from
   memory without consulting the collection first.
2. **Home is excluded from best/worst.** It scores the same sky, which is the
   whole point of it, but it isn't a place you can drive to — letting the
   backyard set "worst site tonight" would be noise. It stays in the response
   flagged `calibration_only` (`CONFIG.sites[].calibration`).
3. **The collection answers the actual question.** JW's draft had best/worst
   scores and links; a `go` block was added (best site, photo time, departure,
   alarm) so the common case — *am I going, and when do I leave?* — needs one
   request, not two.

Times are emitted twice throughout (`local` human string + `at` UTC ISO), site
detail rides in `included`, `?depth=N` expands the subscore tree, and links are
built from the request `Host` so they survive a tunnel. Grades come from the
same rubric as everything else, so "F+" from the draft is just F.

## 2026-07-29 — The outage that made it a real daemon

A power outage rebooted the box; the app didn't come back, because it had
only ever been started by hand (`nohup node server.js &`) after each edit. JW
noticed it was down and asked for a proper daemon plus a LAN hostname
(`lense.local`, matching this host's existing `ducks.local`/`grid.local`
pattern for other projects).

Fixed with the same shape already proven on this host (see ARCHITECTURE.md §
Deployment): a user systemd unit (`Restart=on-failure`, boots without a
login), an `avahi-publish` unit for the mDNS alias, and an nginx vhost
proxying port 80 → 5813. Nothing in `server.js` changed — this was pure host
config, verified live (`curl http://lense.local/api/forecast` → 200) rather
than assumed from the unit files.

Separately, JW confirmed reaching the API from the road doesn't need a tunnel
or port-forward: a local agent (IM) polls it and relays to Slack, so the API
only ever needs to work on the LAN. IM was messaged the endpoint shapes
(`/api/opportunities.json`, `next`, `<date>-<kind>` ids, the `go` block, the
`calibration_only` caveat on Home) so it can query on JW's behalf.

## 2026-07-30 — First live-forecast validation (Craggy sunrise)

The open item since 2026-07-28: check the dashboard's grade *before* an event,
then shoot it and grade reality. Five photos from this morning's Craggy
sunrise, checked against the model's final snapshot (2.5h out): Overall B+
3.39 (Clouds C- 1.81, Color B- 2.95, Haze B 3.22, Horizon B- 2.90, Air B+
3.30).

JW's read, subscore by subscore:

- **Color (B- 2.95)** — confirmed: *"very good color... certainly around a
  B- as predicted... I might have said B+."* Within a notch either way.
- **Haze (B 3.22)** — confirmed: *"there was definitely some haze in the
  distance. B is fine."*
- **Clouds (C- 1.81)** — confirmed, and it validates the distance-banding
  design (see the 2026-07-28 band-split entry above): *"nothing that made it
  bad per se, but nothing that made it good other than some far wisps that
  would have been cooler in the mid-ground or close."* Far-band cloud is
  deliberately the lightest-weighted (0.25 vs 0.75 for near+mid) — this is
  that weighting working as intended, not an accident.
- **Horizon (B- 2.90)** — the one open question, not a correction: *"the
  horizon was really great, I would probably have given it a higher grade,
  but can't be sure because the sun rises over the mountains there, not the
  horizon."* The Horizon metric (`horizonDistanceDef`) samples atmospheric
  cloud cover at fixed distances (35/70 mi) toward the sun — it has no notion
  of foreground terrain elevation, so at a site where the sun clears a
  ridgeline rather than a flat horizon, the sample point and the thing JW is
  actually looking at may not be the same patch of sky. Not corrected — one
  data point isn't enough to retune a curve, and JW himself wasn't certain.
  Logged as an open item below.

JW, on reflection: *"that's fair. We could bump that up a bit. But certainly
the lack of mid-ground clouds, cumulonimbus, cirrocumulus, altocumulus, etc.
means it can't be higher than a C+."* Traced to `highLeaf`/`midAltLeaf`: a
totally empty sky at an altitude fell below their ideal band and floored at D
(1.0) and D+ (1.5) respectively — appropriate for actual bad structure, too
harsh for plain absence. Raised both floors (high 1→1.8, mid 1.5→2.5).
Replaying today's exact readings (0% at every altitude, all three bands)
through the new floors: Clouds 1.81 (C-) → 2.38 (C+) — comfortably inside C+,
nowhere near B-. Low cloud's floor (3.2, B, for 0% coverage) was left alone;
an empty low band was never the complaint.

## Open items

- **Live-forecast validation** — first one done (2026-07-30 Craggy sunrise,
  above); Color and Haze confirmed accurate, Clouds' empty-sky floor
  corrected as a result. Keep doing this on future shoots — one night isn't
  enough to trust any subscore fully, especially Horizon (below), and the new
  Clouds floors (1.8/2.5) are calibrated to exactly one data point.
- **Horizon at sites where the sun clears a ridge, not a flat horizon** — the
  metric samples atmospheric conditions at fixed distances toward the sun
  with no terrain model; JW suspects Craggy's actual horizon glow (sun rising
  over mountains) reads better than the score, but wasn't certain. Needs more
  validation nights, ideally comparing a mountain-sunrise site against one
  with a genuinely flat/distant horizon, before touching the curve.
- **Possibility: certainty vs. quality as separate axes for empty-sky floors.**
  JW, thinking out loud about whether an empty sky is D+ or C-: *"if I'm
  certain there will be no clouds at all, D+; if there's a chance there won't
  be, C-."* That's a confidence question, not a quality one — a forecast the
  models agree is flat-0% has no upside; one they disagree on has a chance of
  the wisps that actually showed up 2026-07-30. `highLeaf`/`midAltLeaf` only
  ever see the blended coverage value today; model spread (already computed
  in `leafConsensus`, currently thrown away after scoring itself) would need
  threading through to use it as a floor tiebreaker. Not built — no action
  yet, see whether confident-empty and uncertain-empty actually diverge often
  enough across more validation nights to justify a second axis.
- CAPE texture leaf: unvalidated; earns weight, a reshaped curve, or the axe.
- Score history needs ~a week of snapshots before `report` says anything; then
  decide whether drift is correctable bias or a confidence range on the card.
- Vantage could weight by *where* the interest is (horizon glow vs mid-sky).
- Deck dynamics measures swing magnitude, not direction — "clearing into the
  event" vs "filling" is computable from the same samples.
- Craven Gap / Tanbark Ridge as a fifth site, on request.
- ~~Reaching the API from the road needs a tunnel or port-forward~~ — moot: a
  local agent (IM) polls the LAN API and relays via Slack, so nothing needs to
  leave the house network.
- Happy Thoughts integration via API (Happy Thoughts is JW's separate app).

## 2026-09-03 — Going public: private mode, and a horizon method that failed then partly survived

The app is becoming **SkyMagic** (skymagic.app). Only user-facing strings were
renamed; the systemd unit, worktree, MCP server id and `TRON_AGENT_NAME` stay
`focus-forecast` because `grid-diag` verifies the worktree id matches the id the
Grid addresses it by.

**Private mode.** `FF_LOCAL` (default off) gates the Home calibration site. When
off it is removed from `CONFIG.sites` at startup rather than filtered in the
view, so a public build never fetches, scores or serves it. Also fixed: the
dashboard's "best:" header ranked all sites including Home, while only
`buildOpportunities` filtered calibration sites out — Home outscored Mitchell
3.67 to 3.56 on 2026-08-26, so the public header would have named JW's back yard
the best spot for the evening. JW's street address was also being printed in
that header and is now local-only.

**The horizon question.** Going public needs per-direction vantage: many spots
are good for one event and useless for the other ("I can't see anything
reasonable for sunrise from home"). `vantage` is a single scalar with no
direction in it. The proposal was to derive facing from terrain, which would
also speak to the open ridgeline question from 2026-07-30.

**First attempt, retracted.** `tools/horizon.js` samples a bare-earth DEM
(Copernicus GLO-90, via Open-Meteo's keyless elevation API) along the true
sunrise/sunset bearings at three declinations, and takes the largest elevation
angle. With samples from 0.06 mi outward it returned **Craggy Pinnacle BLOCKED
in every direction** — a 360° bald summit. Mitchell's summit came out blocked to
the east.

The cause is structural, not a tuning error. A 90 m DEM smooths peaks away: it
reads Craggy at 5,515–5,669 ft against a published 5,892 ft, and Mitchell at
6,608 ft against 6,684 ft. Standing on a truncated summit, neighbouring cells
read higher than you, and at 0.06 mi a spurious 35 m rise is 19°. The near field
is measuring the DEM's own error. It fails worst on bald summits, which are
exactly the sites worth listing. That reading was discarded, not patched.

**Second attempt, survived — asymmetrically.** Discarding samples inside 1 mi
reproduces all four known cases: Mitchell open both ways, Craggy open both ways,
Home blocked at sunrise (7.6°, blocker 1.4 mi east — JW's own account is "the
hill next to my house"), Home only slightly raised at sunset. Verdicts are
unchanged at 0.75, 1.0 and 2.5 mi cutoffs; the angles shrink (Green Knob sunset
19.0° → 6.3°) but nothing reorders, so the conclusion does not rest on the
choice of threshold.

Strength claim, stated plainly: this is four sites, one of them the calibration
proxy, and the validation targets were known in advance. It is a sanity check
that the method is not nonsense, not evidence that it is accurate.

**Read the output asymmetrically.** BLOCKED is the trustworthy half — the DEM
found real rock. "Wide open" only means *no distant ridge*: the 1 mi floor makes
the method blind to precisely the near-hill case JW raised, and a bare-earth
model never sees trees, buildings or narrow knolls at any range. So it can rule
a spot out and cannot rule one in.

Stored as advisory metadata on each site (`horizon:`) and in
`tools/horizon-baseline.json`. **Not wired into scoring** — that needs JW's
sign-off, and given the above it should probably only ever be allowed to
veto a direction, never to praise one.

**One falsifiable prediction to check in the field:** Green Knob Overlook shows
a ridge ~19° up to the west and open ground east. If that holds it is a sunrise
spot, and the config currently scores it identically for both events.

## 2026-09-04 — Parkway entrance is a user input, not a constant

`accessRouteStartMP: 375.7` — Ox Creek/Bull Gap, JW's own on-ramp — was baked
into `siteAccess()`. That function counts only the closures lying between the
entrance and the site, so on a public site the constant would have judged every
visitor's drive as if they started at JW's gate.

Replaced with `CONFIG.accessPoints` (six Asheville-area entrances with
mileposts, from the NPS/RomanticAsheville tables) plus `?entry=<id>` threaded
through `buildPayload` into both API endpoints, a header selector that remembers
the choice in localStorage, and an explicit "assuming US 70" note whenever the
entrance was defaulted rather than chosen. No login; the stored value is a gate
id, not a location.

Verified by querying three entrances and reading the access metric back. Worth
recording honestly: **no current verdict actually flips between the six**,
because every Asheville entrance sits south of the Helene closure at MP
344.2–355.3 and therefore crosses it to reach Green Knob (MP 350.4). The
mechanism is nonetheless load-bearing at the boundary — Mount Mitchell sits at
exactly MP 355.3 where that closure ends, so it reads open from the south and
would read closed from the north. A single-entrance model gets that wrong for
half the visitors as soon as the closure list changes.

Not done: the travel/alarm chain still uses `travelMin` measured from JW's
driveway. Entrance selection fixes *reachability*, not *timing*. See wi-1476.

## 2026-09-04 — Parkway mileage cannot substitute for routing, because closures reroute the drive

Leg 2 of the public travel model (entrance → spot) looked like it could be pure
arithmetic: milepost delta at a fixed Parkway speed, no external service, no
dependency, no API key. JW's three measured `travelMin` values are a ready-made
validation set, all from the same on-ramp at Ox Creek (MP 375.7), so the model
was checked before it was written.

It fails, and not marginally. Solving pairwise for the implied Parkway speed:

    craggy   vs mitchell    8.8 mi / 18 min  ->  29.3 mph
    craggy   vs greenknob  13.7 mi / 55 min  ->  14.9 mph
    mitchell vs greenknob   4.9 mi / 37 min  ->   7.9 mph

A factor of nearly four. The best-fit constant speed is 20.7 mph with a gate
time of zero — an absurd fit — and still misses Mitchell by +17.7 min and Green
Knob by −14.7 min.

The conclusion survives generous slop in the inputs: even allowing ±10 min on
the craggy/greenknob pair, the implied speed is 12–18 mph against a 45 mph limit
and a realistic 30–35 mph. It does not rest on JW's numbers being precise.

The cause is Green Knob's 88 minutes. It sits at MP 350.4, inside the Helene
closure at MP 344.2–355.3, so the Parkway route does not exist and the real
drive detours around it. Mitchell's 51 minutes over 20.4 Parkway miles plus the
4.8 mi NC 128 spur implies ~30 mph, which is entirely sensible — so the two
reachable sites are consistent and the unreachable one is not.

**The architectural point: drive time and closure state are coupled.** A static
per-site `travelMin` is stale the moment NPS updates the closure table, and
geometry alone cannot see the detour. Leg 2 therefore needs the same routing
engine as leg 1, or hand-entered times that are revisited whenever closures
change. It cannot be derived for free.

Nothing was built on the milepost model. Recorded so it is not attempted again.

## 2026-09-07 — Green Knob has been scored ~4 km from Green Knob

Building the public candidate list needed coordinates. Nominatim free-text
search was useless for Parkway overlooks — 13 of 18 lookups returned nothing and
Bearwallow came back 1,384 ft low, presumably the valley rather than the summit.
OpenStreetMap via Overpass has them all properly mapped, milepost in the name
and elevation attached, and it cross-checks against the published NPS table.

Running that check against our own config turned up a real error.

`greenknob` is at 35.7490, −82.2439. Green Knob Overlook (MP 350.4) is at
35.71776, −82.22254. That is **3.98 km apart**, and three independent checks
agree the config is the wrong one:

  - Published NPS elevation for MP 350.4 is 4,761 ft. OSM's node reads
    1451.15 m — an exact match. The DEM at our coordinate reads 1,302 m
    (4,272 ft), 489 ft low.
  - Green Knob and Mitchell are 4.9 Parkway miles apart. Our coordinate sits
    2.62 km from Mitchell's summit, which the road distance cannot allow; the
    OSM one sits 6.52 km away, which it can.
  - 3.98 km is larger than an HRRR cell (~3.0 km), so this is not a rounding
    detail. **The weather has been sampled in the wrong grid cell**, not merely
    the terrain — every Green Knob score in `history.db` is for a different
    place on the ridge.

Not yet changed. Correcting a site's coordinate moves every score it produces
and breaks continuity with the accumulated history, so it wants JW's call rather
than a quiet patch.

**Retracting the prediction from the 2026-09-03 entry.** "Green Knob shows a
ridge ~19° up to the west, so it is a sunrise spot" was computed at the wrong
coordinate and carries no weight. It must be re-probed at 35.71776, −82.22254
before anyone stands anywhere because of it.

Craggy has a milder version of the same problem: the config coordinate is 475 m
from the Pinnacle summit and matches OSM's *Craggy Dome Overlook* (MP 364.1) —
the trailhead parking, not the peak. Well inside one weather cell, so scores are
unaffected, but the horizon geometry was wrong. Re-probed at the OSM summit
(35.70345, −82.37790, DEM 1766 m against a published 1796 m): still wide open
both directions, so that conclusion survives the correction and is now resting
on a coordinate that matches its published elevation to within 30 m. The site's
`horizon` metadata was updated and now records the offset.

Candidate coordinates for the public list are in `tools/candidate-sites.tsv`
(57 mapped overlooks and summits, OSM-sourced, facing still unknown).

## 2026-09-07 — Green Knob confirmed a sunrise spot by JW; the corrected probe agrees, the retracted number does not come back

JW, unprompted: "Green Knob IS a sunrise spot... that's where I have taken the
best sunrise photos I've ever taken." That is field ground truth from the person
the grades are calibrated to, and it settles the direction.

Re-probed at the corrected coordinate (35.71776, −82.22254):

    sunrise  −1.30° worst / −1.74° best   wide open
    sunset   +1.87° worst / −1.31° best   slightly raised (blocker 4 mi W @ 1712 m)

So the east side genuinely falls away and the west is mildly raised — almost
certainly the Black Mountains, which sit west-northwest of the overlook and
higher. The direction JW states is the direction the terrain supports.

**What survives and what does not.** The *direction* was pre-registered: the
2026-09-03 entry predicted "sunrise spot, not sunset spot" before JW said
anything. The *magnitude* was nonsense — 19° of western blockage was an artefact
of the coordinate being 4 km out, and the real asymmetry is about 3.6° between
the two bearings. So the claim is confirmed and the number stays retracted. A
prediction that is right in sign and wrong by a factor of five in size is a weak
prediction that happened to point the right way, and should be cited as that.

This is a fifth validation case for the probe and the first from a site it was
not tuned against, but it is not blind: JW's statement arrived before the
corrected run, so only the 3 Sep direction call was made in advance.

**A second DEM failure mode, opposite to the first.** At this coordinate the DEM
reads 1499 m against a published 1451 m — 48 m *high*, where Craggy's summit read
115 m *low*. Consistent with an overlook being a pull-off cut below the ridge
crest, so the 90 m cell averages in the uphill ground behind it. That places the
observer too high and therefore **under-states** blockage. It is the safe
direction of error for a BLOCKED verdict and the unsafe one for an open verdict —
which is one more reason the probe may only ever veto, never endorse.

Consequence still outstanding: Green Knob's whole score history was computed in
the wrong HRRR cell, at JW's best sunrise location.

## 2026-09-07 — Green Knob moved and its history deleted; what the 4 km error actually cost

Applied on JW's instruction. `greenknob` moved from 35.7490, −82.2439 to
**35.717640, −82.222689** — his own Google Maps fix, which agrees with the OSM
node to 19 m, a third independent source on the same point. All 61,614 Green
Knob rows deleted from `history.db` (backed up first to
`data/history.db.bak-20260907-greenknob`; the other three sites keep their 61,614
each). Horizon metadata updated from the corrected probe.

**How much did the error actually change?** Not a spot check — a year of hourly
reanalysis and a full 3-day run of every model the app uses, comparing the old
point against the new one:

    ERA5 archive (~28 km)   SAME cell   8760/8760 hours identical
    ECMWF ifs025 (~25 km)   SAME cell   100% identical
    UKMO seamless (~10 km)  SAME cell   100% identical
    GFS seamless (~3 km)    DIFFERENT   71.8% identical, mean |diff| 5.1pp, max 92pp
    GFS HRRR (~3 km)        DIFFERENT   71.4% identical, mean |diff| 5.0pp, max 92pp
    NBM conus (~2.5 km)     DIFFERENT   15.3% identical, mean |diff| 2.1pp, max 12pp

So the earlier claim needs splitting. **The coarse models never noticed** — they
resolve both points into one cell, so anything driven by ECMWF, UKMO or the ERA5
archive was untouched. **The fine models did**, and they are the reason HRRR and
NBM are in the list at all: a max hourly divergence of 92 percentage points is
the difference between clear and overcast.

**The good news, and it is the part that matters most.** Archive backtests run on
ERA5, which is bit-identical across the two points. The Green Knob sunrise photo
shaped real curves — `viewMiles` = 10, and low cloud 15–45% in the view band
promoted from penalty to ideal — and if that calibration was done against the
archive, as the Craggy 2022 backtest was, then **the coordinate error did not
corrupt it**. Stated as a conditional on purpose: HISTORY never recorded that
photo's date, so which data it was checked against cannot now be verified. The
curves are probably fine and cannot be proven fine.

The cost was therefore to the **live forecast**, not to the tuning: three years
of Green Knob grades on the dashboard were computed from HRRR and NBM cells 4 km
away, at JW's best sunrise location.

Checked and found sound while here: NBM carries only total `cloud_cover`, with no
low/mid/high split. The app asks the multi-model endpoint for `cloud_cover` alone
(server.js:189) and takes the banded fields from the single-model fetch
(server.js:185), so nothing silently drops out of the band metrics.

**Convention change:** JW, same day — "let's keep photos moving forward ... you
never know when you'll want to get additional data from them." Calibration
photos are no longer deleted when a thread closes without a change; the Green
Knob case is exactly why. Record each photo's date and site, since an undated
citation cannot be re-tested. The restraint on writing unconfirmed findings into
this file is unchanged.

## 2026-09-07 — Terrain screen for 57 candidate sites, and why one number per direction was wrong

`tools/sweep-candidates.js` runs the horizon probe over every mapped overlook
and summit in `tools/candidate-sites.tsv` and writes `tools/candidate-screen.md`
for JW to mark up. 57 spots, none failed.

**First output was wrong and was corrected.** It reduced each direction to the
worst angle across the year, which ruled Tanbark Ridge out for sunrise at 4.84°
— directly contradicting NPS, who say "sunrise can be spectacular as this
overlook faces east." NPS is right. Tanbark's sunrise reads −0.18° in December,
2.09° at the equinox and 4.84° in June: the blocker is terrain 4 mi *northeast*
at 1549 m against an overlook at 1001 m, and the sun only rises there in summer.

The sun tracks roughly 60° along the horizon through the year, so one number per
direction cannot represent a site. The screen now reports all three seasons and
carries no single verdict. This is the same failure as collapsing a distribution
to its mean: the reduction, not the measurement, produced the false claim.

**Sanity check the method passes:** every bald summit in the set — Black Balsam,
Max Patch, Bearwallow, Waterrock Knob, Mount Pisgah, Cowee Mountains, Richland
Balsam — reads open in both directions in all three seasons, which is what a
360° summit should read. Green Knob reads open for sunrise year-round
(−1.64/−1.74/−1.30) and degrades westward toward summer (−1.31/0.16/1.87),
matching JW's account of it as his best sunrise location.

**Strongly seasonal spots the screen surfaces**, all worth checking in the field
before anyone relies on them: Glassmine Falls (sunrise −1.10 Dec but 5.64 at the
equinox), Lane Pinnacle (fine except 4.79 in June), Bull Creek Valley (−0.24 Dec,
blocked by the equinox), Mills River Valley (sunset 3.89 in Dec, −0.43 by June).

Still a veto-only instrument. It rules spots out; it never rules one in.

## 2026-09-07 — Score history read at last: it bounces, and it also drifts a little

The history has been accumulating every four hours since 28 July with nothing on
the live path reading it. CLAUDE.md poses the question it exists to answer: do
scores drift steadily as an event nears — a correctable bias — or bounce, which
is real uncertainty and belongs on the dashboard as a range?

**Both, but the bounce dominates.** 4,401 `overall` rows, 333 no-go rows dropped
(a forced 0 is not a forecast), anchored on the last score inside 3 h of the
event, keeping only the 189 series that reach that close.

The first pass treated every row as independent and produced standard errors
around 0.03. That is wrong — rows cluster inside events. Re-run with one mean
per series per bucket and statistics taken across series:

    lead (h)   n series   mean err      SE       t    SD
     3-9          179       +0.054   0.040    1.35   0.533
     9-15         182       +0.036   0.044    0.81   0.600
    15-21         175       +0.156   0.049    3.17   0.653
    21-30         182       +0.137   0.047    2.92   0.633
    30-42         179       +0.097   0.049    1.99   0.654
    42-54         173       -0.044   0.051   -0.86   0.677
    54-72         168       -0.179   0.051   -3.50   0.663

The drift is real and survives the stricter estimator: optimistic by ~0.15 at
15-30 h out, pessimistic by ~0.18 beyond 54 h, unbiased inside 15 h. But the
largest bias is 0.28 of one standard deviation. **Correcting it would move a
score by a sixth of a letter; the spread is nearly two letters.**

One SD is 1.9 letter grades on the ~0.33-wide bands. A 95% interval spans about
seven. A confident single letter three days out is not defensible, and the
dashboard should carry a range that narrows as the event approaches. That is the
answer to the question the history was collected to settle.

**The caveat that limits all of it:** the anchor is the ≤3 h forecast, not the
sky. This measures *convergence*, not accuracy — a model wrong the same way at
every lead would score perfectly here. Only JW grading reality, as on
2026-07-30, tests accuracy.

**A hypothesis, not a finding:** the bias changes sign between 42 and 54 h, and
HRRR's forecast range ends at 48 h. The blend loses its highest-resolution
member right where the sign flips. Suggestive, unverified, and it would need
per-model history rather than merged scores to test.

## 2026-09-07 — I took the dashboard down, and it should not have been possible

Running the 57-site terrain sweep twice exhausted Open-Meteo's hourly quota. The
elevation API and the forecast API share it, so the sweep starved the live
service and every request returned `{"error":"429 ..."}` until the hour rolled
over. Self-inflicted, but it exposed three real fragilities that a public launch
would have met on its own.

**1. No retry.** `getJSON` threw on the first non-OK response. Now retries 429
and 5xx three times with exponential backoff.

**2. No stale fallback.** A refresh failure propagated straight to the user as an
error page. Now, if the upstream refresh fails and the cache is under six hours
old, the cached forecast is served and the payload carries a `stale` block; the
header renders "⚠ upstream unreachable, data N min old". A sunrise three hours
out does not change much in fifteen minutes, and someone deciding whether to set
an alarm is far better off with data an hour old and labelled than with nothing.

**3. The cache was memory-only.** The service was restarted mid-outage and had
nothing to fall back on, which is how a transient rate limit became a hard
outage. The last good payload is now persisted to `data/last-good.json` (709 KB)
and loaded at startup — the log line is "warm start: last-good cache N min old".

**Prevented at source too:** `tools/horizon.js` now caches elevation lookups in
`tools/elevation-cache.json`. The ground does not move, so a coordinate is
fetched once and a re-sweep costs nothing; inter-request spacing also went from
250 ms to 1200 ms. Both files are gitignored.

Verified after recovery: dashboard, `/api/forecast`, the JSON:API with `?entry=`,
warm start from disk, and all five MCP tools including a live `next_opportunity`
call. Note for future stdio testing of `mcp-server.js` — piping requests and
closing stdin kills the process before its async fetch resolves, so `tools/call`
appears to hang. That is the harness, not the server.

**The standing lesson:** the free tier is a shared resource between the live
service and every offline tool in this repo. Any future bulk job needs its own
cache and its own pacing, or it competes with the thing users are looking at.

## 2026-09-08 — Five photos kept, dates recovered from EXIF, and one clean negative result

JW shared five Google Photos links. Under the new retention rule they are saved
permanently in `photos/` rather than read and discarded.

**Dates came from the files, not from asking.** Google Photos strips the EXIF
tag names and GPS but preserves the capture timestamp in the block, so every
photo could be dated without troubling JW:

    2026-06-23 21:08  Craggy Pinnacle   the glowing undercast (already cited)
    2026-07-30 06:10  Craggy Pinnacle   first live-validation morning (already cited)
    2026-07-30 06:31  Craggy Pinnacle   same morning
    2026-08-15 06:59  Mount Mitchell    NEW
    2026-06-30 06:22  Tanbark Ridge     NEW

This is the retrospective fix for the undated Green Knob citation: EXIF should
have been the first place to look, and now is.

**Tanbark: the test I most wanted, and it came back inconclusive.** The screen's
most falsifiable claim was Tanbark blocked at 4.84° on the June sunrise bearing,
and here is a 30 June sunrise photo from Tanbark showing no sun disc. It proves
nothing. Solar position at the timestamp is **−0.07°** — the sun had not risen
even on a flat horizon, geometric sunrise being 06:23 against a 06:21:48 shot.
An invisible sun a minute before sunrise is what any spot on earth looks like.

To settle it, someone needs a frame from Tanbark at roughly **06:49 EDT** on a
late-June morning: the sun reaches 4.84° then. If it is up well before that, the
4.84° is too harsh; if it is still hidden at 06:49, the figure holds.

**One thing the photo did confirm:** actual solar azimuth at the shot was 61.0°
against the probe's assumed June bearing of 60.7°. `sunBearing` is good to a
third of a degree, which was never separately checked.

**Mitchell: consistent, with a hint worth watching.** Sun altitude +1.23° at the
timestamp, azimuth 73.6°, disc clearly above the ridgeline. That places the
terrain below +1.23° — an upper bound the −1.70° prediction satisfies. But the
disc looks only one or two solar diameters clear, putting the ridge nearer +0.3°,
which would make the probe ~2° optimistic. That is the same direction as the
known overlook bias (a pull-off cut below the crest makes the DEM place the
observer too high and understate blockage).

Recorded as a hint, not a finding: it rests on eyeballing a gap in one
photograph. Two more sunrise frames with the disc close to a ridge would make it
testable.

## 2026-09-10 — The stale-cache fallback earned its keep, and revealed a gap in the retry

Two days unattended. The service stayed up throughout, and the log shows the
2026-09-07 hardening doing real work:

    Sep 08 00:01  warm start: last-good cache 0 min old
    Sep 08 20:07  upstream refresh failed (Unexpected token 'U', "Unexpected"...
                  is not valid JSON); serving cache 241 min old

That is the same failure that produced a bare error page on 3 Sep. This time the
dashboard served a four-hour-old forecast instead of nothing.

**But it should not have got that stale.** The cache being 241 minutes old means
refreshes had been failing for about four hours, and the retry never engaged:
`getJSON` only retried 429 and 5xx, while this was a **200 carrying a non-JSON
body** — almost certainly an HTML error page. The parse threw before any retry
logic saw it, so every refresh attempt failed on the first try.

Fixed: a body that will not parse is now treated as transient and retried on the
same backoff as a 503, with the offending prefix in the error message so the next
occurrence is diagnosable rather than a bare token complaint.

The general lesson, which is worth more than the fix: the fallback working is not
evidence that the layer beneath it is working. It masked a broken retry for two
days, and the only reason the gap surfaced was reading the log rather than
observing that the site was up.

## 2026-10-16 — A busy evening: a live Home discrepancy, a ground-truth store, a 20h gap diagnosed, 2-hourly snapshots, and a status-board reporter

Grid restart, work items from three weeks (wi-1819, wi-1824, wi-1852, wi-1853)
plus a live, 15-minutes-to-sunset discrepancy report from Jarvis, all at once.

**Live triage: Home graded F, JW said "looks like it's going to be beautiful."**
The no-go ("Socked in, 100% total, 100% low cloud") was real but was reading the
wrong clock. Open-Meteo's live NOWCAST at 18:30 — the freshest actual reading —
said 84%/84%, visibility 22.8 km, RH 65%: not socked in. The no-go fired off the
HOUR-AHEAD FORECAST bucket for 19:00 (sunset 18:52 rounds to it), which jumped
71%->100% within a single hour alongside RH 48%->81% and a 6C temperature drop
in that same hour — forecast noise at an unstable moment, not a settled sky. The
"100% low cloud" input wasn't wrong; it's an hour-ahead forecast being trusted
over same-service nowcast data minutes before the event, with nothing preferring
the fresher read. Reported live to Jarvis; not changed on one night — waiting on
JW's actual outcome (ground-truth/observations.jsonl, entry pending).

**Ground truth now has a durable, in-project home.** `ground-truth/` (not
gitignored, like `HISTORY.md`) holds `observations.jsonl`: site, event, what was
observed, what SkyMagic said at the time, and a verdict. JW's instruction
(2026-10-04, via Jarvis) was to the app, not to Jarvis's own notification log —
so this is a second, independent copy credited to Jarvis's reporting, not a
pointer to it.

**The Craggy miss (2026-10-04), diagnosed and fixed.** JW spent two hours
summit-fogged at Craggy while SkyMagic read C+ (2.31). Two things were wrong,
not one: (1) `cloud_cover_low` at the site read only 11% even though `total` was
100% — the overcast wasn't filed under "low" by the model's own banding, but a
5,600ft summit sitting in it doesn't care which band; (2) the dew-point spread
(2.1C) and RH (87%) fell just under the 96%/1.5C ground-fog threshold, which was
calibrated for a valley site's radiative fog, not a ridge riding inside a
saturated layer. Worse: both existing fog checks sit inside `if (!dyn?.dynamic)`,
and this forecast was explicitly volatile ("deck in motion") — so neither check
would have fired regardless of its threshold. That guard is right for its own
evidence (June 23 2026 Craggy: a fog wall cleared to a glowing undercast in three
minutes — a view-BLOCKING deck that can open a window) but wrong for this case:
being physically inside the cloud doesn't depend on which direction you look, and
a volatile forecast doesn't mean it resolves in your favor.

Fix: a new no-go, "Possibly in cloud at the summit," checking dew-point spread
directly (<=2.5C) against total cloud (>=85%), placed OUTSIDE the dynamic-deck
guard, scoped to `site.elevM >= 1600` — the two true summits, Craggy (1766m) and
Mitchell (2014m), using the DEM elevations already trusted from the September
terrain work. Green Knob (1499m) and Home (649m) are excluded on purpose; being
an overlook or a valley site is a different physical situation. Verified against
the exact confirmed numbers (spread 2.1, total 100 -> fires) and against
sanity cases that must not fire (clear ridge day; high thin dry overcast; Green
Knob given Craggy's own numbers, to confirm the elevation gate holds).

Honest caveat, matching project discipline: this is confirmed against **one**
instance (Craggy). Mitchell is included on the same physics, not its own
evidence, and has no confirmed case yet.

It did not wait long for a second data point. Live tonight (2026-10-16, the
same evening as the Home discrepancy above), both Craggy and Mitchell read dew
spread 0.0C and visibility 0 km — genuinely fogged in, independently of the
Home situation, on the first night this check has run. Not proof by itself (one
more observed night, and the summits were obviously bad regardless), but the
mechanism behaved exactly as designed on live data within hours of being
written.

**The 20-hour snapshot gap (wi-1824), root-caused.** `history.js record` was
crashing outright, not skipping quietly: a ~16h host DNS outage
(`EAI_AGAIN api.open-meteo.com`, Oct 6 00:07-16:07) threw a network-level
exception straight out of `fetch()`, which the 2026-09-10 retry hardening never
caught — that fix only handled bad HTTP status and corrupt JSON bodies, both of
which require a response to exist in the first place. Four consecutive 4-hourly
cron runs each burned their retry budget and died uncaught, losing that cron
slot entirely. The live dashboard survived on its stale-cache fallback (serving
up to 1347 min old); the collector had no equivalent and simply produced
nothing for 16 hours. Fixed: `getJSON` now wraps the `fetch()` call itself in
the same retry/backoff as a bad response, so a brief network blip inside one
invocation no longer crashes it. A sustained outage like this one will still
produce a gap — the structural fix is detecting that gap, not eliminating it;
see the status-board reporter below.

**2-hourly snapshots inside 12h of an event (wi-1824).** JW: "go to two hours
in the last 12 hours," after watching an A- turn into a B+ overnight with no
visibility into when or why. Jarvis's own drift analysis (336 events,
Jul 28-Oct 7) backs the threshold: average |score change| is 0.07 inside 6h,
0.31 at 6-12h, ~0.45 at 12-48h — nearly all the settling happens inside 12h.
`history.js record` takes `--max-lead=N` to snapshot only events within N hours;
cron now runs it at the complementary even-hour offset from the existing
4-hourly job (hours 2,6,10,14,18,22 vs 0,4,8,12,16,20), giving true 2-hour
resolution inside 12h with no duplicate snapshots at any hour. Tested live: an
unfiltered run recorded all 6 events in the 72h horizon; a `--max-lead=12` run
in the same minute recorded exactly the 1 event actually inside that window.

The specific case that prompted this — Mitchell sunrise 2026-10-07, A- at 19h/
15h/11h out dropping to B+ at 7h/3h, entirely from Horizon (2.9->1.68, a distant
cloud bank appearing late while Clouds/Clarity/Color held steady) — was
reviewed and is not a bug. It is the open Horizon question already on record
(CLAUDE.md: "Horizon ... samples cloud at fixed distances with no terrain
model"): a real, late-forming feature the old 4-hourly cadence could only show
as a before/after jump. The new cadence will show the transition happening
rather than just its two endpoints. Jarvis's two follow-on ideas — flag a grade
near a band edge; show a stability hint from recent snapshot churn — are
recorded for JW to decide, not implemented.

**Status-board reporting (wi-1852, wi-1853).** `script/report-health-to-status-
board`, mirroring the existing `happy_thoughts` reporter on this box: cron
checks every 15 minutes (cheap, local), but only POSTS once a day, or
immediately if the score has gotten worse since the last post — so a real
failure is never more than 15 minutes from being visible, without spamming the
board hourly. Reports two ids: `skymagic.data` (is the live fetch fresh right
now, is the NPS closures source reachable) and `skymagic.snapshots` (how old is
the latest history.db row — this would have scored 0 throughout the Oct 5-6
gap). JW's own words were the design brief: "if it can't get data, that's a
problem" — so an unreachable SkyMagic scores 0 rather than the reporter staying
silent, which is the one deliberate departure from the happy-thoughts precedent
(that script chooses not to post rather than report a guess; JW asked for the
opposite here). Tested live: posted successfully, confirmed landed in
`status-board.sqlite` as two rows at score 4.0, matching the already-registered
`skymagic` app entry (expected_minutes=1500, i.e. 25h, exactly what wi-1853
asked for).

## 2026-10-16 (addendum, same evening) — the live triage above was wrong

JW's actual outcome for tonight's Home sunset, via Jarvis at 18:54: "the clouds
rolled in." The F / "Socked in" no-go was **correct**. The 18:30 nowcast (84%,
"looks beautiful") was the misleading read, not the hour-ahead forecast bucket
it was compared against.

The live triage sent to Jarvis at ~18:37 said the no-go was trusting a noisy
hour-ahead forecast over fresher nowcast data. That direction was backwards. A
nowcast is a snapshot with no lead time — it cannot see a deck that arrives in
the next twenty minutes. A short-range forecast model assimilating recent
radar/satellite sometimes can, and tonight it did. The sharp 71%->100% jump and
the RH/temperature swing that looked like "forecast noise at an unstable
moment" was, in hindsight, the model correctly resolving a fast-moving system —
exactly the deck JW then watched roll in.

No code was changed on the strength of the live triage — deliberately, pending
this outcome — so nothing needs reverting. The value of waiting showed up
immediately: acting on the 18:37 read would have meant teaching the no-go to
prefer the nowcast, which tonight's result argues directly against. JW: don't
switch to preferring nowcast based on this one night; if anything it is
evidence the hour-ahead bucket is doing its job. `ground-truth/observations.jsonl`
updated to `confirmed-hit`, correcting its earlier `pending` entry.

## 2026-10-16 (second addendum) — a second photo: right on the sun, blind to the scene

Five minutes after the first photo, looking further left, JW sent a second:
a towering cumulus wall, broken blue-gray gaps, a clean orange band at the
horizon — but the cloud bases themselves flat gray, unlit. His own words: "it's
still beautiful but it's covering the sunset... a little to the left you can see
it would have been beautiful." His estimate: the sun itself was an F (correct);
the broader scene was closer to a C.

That is not a new distinction for this project — it is the one the Horizon leaf
already makes for distant cloud, scoring shape and light-path separately
(`h35-shape` / `h35-block`). What tonight shows is that the site's own overhead
sky has no equivalent: Clouds/site-view asks how much is covered, not whether
light is reaching what's there. Worth watching for a second occurrence; not
implemented tonight — two photos from one evening is exactly the small sample
CLAUDE.md says not to act on alone. Both photos kept: `photos/2026-10-16_home_
sunset_1.jpg` and `_2.jpg`; both referenced from the same `ground-truth/observations.jsonl` entry.

## 2026-10-16 (third addendum) — JW corrects the correction: it was geometry, not light in general

JW, directly, disagreeing with the "maybe a C" estimate in the previous
addendum: "This is not a C. This could be an A if the sun were some number of
degrees to the left." The cumulus wall, the gaps, the clean horizon band —
genuinely A-grade structure. The sunset itself was F for one specific reason:
the sun set behind the solid part of the deck, a few degrees from a gap that
was sitting right there.

That reframes the finding. It isn't "light didn't reach the clouds" in
general — it's that a gap's position relative to the sun's exact azimuth can
matter more than how much sky is covered overall. A deck can be mostly open and
still blank if the one solid patch sits on the sun; a deck can be mostly closed
and still spectacular if the one gap sits on the sun. JW's own suggestion:
model that directly — cloud cover along the sun's bearing specifically, not
aggregate coverage.

Recorded honestly with its limit attached: every cloud field this app has
access to (`cloud_cover`, `cloud_cover_low/mid/high`) is an areal fraction per
grid cell, not an angularly-resolved field. There may be no data source
available at the resolution this idea needs. It is the sharpened, correct
version of the "shape vs light-path" note above and likely the same mechanism
as the already-open Horizon-leaf limitation (fixed-distance sampling, no fine
angular resolution around the sun's bearing) — not a new problem, a clearer
statement of one already on record. Not implemented tonight.

## 2026-10-16 (fourth addendum) — texture vs coverage, and the leaf that already half-exists

JW's third observation tonight: "If the sky is 80% or 90% cumulus and they're
interesting and textured, that's really different than if it's 90% flat
solid." The "Socked in" no-go only ever looks at total and low-cloud coverage —
it cannot tell a dramatic cellular deck from a dead slab at the same percentage.

This lands directly on existing code, not a gap in capability. `leafTexture`
(server.js, "Texture (CAPE)") already exists for exactly this distinction,
weighted a deliberately light 0.08 inside Clouds, flagged in its own comment as
"experimental ... here to play with over time" since the original coastal-photo
lesson (55% broken altocumulus beats 55% slab, but coverage alone can't see
it). It is simply never consulted by `detectNoGo`.

Tonight's own reading is a useful, if imperfect, data point: CAPE 23 J/kg read
"slab-prone" — consistent with photo 1's flat deck. But photo 2, looking at a
different part of the same sky, showed a visible convective tower that one
grid-cell CAPE sample never captured. So JW's instinct is right, and the
existing machinery to act on it already exists — but a single sampled CAPE
value may itself be too coarse to resolve a sky that isn't uniform across its
own frame. Promoting an explicitly-experimental, lightly-weighted leaf to gate
a hard F needs its own validation before it should carry that much weight; not
done tonight.

Jarvis's own idea, independent of JW's: a fixed west-facing camera plus a
vision model on JW's spare GPU, labeling every sunset automatically (gap on the
sun or not, bases lit or not, texture vs flat) as continuous ground truth. It
cannot forecast anything, but it could calibrate against reality every single
evening rather than whenever someone happens to report one. JW's call; not
started.

## 2026-10-22 — Clouds almost never scores above a B+, and part of why is real

JW, via Jarvis: SkyMagic almost never reports good clouds. Jarvis checked
history.db (169 events since July 28, last-snapshot-before-event, 3 sites):
Clouds has never scored an A anywhere, max 3.63, averages cluster at 2.3-2.4
(a straight C). Asked to look at the curve and recalibrate.

Checked against a larger pull (595 snapshots, same window, full component
breakdown) and confirmed it's reproducible, not noise. Found two separate
things, only one of which I'd act on without a confirming photo:

**Real, and fixed.** The "high (cirrus)" leaf sits at or near its floor
(1.8, i.e. D+) in 83% of samples (483-495 of every ~595), because cirrus is
genuinely absent most evenings here — but it's the heaviest-weighted of the
three altitude leaves (0.38) and applies that floor identically whether the
rest of the band has real low/mid structure or is truly empty. The floor was
deliberately tuned (see 2026-07-30 above) for the all-empty case specifically
— at full weight it was dragging good nights down for no reason. Loosened to
3 (not 1.8) whenever the SAME band's low or mid cloud reads >= 10%, leaving
the already-calibrated all-empty case untouched. Simulated against 1,785 real
band-samples first: average band blend moves from 2.37 to 2.46 — real, right
direction, modest. Shipped; verified live (near band, 2026-10-22, still all
0% → unchanged 1.8; far/mid bands with 13-17% low cloud → now 3 instead of
1.8).

**Real, probably, but not acted on.** Actual readings here are fairly
bimodal — each altitude band sits near 0% or near 100% most of the time,
rarely in between. A genuinely good night needs several altitude bands AND
model consensus AND texture all landing in their middle ranges at once, which
is a rare joint event close to by construction. That the root Overall score
gets the "outside-sensitive" stretch (built specifically to stop blends
clustering at the pivot) and Clouds never does is suspicious — but Clouds'
current blend sits BELOW the pivot (2.37-2.52), so applying that same stretch
would push the middle further toward D/F, not toward A. It would only help if
there's a specific night to calibrate the stretch against, and the only
photographed case on hand (10/16, see above) is the azimuthal-gap issue, a
different claim. Not implemented: per this file's own rule, a statistical
pattern isn't a confirmed mismatch. Jarvis has asked JW for an anchor — a
night, ideally with a photo, where the cloud *structure* was genuinely good
and Clouds read C or worse that isn't already explained by 10/16 — and will
route future great-sky photos straight here with the event's score attached.

## 2026-10-22 (same day) — JW's actual fix: stop averaging cirrus against the rest

Before any photo came back, JW gave the real design direction, via Jarvis:
"we shouldn't be averaging cirrus versus other clouds. We should be taking
the highest score for any cloud type in that range" — MAX over high/mid/low
within a distance band, not a weighted blend, so an absent cirrus layer can't
drag down a great low or mid deck. His own caveat: a thick low deck that
actually hides the sun or horizon still has to count against it through
Horizon and the no-go logic, so the max belongs on the canvas side, not the
blocking side.

That split already exists architecturally — `leafSiteView` (merged by `min`
at the Clouds level, not inside a distance band) and `detectNoGo` both read
raw site cloud_cover directly and don't look at these per-altitude leaf
scores at all, so switching the altitude merge to `max` doesn't touch
blocking.

Implementing it plainly broke the one field-confirmed calibration point in
the whole tree: the morning-of fix two sections up, which loosened the cirrus
leaf's empty-sky floor conditionally, turned out to be solving the SAME
problem `max` solves directly — and under `max` it actively backfires (an
overdone, genuinely bad low deck could win against a loosened, merely-absent
cirrus floor on raw coverage % alone, regardless of whether the low deck's
own score was good). Reverted that leaf back to its plain floor.

Bigger issue: `lowLeaf`'s v<=5 case flatly scored 3.2, calibrated assuming
dilution via the (now gone) weighted average — under `max` that flat 3.2
would single-handedly win over the empty cirrus/mid floors (1.8/2.5) and
turn every totally clear sky into a B-, directly contradicting the
2026-07-30 Craggy field calibration ("can't be higher than a C+" for a sky
with nothing at any altitude). Ramped it: 2.4 at v=0 up to the original 3.2
at v=5, so MAX(high 1.8, mid 2.5, low 2.4) = 2.5 for a genuinely empty sky —
same C+ ceiling as before, verified live (today's forecast, all four sites,
every band genuinely 0% at every altitude, reads 2.4-2.45 C+ exactly as
before this change).

Simulated the altitude-band-only effect against 1,785 real band-samples
(same pull as above): average band blend moves from 2.22 to 2.89, and
A-grade band readings go from 1 in 1,785 to 350 (19.6%) — a large, intended
unlock, not a rounding change. This is the distance-band subtree only, not
the full Clouds score (which still blends against model consensus/texture
and is capped by `min` with site-view), so the real Clouds distribution will
move by less than this, but in the same direction. No photo anchor needed
for this part — the design direction came straight from JW, and the only
calibration risk (the empty-sky ceiling) is verified reproduced exactly.
Jarvis is still gathering good-sky photos to validate the differentiation
itself (does a genuinely great low deck now read as the A/B it should).

## 2026-10-22 (later the same day) — home was ~900 m off, and 146 new calibration photos

JW shared a full Google Photos album for calibration. Pulled all 146 photos
(headless Chromium — the album page is 100% client-rendered — plus the
`=d` URL suffix, which preserves full EXIF including GPS on download) into
a sibling, not-committed directory:
`/home/jw/projects/mustmodify/skymagic-calibration-photos/`. Full writeup
there; summary here.

**`home`'s coordinate was wrong by ~900 m.** All 75 home-area photos, across
five years, clustered within ~30 m of each other and consistently 847-914 m
from the stored `CONFIG.sites.home` coordinate. JW confirmed by satellite:
the real point is `35.68826911411407, -82.52467580364578` (his backyard,
within 1 m), and the old one was simply wrong — but, unlike Green Knob,
"probably close enough for previous calibrations... the sky is probably the
same," so the existing photo-calibrated curves were NOT treated as
invalidated by this move. Fixed: coordinate, elevation (678 m from the DEM),
and the advisory (not scoring-wired) horizon-probe note, all updated in
`server.js`. History rows recorded under the old coordinate were left in
place — open question for JW: delete them (Green-Knob style) or leave them,
given his own "probably close enough" framing.

**The Craggy roadside pull-off wi-1777 has been waiting on — found and
pinned to 17 m.** JW confirmed by description: "the roadside spot where I
take sunset photos over the craggy mountains... if I don't have time or
it's too windy/cold to hike up to craggy pinnacle." 11 photos across three
separate years cluster within 17 m of `35.71377652, -82.36280480`. Not
added to `CONFIG.sites` yet — JW's call on naming/adding it.

**The already-known craggy coordinate gap, independently reconfirmed.**
Separately, 10 more photos cluster within 116 m of `35.70352861,
-82.37758333` — itself within ~30 m of the OSM summit point
(`35.70345,-82.37790`) that a comment on `CONFIG.sites.craggy` already
flags as 475 m from the *stored* craggy coordinate. Real photo GPS now
backs up a gap the code already knew about. Not fixed — still don't know if
the stored point is deliberately the trailhead/parking rather than the
summit.

**22 of JW's own photo captions recovered** — Google Photos descriptions,
not EXIF, so they needed a second headless-browser pass through the
lightbox view (matched back to the downloaded files by exact EXIF
timestamp, after discovering the grid thumbnail and lightbox image URLs use
different, non-comparable signed tokens). 11 are geolocated; 11 are not
(Canon 5D / early Pixel 7, no GPS) — real near/mid/far/horizon grading with
no site to attach it to. One of those, 2023-04-29, is notable on its own:
JW's own words, "the kind of cloud may determine optimal coverage level...
just a theory" — the same texture-vs-coverage idea that resurfaced
2026-10-16 and is still an open item above, three years earlier.

## 2026-10-23 — the dashboard was blocking every request on a slow upstream

Jarvis reported, at JW's request: skymagic.data was F on the status board,
the health reporter logged "SkyMagic unreachable: ... timeout" (overall=0),
and a hand check found one request to `/api/opportunities.json` timing out
at 20s followed by a 4.3s success. Separately, the reporter's cron had been
silently failing since 2026-10-16 on `env: node: No such file or directory`
(a stale PATH) and was fixed to report again; `happy-thoughts`'s reporter
has had the same symptom since 2026-10-13 but belongs to a different
project.

Root cause: `getRaw()` only served `cache.raw` immediately while it was
inside the 15-minute TTL. Once the TTL passed, *every* incoming request
awaited `cache.building` — the full `fetchAll()` chain — rather than just
the one that triggered the refresh. `getJSON`'s retry backs off up to
~10.5s across 3 attempts on any 429/5xx/non-JSON response, on top of the
calls themselves, so any ordinary upstream hiccup (the log shows two,
2026-10-23 00:00 and 00:04: a non-JSON body and a 503) stalled every
request for that whole span. This was already live code, unrelated to
anything changed this week — it just hadn't been hit hard enough to notice
before.

Fixed with stale-while-revalidate: once there's *any* cache under
`STALE_LIMIT_MS` (6h), serve it immediately and let the background refresh
in `cache.building` finish on its own, regardless of whether the TTL has
passed. Only block on `cache.building` directly when there's truly nothing
usable cached (first boot with no last-good file, or cache older than 6h).
Verified live: restarted the service, warm-started from a 6-minute-old
cache, `/api/opportunities.json` answered in 72ms.

## 2026-11-05 — a Socked-in F, 25 minutes before an A sky

JW, via Jarvis: two photos of home's sunset, verdict "That's an A" — broken
pink-lit cumulus with real gaps, then amber afterglow. SkyMagic's final
pre-event snapshot (22 min before sunset) called it F, "Socked in (100%
total, 100% low cloud)."

The full leaf dump (history.db) shows the no-go fired on the site's own raw
cloud reading, but every other signal in the same snapshot pointed at a
broken, not flat, deck: `clouds.bands.far.far-low` read only 13% (A) against
100% (F) near/mid — the deck was clearing outward — and
`clouds.bands.texture` (CAPE) read 1563 J/kg, "convective towers" (A-),
exactly the cellular-instability signature that would produce patchy, not
uniform, cloud. `detectNoGo`'s volatile-deck gamble guard didn't trigger
(swing/wind under its threshold), so Socked-in stood as a hard no-go instead
of a gamble.

This is the second confirmed instance of the idea flagged 2026-10-16 and
not acted on then ("coverage alone shouldn't decide the no-go... textured
cloud at high coverage can still be a great scene") — different night,
different supporting signal (CAPE + far-band gradient this time, not a
second photo of the same sky), same fix implied: the no-go shouldn't trust
raw site-level total/low coverage alone when texture or the band gradient
says the deck isn't uniform. Logged to `ground-truth/observations.jsonl` as
confirmed-miss. Not changed — `detectNoGo` is core no-go logic and this is
JW's call, not a reflex same-night fix, but the evidence bar this file sets
for itself (survive a second, differently-drawn check) looks met.

## 2026-11-06 — JW made the call: fixed

JW, via Jarvis: "it was an A so... we should fix that." The evidence bar
above is now moot — this is a direct instruction, not a same-night reflex.

`deckDynamics` (the existing volatile-deck gamble guard that already covers
temporal swing and wind) gained a second signal: a far-band gradient
(site/near low cloud minus the far band's) of 50 points or more, AND the
mid-band CAPE reading in "convective towers" territory (>1500 J/kg, the same
threshold `leafTexture` already labels that way). Both conditions are
required, not either alone — see why below. When it fires, `detectNoGo`'s
existing `!dyn.dynamic` guard already treats Socked-in as a gamble instead of
a hard F; no change was needed there.

Why both conditions: 2026-10-16 had the identical huge gradient (100% near
vs 0% far) but CAPE 23 ("slab-prone") — a flat, stable deck that just hadn't
reached the far sample yet, not one breaking up. That F was correct (the
clouds really did roll in solid). Gradient alone would have wrongly turned
that night into a gamble too. Replayed both nights' recorded leaf values
against the new rule:

- **2026-11-05** (the miss): gradient 100−13=87 ≥ 50, CAPE 1563 > 1500 →
  `dynamic: true`. Socked-in no longer fires. Recomputed overall (full tree,
  no override): **2.87, B-** — `clouds` rises from the forced 0.5 (F) to
  2.0 (`min(bands 3.06, site-view bumped 0.5→2 by the now-true
  `brokenDeckLikely` check)`), then blends with horizon/color/haze/air/access
  through the same root merge as always. Not the A JW's photos showed — the
  tree still doesn't know the deck is breaking up *in his favor*, only that
  it's breaking up — but no longer a false, flat F either.
- **2026-10-16** (the control): gradient 100−0=100 ≥ 50, but CAPE 23 ≤ 1500
  → `dynamic` stays `false`. Socked-in still fires. Overall stays F, same as
  that night — correctly unchanged.

Verified `node --check` and a live restart (warm within 2s, `/api/opportunities.json`
200 in 98ms). Still unvalidated against anything but these two nights — the
same "least-tested" caveat as the CAPE texture leaf itself applies to this
gate.

## 2026-11-07 — the grade distribution is two piles, not a curve

JW asked (via Jarvis) for a year of best-site-within-3h scores to look at.
Jarvis's own histogram of the 125-event sample (sunrise 64 / sunset 61) was
"terrible" per JW, and separately JW called the B+/A- pile-up "makes no
sense" — he expects a median around C+, some A+, a normal-ish spread. Two
real findings underneath that complaint:

1. **The "year" is 3.3 months.** `data/history.db` starts 2026-07-28; that's
   all there is. Flagged back — not an error, just a caveat the sample needs.
2. **The pile-up is real, not a small-sample artifact.** Independently
   recomputed Jarvis's 125-event sample from `score_history`/`history.db`
   directly and got matching counts, then checked it against the full
   corpus per this file's own rule: 13,645 `overall` rows across 740
   snapshots. Grade counts: B+ 5073, F 3693 (no-go), A- 1998, C 618, C+ 556,
   B 512, C- 506, D+ 380, A 146, B- 99, A+ 38, D 26. Excluding no-go F's, B+
   is 51% of everything and B- is 1% — a dip one grade below the pile that a
   smooth distribution wouldn't produce. Median score overall (no-go
   included as 0) is 3.38 (B); mean is 2.385 (coincidentally near C+, but
   only because ~27% of all rows are hard-F no-gos dragging a bimodal
   distribution's average down, not because typical nights center there).

Root cause (see CLAUDE.md, same date, for the full mechanism): the six
branches feeding the root merge already average B-/B/B+ individually
(`clouds` 2.37 through `vantage` 3.88), the cumulative result of many
individually-justified floor raises over this project's history, none of
which were re-checked against each other. The `outside-sensitive` merge's
`3 + (x-3)^0.42` stretch, pivoted at a hardcoded 3.0, then takes that
already-elevated blend and stretches anything above the pivot hard toward
B/B+, while A (raw ≈4.0, every branch near-max) stays almost unreachable —
matching both the B+ pile-up and the near-absence of A/A+ (1.3% combined).

Not changed. Reported to JW via Jarvis with the root cause and candidate
directions (move the pivot to match the real component average vs. walk
back specific floors vs. both); this rewrites the meaning of the whole
grade scale and would need re-walking every confirmed calibration point in
this file, so it's his call on direction before any code changes.
