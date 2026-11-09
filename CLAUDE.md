# Working notes for focus-forecast

## What the app is for

JW photographs sunrises and sunsets from a handful of spots on the Blue Ridge
Parkway. Mount Mitchell is fifty-one minutes away and Craggy Pinnacle needs a
twenty-minute hike in the dark, so the real question is never "what's the
weather" but "is tonight worth getting up for." The app answers that: for every
sunrise and sunset in the next seventy-two hours it scores each site from 0 to 4,
grades it on a letter scale, and works backward from the light to a departure
time and an alarm time.

The score comes from a tree of metrics in `server.js` — clouds by distance band,
horizon, haze, color potential, air quality, and how much sky the spot can
actually see. Each leaf turns data into a number; parents blend their children.
A no-go condition like fog or a closed road overrides the whole thing to F.

The point of the grades is that they match JW's eye, not a textbook. A sky he
calls "a C at best" needs to score near 2.0. That is the whole standard.

**It is going public as SkyMagic (skymagic.app).** That changes the standard in
one direction only: the grades still have to match JW's eye, but everything
personal has to be absent and everything uncertain has to be visible. JW knows to
read a B+ at sixty hours as "maybe". A stranger does not.

## What I'm here to do

Two things, mostly. Keep the scoring honest against real photographs, and be
careful about what counts as evidence for changing it.

The second is harder than it sounds and is why the next section exists.

## Check a small-sample finding against a bigger sample before you act on it

Most of what this project measures comes in small quantities: a handful of model
runs behind one score, one photo of one sunset, ten years of one calendar week.
Small samples produce findings that look strong and are not. Before a number
changes a curve, goes into a document, or gets sent to JW, try to reproduce it
on a larger or differently-drawn sample. If it survives, say how strongly it
survived. If it doesn't, drop it.

The habit is cheap. Every time it has been skipped here, the finding was wrong.

### It was skipped once, in the festival weather report

The first draft said the closing weekend of the Texas Renaissance Festival was a
rain trap: 43% of its weekend days had rain, roughly three times every other
week. That number was real, and the conclusion drawn from it was not.

The week had only fourteen weekend-days on record. Three wet days either way
moved the rate by twenty points. Pooling in weekdays — seventy days per week
instead of twenty — dropped it to 26%, which is what almost every other week of
the season shows. Across the whole season the range was 16–29%, and every week's
confidence interval overlapped every other week's. There was no signal at all.

The tell was visible before the check: eight of the nine weeks came out at
15–20%, which is what happens when a sample is too small to separate anything,
not what genuinely uniform weather looks like. A second tell was that reranking
the weekends with rain pooled differently moved one week from first place to
seventh. A conclusion that moves that far when you change the estimator was
never resting on the data.

It was caught before JW read it, and the fix was to rank on temperature instead,
which holds up under both samples.

### It was applied once, and the finding survived

Later in the same report, rainfall during the week *before* each festival
weekend looked like it separated the weekends — the grounds are unpaved, so a
wet run-up means mud. Same small sample, ten observations per week.

Checking it against all-day anchored windows instead of Saturday-anchored ones
gave close agreement and the same ordering, so the finding held. But the
standard errors were still large next to the differences it was being asked to
support: the key comparison came to about 1.3 standard errors. So it went into
the report as corroboration for a conclusion already reached on temperature, and
explicitly not as independent evidence for it.

Surviving the check is not the same as being strong. Say which one it is.

### The same rule already governs curve changes

`HISTORY.md` and the photo-calibration notes say a curve only moves once JW has
confirmed a specific mismatch, and that one ambiguous photo isn't enough. That
is this rule in the form the project meets most often. When JW hedges — "I could
be wrong" — that is not a confirmation, and nothing gets written up.

The photos themselves are now **kept** (JW, 2026-09-07, reversing the old delete
rule): a Green Knob photo had shaped real curves, and when the site's coordinate
turned out to be 4 km wrong there was nothing left to re-check it against.
Restraint about *citing* a photo is unchanged; restraint about *keeping* one was
a mistake. Record the date and site — check EXIF first, Google Photos preserves
the capture timestamp even when it strips the tag names.

