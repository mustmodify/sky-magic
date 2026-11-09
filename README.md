Goal: Based on a list of photography spots I often visit, predict which ones will have good-looking sunrises and sunsets over the short term (the next 24 to 72 hours.)

Public name: **SkyMagic** (skymagic.app). The systemd unit, the worktree, the
MCP server id and `TRON_AGENT_NAME` all stay `focus-forecast` — those are Grid
registration, and `grid-diag` checks the worktree id matches the id the Grid
addresses it by, so renaming them would deregister the agent.

## Upstream resilience

`getJSON` retries 429, 5xx, and — since 2026-09-10 — a 200 carrying a body that
will not parse, which is how Open-Meteo reports its own streaming errors. If a
refresh still fails and the cache is under six hours old, the cached forecast is
served and the payload carries a `stale` block that the header renders. The last
good payload is persisted to `data/last-good.json` and reloaded at startup, so a
restart during an upstream outage does not produce an error page. All three have
fired in production and are in `HISTORY.md`.

Open-Meteo's hourly quota is shared between this service and every tool in
`tools/`. A bulk sweep took the dashboard down on 2026-09-07; `tools/horizon.js`
now caches elevations to `tools/elevation-cache.json` and paces its requests.

## Parkway entrance

`siteAccess()` counts only the NPS closures lying **between the entrance and the
site**, so the entrance decides the verdict rather than decorating it. Pass
`?entry=<id>` (ids in `CONFIG.accessPoints`: `oxcreek`, `us70`, `brpvc`,
`us74a`, `us25`, `nc191`) to the dashboard or either API endpoint. The UI asks
and remembers the choice in `localStorage` under `skymagic.entry` — the gate id
only, never a location, and no login.

An unrecognised or absent `entry` falls back to `us70` and the payload reports
`entry.chosen: false`, which the header renders as "assuming US 70 — closures
are judged from there". Guessing silently is how a reachable site gets a
confident F, or a closed one gets a green light.

Note that every Asheville entrance is *south* of the Helene closure at MP
344.2–355.3, so none of them currently rescues Green Knob (MP 350.4). The
boundary case that does matter is Mount Mitchell at exactly MP 355.3, where the
closure ends: it reads open from the south and closed from the north.

## Private mode (`FF_LOCAL`)

The Home site is JW's back yard. It carries his coordinates, it is a
calibration proxy rather than a place anyone can drive to, and its street
address used to be printed in the dashboard header. Public builds must not see
any of it.

`FF_LOCAL=1` (env var or `.env`) turns private mode on; it defaults to **off**,
so a deployment leaks nothing by forgetting a flag. With it off, the
calibration site is removed from `CONFIG.sites` at startup rather than filtered
in the view — a public build never fetches weather for the house, never scores
it, and cannot leak it through the dashboard, the JSON:API or the MCP server,
because it does not exist in any of them. `home` in the payload is `null` and
the header drops the "from ..." clause.

`FF_PORT` overrides the listen port (default 5813), which is what makes it
possible to boot a second copy to test the two modes side by side.

## Run

    node server.js    # → http://localhost:5813

For always-on use, it runs as a user systemd service (`~/.config/systemd/user/focus-forecast.service`, `Restart=on-failure`) — survives reboots and power loss, same pattern as this box's other daemons (`ducks`, `grid`). On the LAN it also answers at `http://lense.local` (mDNS alias + nginx reverse proxy on port 80, mirroring `ducks.local`/`grid.local`).

    systemctl --user status focus-forecast.service
    systemctl --user restart focus-forecast.service

No dependencies (Node 18+). Data: Open-Meteo forecast + air-quality APIs (ECMWF/GFS/HRRR/NBM cloud models, AOD) and the NPS Blue Ridge Parkway road-closures page, cached 15 minutes. Optional: put an OpenWeather API key in `.env` as `OPEN_WEATHER_KEY=...` (or the `OPENWEATHER_API_KEY` env var, or a bare `.openweather-key` file) to blend forecasted surface PM2.5 into the haze metric — re-read on every cache refresh, no restart needed.

