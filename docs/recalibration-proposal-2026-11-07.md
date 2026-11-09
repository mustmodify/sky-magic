# Overall-score recalibration — proposal for review (2026-11-07)

Not deployed. This is the before/after JW asked for before anything goes
live. Nothing in `server.js` has changed yet.

## What's wrong, in one line

The root merge's "outside-sensitive" stretch is pivoted at exactly 3.0,
and the real blended average across the whole corpus also sits at ~3.0 —
so almost every night gets stretched hard toward B/B+, and reaching A
needs nearly every branch near-max at once. Full detail in CLAUDE.md /
HISTORY.md, 2026-11-07 entries above this one.

## What's proposed

Two structural changes, both to the root merge only — no leaf (`clouds`,
`horizon`, `haze`, `color`, `air`) is touched:

1. **`access` and `vantage` move out of the weighted blend into a cap.**
   Across the full corpus, `access` has exactly 2 distinct values ever
   recorded (effectively always 4.0, except when the road's closed — which
   already fires a hard no-go independently) and `vantage` has 3 (it's a
   static per-site number, never changes night to night). Both were
   inflating every single night's average by about the same fixed amount
   regardless of the actual sky. Now: `overall = min(sky, access, vantage)`
   — a genuinely poor vantage or a real access problem still caps the
   score down, but a routine "road's open, vantage is what it always is"
   night no longer pushes the average up.

2. **The stretch is replaced with a plain recentered-and-rescaled linear
   map**, fit to where the remaining 5-branch blend (`clouds`, `horizon`,
   `air`, `haze`, `color`, equal weight) actually sits across the full
   13,645-row corpus:

   ```js
   // M = real median of the 5-branch blend, P = target output at that
   // median, scaleLow/scaleHigh = how fast score moves away from P as the
   // blend moves away from M (asymmetric: the data is not symmetric
   // around its own median, see percentiles below).
   const M = 3.046, P = 2.5, scaleLow = 1.442, scaleHigh = 3.352;
   const recenter = x => x >= M ? P + (x - M) * scaleHigh : P - (M - x) * scaleLow;
   ```

   Linear, not a power curve — the old curve's steepness right at its
   pivot is exactly what manufactured the spike. A straight line can't
   manufacture one: the shape of the output histogram just mirrors the
   shape of the real input distribution, rescaled.

   `M`/`scaleLow`/`scaleHigh` came from the actual 5-branch blend's
   percentiles (p10 2.21, p50 3.05, p90 3.40 — the real spread is
   fairly narrow even before any stretch, which is itself part of why the
   old pivot-at-3.0 power curve had so little real signal to work with).
   `P = 2.5` targets the middle of C+, per JW's stated range (B- or C+
   median, B at most).

   The old per-child "stacked excellence" bonus (+0.1 per branch ≥3.9)
   is dropped — it was there to make A+ reachable under a curve that
   otherwise made it nearly impossible. The new curve reaches A+ on its
   own for a genuinely exceptional night (every branch near 4.0 clamps to
   4.3); none of the last 3.3 months did, which is believable rarity, not
   a hole in the math.

## Before / after — full corpus, 13,645 `overall` rows, 740 snapshots

No-go F's (3,693 rows, ~27%) are identical in both — unaffected by this
change, exactly as JW said ("socked-in nights are assumed F even without
photos").

| Grade | Old (current) | New (proposed) |
|---|---|---|
| A+ | 31   | 0 (reachable, none hit it this window) |
| A  | 153  | 603 |
| A- | 1850 | 463 |
| B+ | 5200 | 856 |
| B  | 532  | 1780 |
| B- | 100  | 1113 |
| C+ | 535  | 1643 |
| C  | 631  | 1525 |
| C- | 504  | 929 |
| D+ | 390  | 640 |
| D  | 26   | 364 |
| F  | 3693 | 3693 |

Old: B+ alone is 51% of every non-no-go night, and the peak bar (B+,
5200) is **9.8×** its immediate neighbor (B, 532) — almost exactly the
"median bar ~10x its neighbors" complaint, measured.

New: the peak bar is B (1780), and it's 2.1× its B+ neighbor and 1.6× its
B- neighbor. Median grade (non-no-go) is now B-/C+ territory as a whole
— most mass sits in the C-/C/C+/B-/B band — and the biggest-to-smallest
spread across all 10 real grades (excluding F and the unreached A+) is
under 5×.

## Anchor checks

**2026-07-30 Craggy sunrise — the one night JW confirmed correct in real
time (old: B+, 3.36–3.50).** New: **C / C+** (2.00–2.36 across that
evening's snapshots). This is a real, acknowledged change, not a bug —
JW said past scores are allowed to move under a full recalibration. Why
it lands here: that morning's `clouds` was already a deliberately low
1.81 (a near-empty-sky floor, itself a confirmed calibration point — see
HISTORY.md 2026-07-30), and nothing else that night was exceptional
enough to pull the average into B+ under the stricter scale. Worth a
second look from JW: does *C/C+* feel right for that morning in
hindsight, or does it suggest the target median should sit closer to B-
than C+? The 4 constants above are the only knobs — easy to retune either
way.

**2026-11-05 Home sunset — JW called the actual sky "an A."** New: still
only **C** (~2.14, using the already-fixed no-go so this isn't scored F
any more, but the continuous blend). This is NOT fixable by any global
recalibration of the final number — the leaf inputs for that specific
forecast (`air` 2.29, `color` 2.62) simply don't reflect how the sky
actually looked; that's a forecast-data-fidelity gap already flagged
separately (the far-band/texture mismatch), not something this proposal
should be bent to force-fit. Flagging so it's not mistaken for the
recalibration failing — it's a different, already-known problem.

## What I didn't use, and why

JW suggested ranking 10-15 calibration photos best-to-worst as the basis.
I pulled the available set (10 captioned photos from the 2022-2023
archive pull, plus the confirmed 2026 nights above) and they do span the
full range his own words imply — C- ("Overall like a C-"), B-/B ("not
enough coverage but beautiful"), up to A/A+ ("near clouds A+, mid B+,
horizon A") — which supports the *shape* this proposal targets (real
spread across the whole scale, not two piles). But none of those archive
photos have matching recorded weather data (they predate this project's
history.db, which starts 2026-07-28), so there's no raw blend to fit a
curve against — only the 3 anchors above have real numbers behind them.
Used the photos to confirm the target shape is right, not as regression
inputs.

## Still open / needs JW's call

- Is `P = 2.5` (mid-C+) the right target, or should it sit closer to
  B- given the Craggy anchor now reading C/C+?
- This only touches the root merge. The individual branches (`haze`
  avg 3.48, `air` avg 3.07) still run hotter than `clouds` (2.37) on
  their own — if the new median still feels too generous once this is
  live, that's the next place to look, not another root-level tweak.
- Not deployed. Waiting for a go/no-go, or a steer on `P`/the scale
  constants, before touching `server.js`.