Curves in `server.js` cite the photo that shaped them. A citation is a promise
that someone confirmed the reading, so don't add one for a photo that only
suggested something.

### In practice

- Before publishing a rate, ask how many observations are behind it and what
  three more would do to it.
- Where a bigger or differently-drawn sample exists, run the finding through it.
  Weekday data, longer windows, a second anchoring — whatever is available.
- Report the uncertainty next to the number, not in a footnote.
- If a conclusion reorders when you change a defensible choice of estimator,
  it isn't a conclusion yet.
- Say plainly when something has been retracted. In the report above, the
  reversal is documented in the document itself rather than quietly patched.

## What we've tried so far

The full decision log is `HISTORY.md`, and every scoring entry there names the
photograph or backtest that drove it. The short version of where things stand:

**Validated against real evidence.** The color curve was confirmed by a Home
photo from 4 May 2026 — "a kind of B sky, but the color!!!" — which backtested to
3.80 with the aerosol depth sitting in the middle of the saturation range. That
same photo exposed a real problem: coverage figures can't tell a thin translucent
veil from a solid one. Testing direct-radiation fraction across all seven dated
photos separated them cleanly, so that became the veil proxy.

Two rescues came out of the archive. A magnificent Craggy sunset from October
2022 scored 0.5 on view because the reanalysis called the site fully overcast
when the photo shows broken cumulus with sunbursts — coarse grids do that to
ridge-hugging cloud routinely. And two Craggy photos taken three minutes apart in
June 2026, a fog wall then a glowing undercast, established that a moving deck is
a gamble worth taking rather than an automatic no-go.

**Confirmed in the field once, which is not the same as settled.** On 30 July
2026 we predicted a Craggy sunrise at B+ before it happened and then graded
reality. Color and haze held up. Clouds was too harsh: an entirely empty sky was
being floored at D, which is right for bad structure and wrong for plain absence,
so those floors went up. Note that the new floors are calibrated to exactly one
morning. They are the least-tested numbers in the tree.

**An idea from two photos, sharpened by JW directly, not yet acted on.** On
2026-10-16, Home's F ("Socked in") turned out right — but JW's second photo
showed a cumulus wall, real gaps and a clean horizon band that he rated A-grade
structure, not the C it first looked like. His own words: "This could be an A
if the sun were some number of degrees to the left." The sunset was an F purely
because the sun set behind the solid part of the deck, a few degrees from a gap
that was right there. His own framing: whether cloud sits ALONG THE SUN'S
AZIMUTH at the moment of the event may matter more than aggregate coverage.

That's sharper than "shape vs light-path" and is likely the same root cause as
the existing Horizon-leaf limitation below (fixed-distance sampling, no fine
angular resolution around the sun's bearing) — but be honest about the limit:
`cloud_cover` fields from every model here are AREAL fractions per grid cell,
not angularly resolved. There may be no available data source that can say "is
there a gap exactly where the sun is" at the precision this needs, which is a
real ceiling on what can be done even with the right idea. Not implemented —
one evening is not grounds to add a metric. See
`ground-truth/observations.jsonl`, 2026-10-16.

**A third idea, and it points straight at existing code.** JW, same evening:
"If the sky is 80% or 90% cumulus and they're interesting and textured, that's
really different than if it's 90% flat solid." Coverage alone shouldn't decide
a no-go. This maps directly onto `leafTexture` (server.js, "Texture (CAPE)",
weight 0.08 in Clouds) — already there, already commented "experimental ...
light weight, here to play with over time" — but `detectNoGo`'s "Socked in"
check never looks at it, only total/low coverage. Tonight's own reading (CAPE
23 J/kg, "slab-prone") matched photo 1's flat deck, but photo 2 — a different
part of the same sky — showed a visible convective tower the single grid-cell
CAPE sample never saw. So the idea is right, but the existing signal may itself
be too coarse to fully deliver it; real sky isn't uniform across one sampled
cell. Not implemented *then*: promoting an admittedly-experimental,
lightly-weighted leaf to gate a hard F is exactly the kind of jump this
file's own discipline (above) says needs validation first, not a same-night
change.