Scoring is a metric tree (`METRIC_TREE` in `server.js`): every node is a leaf that computes a 0–4 score from data, or a parent with child metrics and a merge pattern (`mean`, `weighted`, `min`, `max`, `outside-sensitive` — a weighted mean stretched away from the pivot of 3 so blends read decisively good or bad). Null-scored children drop out and weights renormalize. The overall grade is just the root node; a no-go condition (fog, socked-in, heavy rain, closed road) overrides it to 0/F.

## API (JSON:API)

For checking conditions from a phone. Resource ids are `YYYY-MM-DD-<kind>`, so the URLs are typeable from memory:

    /api/opportunities.json                    every event in the 72h horizon: best/worst score per event
    /api/opportunities/next.json               the next event, with every site
    /api/opportunities/2026-07-29-sunset.json  one event, with every site
    /api/opportunities/2026-07-29.json         that day's sunrise and sunset
    …?depth=3                                  expand the subscore tree

The collection stays light — one row per event with `best_score`/`worst_score` (+ grades and site names) and a `go` block naming the best site with its photo, departure, and alarm times. Fetching a single event adds an `included` array of per-site resources: score, grade, color, no-go reasons, subscores, and the whole departure chain. Every time appears twice — `local` (human, in the site's timezone) and `at` (UTC ISO, for math). Ranking excludes Home, which scores the same sky but isn't a place you can drive to; it's still listed, flagged `calibration_only`.

## MCP server

    node mcp-server.js        # speaks MCP over stdio; not run by hand

Exposes the same upcoming projections to an agent as tools, registered for this
worktree in `.mcp.json` (server name `focus-forecast`). It reads the JSON:API
above and `data/history.db` — it computes no scores of its own, so if a grade it
reports ever disagrees with the web UI, the MCP server is the thing that's wrong.

| Tool | Answers |
|---|---|
| `next_opportunity` | Should I shoot tonight? Next event, every site ranked best-first, Home excluded from the ranking but still listed. |
| `list_opportunities` | What's worth a look in the next 72h? One row per event; filter by `kind` or `min_score`. |
| `get_opportunity` | One event in full — per-site scores, no-go reasons, subscores, departure chain. Omit `kind` for both events that day. |
| `get_site_scores` | Why did this site score that? The subscore tree for one site, defaulting to the next event. |
| `score_history` | Is this score drifting or bouncing? Per-event trajectory by lead time, with net change and churn. |

`depth` (1–4) expands the subscore tree the same way `?depth=` does on the API.
No dependencies — MCP over stdio is newline-delimited JSON-RPC, so it's spoken
directly rather than pulling in `@modelcontextprotocol/sdk` and this repo's first
`node_modules`. `FOCUS_FORECAST_URL` and `FOCUS_FORECAST_DB` override the API
base and the history file.

The server must be up for the four live tools; when it isn't, they return the
`systemctl --user status focus-forecast.service` line rather than a stack trace.
`score_history` reads the SQLite file directly and works regardless.

## Score history

    node history.js record                      # one snapshot → data/history.db (cron: every 4 hours)
    node history.js report                      # per-event trajectories + drift by lead time
    node history.js report --metric=clouds --site=craggy --days=14
    node history.js prune --days=365

Every 4 hours a cron job writes every event × site × metric (the whole tree, ~1000 rows) into a SQLite file at `data/history.db`, keyed by event time — so the same event can be compared against itself as it approaches. The question it answers: do scores walk steadily in one direction as an event nears (a bias worth correcting), or bounce (real uncertainty worth showing as a range)? `report` prints a sparkline trajectory per event, net change, churn per step, and a drift-by-lead-time table. The DB has no schema surprises — `node history.js schema`, then query it with `sqlite3` directly.

Grades use plus/minus bands over the 0–4 scale (Ruby-style `x...y`, each letter starting its band): F <0.7, D 0.7, D+ 1.3, C- 1.7, C 2.0, C+ 2.3, B- 2.7, B 3.0, B+ 3.3, A- 3.7, A 4.0, A+ ≥4.3. Saying "a C" means 2.0 exactly. Leaves top out at 4.0; blends can exceed it only via the stacked-excellence bonus in the `outside-sensitive` merge (+0.1 per near-perfect child once the blend is already A- territory), so A+ is nearly mythical by design. Sites, drive/hike/prep times, and scoring knobs live in `CONFIG` at the top of `server.js` — departure and alarm times recalculate from those values.


