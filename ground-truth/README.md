# Ground truth

Observed reality, logged against what SkyMagic predicted at the time, kept
permanently for calibration. JW, 2026-10-04 (via Jarvis): "Tell the weather app
to make sure that it retains that piece of data for present and future
calibration." This directory is that retention — not gitignored, part of the
project's record the way `HISTORY.md` is.

This is a *different* store from Jarvis's
`/home/jw/projects/home/jarvis/data/skymagic-ground-truth.jsonl`, which is
Jarvis's own notification log and not SkyMagic's to depend on. Entries land
here with Jarvis's wording credited, so the record survives independently of
whatever Jarvis keeps.

## Format

`observations.jsonl`, one JSON object per line:

- `site`, `event` — matches SkyMagic's own ids (`2026-10-04-sunset` etc).
- `observed` — what actually happened, in the observer's words.
- `source` — who reported it and when.
- `forecast_at` — SkyMagic's own output at the time of observation (grade,
  score, the subscores that drove it) — not re-derived later.
- `verdict` — `confirmed-miss`, `confirmed-hit`, or `pending` while waiting on
  an outcome report.
- `note` — optional, why it matters.

A `pending` entry is not yet calibration evidence — see CLAUDE.md on small
samples. It becomes usable once `verdict` is filled in.