**Implemented, 2026-11-06, on JW's direct instruction.** A second confirmed
instance (Home, 2026-11-05: Socked-in F, 22 minutes before JW's photos
showed a broken, colorful A sky) met the two-check bar above, and JW then
said plainly: "it was an A so... we should fix that." `deckDynamics`
(server.js) now also reads `dynamic: true` when the far band is clearing
relative to near/mid (gradient ≥50 points) **and** mid-band CAPE is in
"convective towers" territory (>1500 J/kg) — both required, since
2026-10-16 had the same huge gradient but CAPE 23 ("slab-prone") and that F
was correct. `detectNoGo`'s existing `!dyn.dynamic` guard needed no change;
it already treats Socked-in as a gamble rather than a hard F once
`dynamic` is true. Replayed both nights on the recorded leaf values:
2026-11-05 now scores 2.87 (B-, no longer a flat F — not the A the photos
showed, but no longer false either); 2026-10-16 is unchanged at F, correctly.
See `HISTORY.md`, 2026-11-06.

Jarvis separately floated a fixed west-facing camera + vision model on JW's
spare GPU as continuous ground truth — gap-on-sun, lit/unlit bases, texture vs
flat, every sunset, automatically. Can't forecast, but could calibrate
continuously. JW's call whether to pursue; not started.

**A big-sample finding, 2026-11-07: the overall grade distribution is not a
curve, it's two piles.** JW asked for a year of best-site scores (Jarvis
supplied 125 events; the real window is 3.3 months, all the database has —
flagged back to him) and immediately said the B+/A- pile-up "makes no
sense": he expects a median around C+, occasional A+, a normal-ish spread.
Checked against the full corpus, not just that sample: 13,645 `overall`
rows across 740 snapshots. Confirmed, not a sampling artifact — grade
counts are B+ 5073, F 3693 (no-go), A- 1998, then C 618 / C+ 556 / B 512 /
C- 506 / D+ 380 / A 146 / B- 99 / A+ 38 / D 26. Excluding no-go F's
entirely, B+ alone is 51% of everything and B- — one grade below it — is
barely 1%, a dip exactly where a real distribution wouldn't have one.

Root cause, traced through the actual leaf averages (same corpus): the six
branches feeding the root (`clouds` 2.37, `horizon` 2.76, `color` 2.93,
`air` 3.07, `access` 3.28, `haze` 3.48, `vantage` 3.88 where present)
already average B-/B/B+ individually, not the C+/B- JW expects for
"typical." Each one got there honestly — `lowLeaf`'s floor ramped 2.4→3.2,
`access`/`haze` default near-max absent contrary data, `highLeaf`/`midAltLeaf`
floors raised for the 2026-07-30 Craggy calibration — every change cited a
real photo and was locally correct. Nobody has looked at what they add up
to until now. The root's own `outside-sensitive` merge then applies
`3 + (x-3)^0.42` to the weighted blend of those six, with the pivot
hardcoded at exactly 3.0 ("B-"). That function's slope is steepest right at
the pivot — since the real blended average now sits at ~3.0–3.1, almost
every night gets stretched hard into B/B+ territory, while A- needs raw
≈3.4+ and plain A needs raw ≈4.0 (every branch near-max at once) — which is
why A/A+ combined are 1.3% of the corpus. Two independent drifts (floors
up, pivot unmoved) compounding into one cliff.

