# ESPN Per-Day Fetch — Design Spec

**Date:** 2026-09-24
**Status:** Designed, not yet built.
**Scope:** A fix to the ESPN adapter's request layer. Both the odds sync and the results sync.
**Amends:** [ESPN adapter spec](2026-08-22-espn-adapter-design.md) — its finding that
`?dates=YYYYMMDD-YYYYMMDD` covers a multi-week window in one request no longer holds.
**Decision:** [D80](../decisions.md#d80--the-espn-adapter-fetches-one-day-per-request-because-date-ranges-stopped-working)

## Purpose

ESPN's scoreboard endpoint now answers every date-range request with `400 Bad Request`. Both
`syncOdds` and `syncResults` go through `fetchScoreboard`, which builds exactly that kind of
request, so every `sync-odds` run fails before writing anything:

- **Odds:** no new games or lines arrive, so the board goes empty as soon as the last synced
  game kicks off.
- **Results:** no game is ever marked final, so no bet settles.

The fix keeps the two-week odds window (`DEFAULT_WITHIN_DAYS = 14`) and the results window
(3 days back, 1 day forward) exactly as they are. Only the way those windows are requested
changes.

## What ESPN accepts now

Checked by hand against `site.api.espn.com/apis/site/v2/sports/football/{nfl,college-football}/scoreboard`
on 2026-09-24:

| Query                                     | Result                         |
| ----------------------------------------- | ------------------------------ |
| `?dates=20260924-20260925` (2-day range)  | 400                            |
| `?dates=20260924-20261008` (2-week range) | 400                            |
| `?dates=20260927` (single day)            | 200, 14 NFL events             |
| `?dates=20260926&groups=80&limit=200`     | 200, 65 CFB events             |
| `?dates=202609` (month)                   | 200, 48 NFL events             |
| `?week=4&seasontype=2`                    | 200, 16 NFL events             |
| no query                                  | 200, the current default slate |

Ranges of any length are rejected. A single day is the narrowest form that still works.

## Approach: one request per day

`fetchScoreboard` keeps its signature and return shape. Internally it requests each day in
the window separately and merges the results. None of its callers change.

_Rejected:_ one request per month (`?dates=YYYYMM`), trimmed to the window in code. It loads a
whole month to use two weeks of it. Worse, a busy CFB month is well over the `limit=200` cap,
so games would be dropped without any error.

_Rejected:_ one request per ESPN week (`?week=N&seasontype=N`). The adapter would first have to
work out the current week and season type from ESPN's calendar. That is fragile around
preseason, bowls, the playoffs, and the offseason, and it leans harder on an undocumented API
that has just changed shape once already.

## Design

### 1. Fetching — `fetch-scoreboard.ts`

- `buildUrl(sport, day)` builds a single-day URL: `?dates=YYYYMMDD`, plus
  `groups=80&limit=200` for `NCAAF` only, as today.
- `fetchScoreboard(sport, { daysBack, daysForward })` lists every UTC calendar day from
  `today − daysBack` to `today + daysForward`, both ends included. That is
  `daysBack + daysForward + 1` days. UTC days match how the range was computed before.
- Days are fetched with at most **4 requests in flight** at once, through a small local helper.
  No new dependency.
- Results are merged in day order. A game that shows up on more than one day is kept once,
  matched by `game.externalId`, and the first occurrence wins.
- `skippedGames` and `skippedMarkets` are summed across days.
- A single day's parsing is unchanged: a malformed event or market is still skipped and
  counted, never thrown.

### 2. Fetching once per run — `provider.ts`

- `EspnOddsProvider` keeps each sport's `fetchScoreboard` result from `getUpcomingGames`, keyed
  by sport. `getMarkets` reads that result instead of fetching the same window again. If a
  sport has no stored result, `getMarkets` fetches it as a fallback.
- The `sync-odds` route builds a new provider on every run, so the stored results last for one
  run and can never go stale.
- Skipped counts keep their current rule. `getUpcomingGames` adds `skippedGames` and
  `getMarkets` adds `skippedMarkets`, so the same malformed event is never counted twice.
- `EspnScoreProvider` does not change. It picks up per-day fetching through `fetchScoreboard`.

Requests per `sync-odds` run:

| Pass      | Before                                    | After                           |
| --------- | ----------------------------------------- | ------------------------------- |
| Odds      | 2 sports × 2 range requests = 4 (now 400) | 2 sports × 15 days = 30         |
| Results   | 2 sports × 1 range request = 2 (now 400)  | 2 sports × 5 days = 10          |
| **Total** | 6                                         | 40, most of them small or empty |

### 3. Errors

- **No partial success.** If any day's request fails, whether a network error or a non-200,
  `fetchScoreboard` rejects. The error message names the sport, the day, and the HTTP status.
- The run then fails the same way it does today. `runJob` records it in `job_runs`, alerting
  fires, and the next scheduled run retries.
- `suspendStaleMarkets` still closes any market whose data has gone stale, so a feed that
  keeps failing degrades into "no betting" rather than "betting on old lines".

### 4. Testing

Unit tests, with `fetch` stubbed and the clock pinned:

- **Request per day:** `fetchScoreboard` makes `daysBack + daysForward + 1` requests. Each has
  a single `dates=YYYYMMDD` and none has a range. The first and last dates match the pinned
  clock.
- **CFB parameters:** `groups=80&limit=200` is on every `NCAAF` request and on no `NFL` request.
- **Duplicates:** a game returned on several days comes back once.
- **Skipped counts:** they are summed across days.
- **Failure:** one failing day makes the whole call reject, and the message names the day.
- **Concurrency:** no more than 4 requests are ever in flight at once.
- **Provider:** after `getUpcomingGames` has run for both sports, `getMarkets` makes no further
  requests. If it is called without a prior `getUpcomingGames`, it still fetches.
- **Results window:** the results provider's first requested day is before today, and its last
  is after today.

Live check, against a local dev server with `ODDS_PROVIDER=espn`:

1. Call `/api/cron/sync-odds` with the cron secret. It returns 200.
2. The newest `SYNC_ODDS` row in `job_runs` has `ok = true`.
3. `games` has `SCHEDULED` rows that start after now, and `/games` lists them.

### 5. Docs

- **D80** in `docs/decisions.md` records that ESPN dropped date ranges and that the adapter now
  fetches one day per request.
- The [ESPN adapter spec](2026-08-22-espn-adapter-design.md)'s range finding gets a dated
  note pointing here.
- `docs/README.md` lists this spec and its plan.

## Out of scope

- Changing either window's length.
- Retrying a failed day within the same run. The next scheduled run is the retry.
- Adding `sync-odds` to `vercel.json`. It runs from `.github/workflows/cron.yml`, because
  Vercel Hobby only allows daily crons.