Not changed at the time. This touches every previously-confirmed calibration
point in this file (2026-07-30 Craggy, 2026-10-22 distance-band max-merge,
the 2026-11-06 no-go fix above) — a pivot or floor change could silently
invalidate any of them, and the fix direction itself (move the pivot? walk
back specific floors? both?) is a real design choice, not a bug with one
obvious answer. Reported root cause and options to JW via Jarvis; waiting
on direction before touching `MERGES['outside-sensitive']` or any floor.
See `HISTORY.md`, 2026-11-07.

**Resolved, 2026-11-09, on JW's direct instruction: "forget our final-score
validations from the past. Create more of a normal distribution."** That's
explicit authorization to override the "waiting on direction" hold above —
previously-confirmed calibration points are no longer being treated as
untouchable. Dug past the pivot itself this time: branch-level history
(13,837 real snapshots, same corpus as above) showed `access` reading
exactly 4.000 on literally every non-closure night — `siteAccess` only
ever returns `{0, 2, 4}`, never a continuum, and a real closure already
forces the night to F via `detectNoGo`'s `accessInfo.noGo`, so its
weighted-blend contribution was pure redundant dead weight. `vantage` is a
static per-site constant that never varies night to night. With every
branch weighted equally, these two (plus `air`/`haze` commonly sitting
near their own ceiling too) diluted `clouds`/`horizon` — the branches that
actually carry the night's real signal — enough to produce a hard spike at
blend≈3.4 (16.4% of all historical snapshots, landing in B+ regardless of
pivot choice). Confirmed this was a real clump in the input, not a
transform artifact, by histogramming the raw pre-transform blend directly.

JW, on `access`: "access should be preventing values from being shown, not
actually affecting grades." On `vantage`: "it's relevant if you were
comparing two sites, but that's never really what's happening for me... I
know what they're like." Both zeroed to `weight: 0` in `METRIC_TREE` —
still computed and displayed (so a closure's reason still shows, and the
no-go gate is completely unaffected), just no longer part of the score.
`air`/`haze` stay in the blend (real, live weather reads, not static or
redundant) but weighted down (0.6/0.5) since they were still contributing
to the residual clump. `clouds`/`horizon`/`color` weighted up (1.5/1.3/1.0)
as the branches that actually determine whether the night is worth it.
`outsideSensitive`'s exponent moved from 0.42 to 0.6 (gentler stretch, now
that the inputs aren't artificially compressed). The stacked-excellence
bonus (the only path to A/A+ once real ceiling-pinned branches were
removed) was retuned too — JW caught that the first version of this fix
left A/A+ at ~0.3%/0.0%: "NO A or A+ values?" — trigger lowered from
blend≥3.7 to ≥3.2, reward raised from +0.1 to +0.2 per qualifying branch,
qualifying threshold loosened from ≥3.9 to ≥3.8, landing A/A+ combined
around 3%, matching his original expectation ("occasional A+").

Verified by replaying the real `MERGES['outside-sensitive']` code (not an
approximation) against all 13,837 historical branch-score rows: max single
grade bucket dropped from 39.6% (B+) to 18.4% (C+), with genuine spread —
F 0% / D 7.0% / D+ 6.1% / C- 7.0% / C 11.7% / C+ 18.4% / B- 14.8% / B 17.2%
/ B+ 7.8% / A- 6.7% / A 2.7% / A+ 0.5%. Confirmed live against the running
service: the same sunrise/sunset JW originally flagged as a flat B+ now
read B-.

**Two corrections to that first pass, both from JW catching real gaps
immediately.** First: "where are the Fs for 'socked in'?... I'm actually
expecting more like 20% per letter-group [F/D/C/B/A]... 20% +/- 10." The
0% F above was a real bug in how the fix was checked, not a property of
the new scoring — the simulation that produced it only replayed the new
blend math and never reapplied the real historical no-go overrides
(fog/socked-in/road-closure), so every no-go night in the sample silently
became a normal graded night instead of F. Second, while investigating
that: "road closure should remove a site, not actually affecting grades" —
followed by "I am expecting a disproportionate number of Fs" once he saw
that separating closures from weather dropped the F rate to 13%. Caught a
second, independent problem in the *old* no-go logic itself: a closed
Parkway section and a genuinely bad sky were both collapsed into the same
"F, in red" treatment, even though "you can't drive there" and "the sky
there is bad" are different claims. Fixed structurally, not just in the
distribution math: `detectNoGo` no longer folds `accessInfo.noGo` into its
weather reasons at all; `buildPayload` now drops a site from an event
entirely when the ONLY no-go reason is a closure (`return null`, filtered
out of `sitesOut`), while a real weather no-go (with or without a closure
also present) still grades F as before, with the closure appended as
context, not as what's gating it. Verified live: Green Knob's then-closed
section made it simply absent from the dashboard for that event, not a
red F entry.

Re-simulated against the same 13,837 real snapshots with this corrected
split (2,156 closure-only rows excluded from the denominator entirely,
1,531 genuine weather no-gos kept as F) and retuned `PIVOT` (3.0→2.9),
`outsideSensitive`'s exponent (0.6→0.4), and the stacked-excellence bonus
(trigger 3.2→2.8, qualifying threshold 3.8→3.6) together against that
corrected baseline — the three parameters aren't independent, so they were
fit as one search, not three sequential tweaks. Final letter-group split,
replayed with the real `MERGES`/`gradeOf` code rather than an
approximation: F 13.6% / D 13.1% / C 20.5% / B 25.2% / A 27.6% — every
group inside JW's 10-30% band. The fine-grained 12-grade breakdown still
has real lumps within each letter (B+ 21.2% vs B- 1.4%; A- 17.5% vs A+
4.0%), an artifact of the stacked-excellence bonus's step thresholds — not
investigated further, since JW's stated target was explicitly the
5-letter-group level ("not trying to be picky").

**A separate, much bigger-sample finding: Clouds structurally never scores
above a B+.** JW, 2026-10-22, via Jarvis: SkyMagic almost never reports good
clouds — confirmed across 169-595 snapshots/3 sites, zero A's ever, averages
sitting flat at C. Root cause #1 (fixed): the cirrus leaf's "no cirrus" floor
(1.8, tuned for a totally empty band) was applying at full, heaviest weight
even when the same band's low/mid cloud had real structure — loosened to 3 in
that case, all-empty calibration untouched. Root cause #2 (real, not acted
on): readings are fairly bimodal (near-0% or near-100% per band, rarely
between), so hitting every ideal range at once — the condition for an A — may
just be genuinely rare here, not a bug; the root's "outside-sensitive" stretch
that fixes exactly this kind of pivot-clustering isn't applied inside Clouds,
but Clouds' blend sits below the pivot, so applying it now would push the
middle toward F, not toward A, without a confirming photo to calibrate
against. See `HISTORY.md`, 2026-10-22. Jarvis is routing future good-sky
photos here with their scores so that anchor can be found.

**Then JW gave the actual fix, same day.** Don't average cirrus against
mid/low cloud within a distance band — take the best of the three (`max`,
not `weighted`). A thick low deck that really blocks the sun/horizon still
has to count through Horizon and the no-go logic (both already read raw
site cloud cover directly, untouched by this). Implementing it plainly broke
the one field-confirmed calibration point in the tree (2026-07-30 Craggy:
totally empty sky capped at C+) — `lowLeaf`'s flat 3.2-at-v<=5 was only ever
safe under dilution, and under `max` it would've made every clear sky a B-.
Recalibrated that one leaf (ramped 2.4→3.2 over 0-5%) so the empty case
still lands at exactly the old C+ ceiling — verified live, all four sites,
genuinely empty sky today. The morning's own cirrus-floor patch (above) is
reverted: `max` solves the same problem more directly and that patch
actively backfires under `max` (it could let a loosened "absent cirrus"
floor beat a low deck that's present but genuinely bad). Simulated the
distance-band effect against 1,785 real samples: average 2.22 → 2.89, A-rate
1/1785 → 350/1785. Large and intentional. Still waiting on a photo to
confirm the differentiation itself feels right against a real sky; the
empty-sky ceiling needed no such confirmation since it's just arithmetic
against an existing confirmed point.

**The same day, a 900 m coordinate error and 146 calibration photos.** JW
shared a Google Photos album and confirmed by satellite (within 1 m) that
`home`'s stored coordinate was ~900 m from his actual backyard. Fixed —
`CONFIG.sites.home` now points at `35.68826911411407, -82.52467580364578`,
elevation and horizon re-probed at the corrected point. Unlike Green Knob,
JW's own hedge ("probably close enough for previous calibrations... the sky
is probably the same") means the existing history rows under the old
coordinate were left in place rather than purged — his call, not assumed.
Pulling the album (Playwright, since the page is entirely client-rendered)
also surfaced two recurring spots not in `CONFIG.sites` at all: the Craggy
roadside pull-off JW described ("useful if I don't have time or it's too
windy/cold to hike up to craggy pinnacle"), now pinned to 17 m precision
across three separate years; and independent photo-GPS confirmation of the
already-documented ~475 m gap between the stored `craggy` coordinate and the
real summit. 22 recovered photo captions gave real near/mid/far/horizon
grading text, including one from 2023-04-29 that stated the texture-vs-
coverage idea ("the kind of cloud may determine optimal coverage level")
three years before it resurfaced on 2026-10-16 above. See `HISTORY.md` and
`../skymagic-calibration-photos/README.md` (parallel directory, not
committed here) for full detail; 10 of the captioned photos still need a
site identification from JW before they can anchor anything.

**A real outage, root-caused and fixed the same day it was reported
(2026-10-23).** `getRaw()` only served the in-memory cache immediately
while it was inside the 15-minute TTL; once the TTL passed, every request
— not just the one triggering the refresh — blocked on the full upstream
`fetchAll()`, including `getJSON`'s retry backoff (~10.5s across 3
attempts on any 429/5xx/non-JSON). Two ordinary Open-Meteo hiccups logged
2026-10-23 00:00 and 00:04 were enough to stall every request for that
span, which is what the health reporter caught as "SkyMagic unreachable:
timeout." Fixed with stale-while-revalidate: serve any cache under
`STALE_LIMIT_MS` (6h) immediately regardless of TTL, let the refresh
finish in the background, and only block when there's genuinely nothing
usable cached. Pre-existing code, not something changed this week — just
hadn't been hit hard enough to surface. See `HISTORY.md`.

**Still open.** The CAPE texture leaf is an unvalidated guess carrying
deliberately light weight. `vantage` is still one static number per site with no
direction in it, so the model cannot express that a spot works at sunrise and
not at sunset — which is most spots. A DEM terrain probe (`tools/horizon.js`)
now supplies that as advisory metadata, but it is **veto-only**: a BLOCKED
reading found real rock and is trustworthy, while "wide open" only means no
distant ridge and is blind to near hills, trees and buildings. It is not wired
into scoring and should not be without JW's say-so. Horizon still samples cloud
at fixed distances with no terrain model, so a late-forming distant cloud bank
(2026-10-07, Mitchell sunrise, A- -> B+ overnight) shows up as an unexplained
jump rather than a visible transition — the 2-hourly snapshot cadence added
2026-10-16 helps see it happening, but doesn't fix the leaf itself.

**Answered since.** The score history was finally read (2026-09-07): scores both
drift and bounce, but bounce dominates — the largest systematic bias is 0.28 of
one standard deviation, while one SD is about 1.9 letter grades. A confident
single letter three days out is not defensible and the dashboard should carry a
range. Note the anchor is the 3 h forecast, not the sky, so this measures
convergence rather than accuracy.

**Ground truth now lives in the project** (`ground-truth/observations.jsonl`,
2026-10-16): real outcomes logged against what SkyMagic said at the time,
verdict `confirmed-miss` / `confirmed-hit` / `pending`. JW's instruction was to
the app, not to any one agent's own notes, so this survives independently.

**A live-forecast gap, found and closed the same evening it was reported
(2026-10-16).** A hard no-go ("Socked in") was firing off the hour-ahead
forecast bucket rather than Open-Meteo's own live nowcast, minutes before an
event — the nowcast read a materially better sky. Not yet changed structurally
(see the work items); this was triage, not a fix.

**A real miss, fixed the same day it was fully diagnosed (2026-10-16).** Craggy
read C+ while JW stood in solid fog for two hours (2026-10-04). Two compounding
causes: `cloud_cover_low` at the site under-reported because the model filed the
overcast under a different band, and the existing fog checks live inside the
"volatile deck, might open a window" exception — right for a view-blocking deck,
wrong for being physically inside one. New no-go, "Possibly in cloud at the
summit," checks dew-point spread directly, sits outside that exception, and is
scoped to the two true summits via a new `site.elevM` field. Confirmed on one
instance (Craggy); corroborated independently the same night it shipped, when
live data put both summits at dew spread 0.0C / visibility 0 km during an
unrelated fog event at Home.

**Two separate pipelines now have independent survival.** The live dashboard's
stale-cache fallback (2026-09-07) and `history.js`'s cron snapshots are
different processes with different failure modes — a ~16h host DNS outage
(2026-10-06) left the dashboard serving a 22-hour-old cache (fine) while the
snapshot collector produced nothing for 16 hours (a real gap, not caught until
JW asked why a score moved). `getJSON`'s retry now covers thrown network errors,
not just bad HTTP responses, and `script/report-health-to-status-board` reports
snapshot staleness to JW's status board daily (or immediately if it gets worse)
specifically so a repeat doesn't go unnoticed for three weeks again.

**Waiting on JW** (see the work items): facing directions for the 57 screened
candidate sites in `tools/candidate-screen.md`; the Craggy roadside pull-off,
which is not on any map; the geocoding/routing provider, without which departure
and alarm times are wrong for every visitor because `travelMin` is measured from
JW's driveway; and whether the dashboard shows a range before launch.

The Home outcome question above is answered: the clouds rolled in, the F was
right, and the nowcast (not the hour-ahead forecast) was the misleading signal
that evening — see the 2026-10-16 entries above. No structural fix was
warranted; this was triage catching a real but one-off case of trusting the
wrong bucket, not a pattern.

**A hard-won habit.** Verify a coordinate before trusting anything computed from
it. `greenknob` sat 4 km from Green Knob Overlook for the life of the project —
caught by comparing the DEM elevation at the coordinate against the published
NPS figure, and confirmed by milepost spacing. Every Green Knob grade until
2026-09-07 was computed in the wrong HRRR cell, at JW's best sunrise location.
OpenStreetMap via Overpass has the overlooks properly mapped with mileposts;
Nominatim free-text search does not and failed on 13 of 18.

**The free tier is shared.** Open-Meteo's hourly quota serves both the live
dashboard and every offline tool here. A bulk terrain sweep exhausted it on
2026-09-07 and took the site down for an hour. Any bulk job needs its own disk
cache and its own pacing, or it competes with what users are looking at.

**Real historical photo scoring, 2026-11-09 — JW: "I wanted to see what the
pictures I gave would actually score."** Not his caption, not an estimate:
`tools/score-historical-photos.js` pulls real historical weather (Open-Meteo's
archive API) for each calibration photo's exact timestamp and location and runs
it through the live `METRIC_TREE` via `evalMetric` (exported from server.js for
this purpose). Of 146 photos, 119 have usable GPS + timestamp and were scored;
27 (mostly Canon 5D shots) have no GPS EXIF at all and can't be geolocated.
Known fidelity gaps: the historical archive has no CAPE or visibility data
(both silently drop, same as a missing live source today), and there's no
historical equivalent of cross-model consensus or PM2.5. Results: full page at
the artifact linked in chat; `tools/historical-photo-scores.json` has the raw
per-photo leaf breakdown.

**A real find from that exercise: Clouds' `min` merge could let one mediocre
reading veto two good ones.** 2024-05-07 sunset (Home) — a textured, glowing
high deck, genuinely striking in the actual photo — computed D+ (1.64). The
near/mid/far band composite read a clean 4.0 (A), but `site-view` (a single-
cell check for "is the site's own sky blocked") read only 2.5, and `clouds`
took `min(bands, site-view)` = 2.5, discarding the band-level nuance entirely.
JW: "clouds in two zones being good and a third zone being mediocre shouldn't
fall to the lowest level." Root cause: site-view is a cruder instrument than
it was being trusted as — it only reads raw site cloud_cover/cloud_cover_low
with no veil-vs-opaque distinction, while the band leaves already detect a
thin veil passing direct light vs. a solid deck. And the case site-view exists
to catch — genuinely socked in, can't see anything — is already a hard no-go
via `detectNoGo` (total>=95 AND low>=80), independent of this branch; in the
2024-05-07 photo low cloud was only 3%, so no-go correctly didn't fire, and
site-view's own moderate-penalty branch (t>=95, any low%) was re-flagging
something the no-go gate had already judged not severe. Fixed: `clouds`'s
merge changed from `min` to `weighted`, with `site-view` at weight 0.5 (a
real input, not an absolute veto). Re-scored: 2024-05-07 sunset now reads C+
(2.51), clouds alone moved from 2.5 (C+) to 3.5 (B+). Deployed live.

**Open question, not resolved: is Haze systematically miscalibrated for this
region's actual summer baseline?** Checking all 58 May–August photos in the
calibration set (same real-weather pipeline) found Haze reading low (mostly
0.4–2.0) across essentially the entire window, not just the 2024-05-07 photo
— a real, persistent regional pattern (Appalachian summer haze), not a fluke.
Same question applies to Color's saturation/purity components, which share
the AOD input. Two explanations fit equally well without more input: either
this is correct (real summer haze does reduce clarity most of the time) or
the AOD curve's "ideal" ceiling (0.22) is calibrated too strict for a region
where even a good day runs 0.3–0.4. Flagged to JW directly in the photo audit
page (each card shows its own Haze score) rather than guessed at — needs his
eye on whether the low-haze-but-high-grade-anyway photos from that season
actually looked hazy/washed-out to him or not. Not changed pending that read.

**A second, narrower Clouds fix the same week, 2026-11-09 — JW spotted it by
eye again.** Two 2026-09-27 photos (Home sunset) showed a plainly empty sky —
near and mid confirmed 0% cloud at every altitude in the real archive data,
far only 0-2% — yet scored A- (3.88) instead of the C+ the project already
calibrated empty skies to on 2026-07-30. Root cause: `site-view`'s "no
blockage detected" case returned a flat 4.0, which was harmless under the old
`min` merge (it could only ever be outvoted downward) but started adding real
positive credit once clouds moved to `weighted` earlier this week — an empty
sky has nothing to block, so site-view scored it a clean A and pulled the
blend above the band leaves' own C+ ceiling. Fixed by having that case return
`null` instead of 4.0, so it drops out of the blend entirely (same handling
as any other missing leaf) rather than contributing a positive score — site-
view is back to being a pure penalty signal, which matches its own header
comment ("a solid deck... hides the framed sky") and was its actual role
under `min` all along. Verified: the two 2026-09-27 photos now land clouds
2.56 (C+, matching the calibrated ceiling) and overall B+ (3.68, down from
A-, with air/haze still legitimately good that evening). Re-checked both
photos the 2024-05-07 fix and a genuinely-textured 2026-09-16 photo weren't
disturbed — 2024-05-07 unaffected (site-view was in its moderate-penalty
branch, not the changed one, overall unchanged at C+/2.51) and 2026-09-16
unaffected (A+/4.3, real texture present, band leaves alone already carried
it there).
