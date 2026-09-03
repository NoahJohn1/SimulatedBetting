# ESPN Adapter — Design Spec

**Date:** 2026-08-22
**Status:** Draft
**Scope:** Phase 5 of the production-readiness roadmap (tasks 2, 3, 5, 6) — see
[../roadmap.md](../roadmap.md#5--real-data-the-espn-adapter)
**Depends on:** Subsystem 1 — core betting engine, built
([spec](2026-08-14-core-betting-engine-design.md))
**Supersedes:** that spec's [Provider interfaces](2026-08-14-core-betting-engine-design.md#provider-interfaces)
note naming The Odds API as the first real implementation — [D49](../decisions.md#d49--espns-public-json-is-the-odds-and-score-source-superseding-d2)
already made that call; this spec is the implementation design for it.

## Purpose

Replace `FixtureOddsProvider`/`FixtureScoreProvider` with `EspnOddsProvider`/`EspnScoreProvider`
— real NFL and CFB slates, lines, and final scores, behind the same `OddsProvider`/
`ScoreProvider` interfaces the fixtures already satisfy
([types.ts](../../src/server/odds/types.ts)). Nothing downstream of `syncOdds`/`syncResults`
changes.

This spec closes the roadmap's task 1 (payload spike) with a live check of ESPN's actual
response shape, rather than the community documentation the roadmap flagged as unverified.
Findings below come from real requests made against
`site.api.espn.com/apis/site/v2/sports/football/{nfl,college-football}/scoreboard` on
2026-08-22.

**What the spike found that changes the roadmap's plan:**

- The scoreboard endpoint returns games, scores, _and_ odds in one payload
  (`competition.odds[]`). The separate per-book `sports.core.api.espn.com/.../odds/{providerId}`
  endpoint the roadmap named is unnecessary — it was checked directly and just wraps the same
  single inline book (DraftKings, provider id 100) behind extra `$ref` fetches.
- Only one book is ever populated inline, so there is nothing to choose between — `sourceBook`
  is read straight off `odds[0].provider.displayName`.
- CFB's default scoreboard call is scoped to a top-25-ish subset (25 events) rather than the
  full FBS slate; `?groups=80&limit=200` returns the whole thing (99 games confirmed this
  week, well under the cap). This replaces the roadmap's assumption of true pagination — it's
  one request with the right query params, not a loop.
- `?dates=YYYYMMDD-YYYYMMDD` spans multiple weeks in a single call (confirmed: a 2-week range
  returned weeks 3 and 4 together), so `getUpcomingGames(sport, withinDays)` is one request per
  sport, not a per-week loop.
- Not every scheduled game has odds yet (11/16 NFL games did in the spike) — a game with no
  `odds` array is normal, not an error.

## Success criteria

1. `EspnOddsProvider` and `EspnScoreProvider` implement `OddsProvider`/`ScoreProvider` and pass
   the same shape of test coverage `sync.ts` already has against the fixtures, but against
   recorded real ESPN payloads instead.
2. Setting `ODDS_PROVIDER=espn` and running the cron pulls a genuine NFL and CFB slate into
   `games`/`markets`/`selections` with correct team, price, and status data — verified with an
   admin-run backfill against a real season.
3. A single malformed game or market (missing field, reshaped odds block) is skipped and
   counted, not thrown — the cron never dies because one of ~100 games parsed oddly.
4. `ODDS_PROVIDER` unset or set to anything other than `espn` behaves exactly as today
   (fixtures), so this ships with zero behavior change until deliberately flipped.
5. `npm run verify` passes, and no existing test's behavior changes.

## Non-goals

Line shopping across books (moot — ESPN only ever exposes one inline book, and
[D9](../decisions.md#d9--lines-one-house-line-per-market) already picked one-book-per-market
regardless) · player props or live in-game odds
([D6](../decisions.md#d6--bet-types-singles-and-parlays)) · retrying a failed ESPN request
within the same cron tick (the next `*/15` run retries naturally — see Failure handling) ·
alerting on skip counts (phase 6) · restricting to regular season only (explicitly chosen
against — this adapter takes ESPN's live window as-is, preseason and postseason included) ·
paging beyond one request per sport per sync (`limit=200` comfortably covers FBS's ~130 teams
now and for the foreseeable future).

## Architecture

```
src/server/odds/espn/
  fetch-scoreboard.ts   # shared fetcher + per-item defensive parsing
  provider.ts           # EspnOddsProvider, EspnScoreProvider
  mappers.ts            # ESPN JSON -> ProviderGame / ProviderMarket / ProviderResult
  __tests__/
    fixtures/           # recorded real ESPN payloads (see Testing)
    mappers.test.ts
```

`fetch-scoreboard.ts` exports `fetchScoreboard(sport: Sport, opts: { withinDays: number }):
Promise<{ games: ParsedGame[]; skipped: number }>`. It builds the request URL per sport —
`dates=` computed from `withinDays`, plus `groups=80&limit=200` appended only for `NCAAF` —
fetches once, and maps each `event` through `mappers.ts` inside a per-item `try/catch`. A
`ParsedGame` carries the game/team/status fields _and_ the raw `odds[]` block, since both
provider classes need the same payload.

`EspnOddsProvider.getUpcomingGames` and `.getMarkets`, and `EspnScoreProvider.getResults`, each
call `fetchScoreboard` independently — no shared cache or instance across the two classes, same
shape as `FixtureOddsProvider`/`FixtureScoreProvider` today. A normal sync cycle now issues 4
ESPN requests (NFL + NCAAF, × odds-role + results-role) instead of 2; accepted as a fair
tradeoff for keeping the classes decoupled and matching the existing pattern, rather than
introducing a shared-instance lifecycle the fixture version never needed.

**Kill switch.** One env var, `ODDS_PROVIDER` (`espn` | `fixture`, default `fixture`), read
once in `sync-odds/route.ts`:

```ts
const provider =
  process.env.ODDS_PROVIDER === 'espn'
    ? { odds: new EspnOddsProvider(), scores: new EspnScoreProvider() }
    : { odds: new FixtureOddsProvider(), scores: new FixtureScoreProvider() };

const odds = await syncOdds({ provider: provider.odds });
const results = await syncResults({ provider: provider.scores });
```

Defaulting to `fixture` means this ships inert — nothing in any existing environment changes
behavior until `ODDS_PROVIDER=espn` is set deliberately. A bad ESPN deploy is one env var flip
back, not a rollback.

## Field mapping

**Games/teams** (`ProviderGame`/`ProviderTeam`), from `competition`:

| Ours          | ESPN                                                                         |
| ------------- | ---------------------------------------------------------------------------- |
| `externalId`  | `competition.id`                                                             |
| `home`/`away` | `competitors[].team.{id,abbreviation,displayName,logo}`, split by `homeAway` |
| `startsAt`    | `date`                                                                       |
| `seasonYear`  | `season.year`                                                                |
| `week`        | `week.number`, or `null` if absent                                           |

**Status** (`GameStatus`), bucketed off `status.type.state` (`pre`/`in`/`post`) rather than
ESPN's ~10 detailed `name` values, since our enum only has 5:

| ESPN                                                                                   | Ours                                                                                                              |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `state: 'pre'`                                                                         | `SCHEDULED`                                                                                                       |
| `state: 'in'`                                                                          | `IN_PROGRESS`                                                                                                     |
| `state: 'post'`, `completed: true`                                                     | `FINAL`                                                                                                           |
| `state: 'post'`, `completed: false`, `name` is `STATUS_POSTPONED` or `STATUS_CANCELED` | `POSTPONED` / `CANCELED` directly                                                                                 |
| `state: 'post'`, `completed: false`, anything else                                     | `IN_PROGRESS` (never a silent `FINAL` on a status we don't recognize — that would trigger settlement on bad data) |

**Markets/selections** (`ProviderMarket`/`ProviderSelection`), from `competition.odds[0]`
only — the single inline book:

| Market      | ESPN fields                                 | Selections                  |
| ----------- | ------------------------------------------- | --------------------------- |
| `SPREAD`    | `pointSpread.{home,away}.close.{line,odds}` | `HOME`/`AWAY`               |
| `TOTAL`     | `total.{over,under}.close.{line,odds}`      | `OVER`/`UNDER`              |
| `MONEYLINE` | `moneyline.{home,away}.close.odds`          | `HOME`/`AWAY`, `line: null` |

`sourceBook` = `odds[0].provider.displayName`, read fresh every sync (not hardcoded) — if ESPN
ever changes which book is inline, this adapter follows without a code change. A game whose
`competition.odds` is missing or empty contributes zero markets for that sync pass; this is
normal (5/16 NFL games in the spike had no line posted yet), not an error.

**Results** (`ProviderResult`): `competitors[].score` parsed to `number` →
`homeScore`/`awayScore`; status via the same table above.

## Failure handling

Parsing is per-item, not per-request, at two levels:

- **Per game.** `fetchScoreboard` loops `events` and wraps each game's mapping in its own
  `try/catch`. One game with a reshaped or missing required field is skipped; the rest of the
  slate still syncs.
- **Per market.** Within a game, extracting `SPREAD`/`TOTAL`/`MONEYLINE` from `odds[0]` are
  three independent attempts — a malformed `pointSpread` doesn't take `moneyline` down with it.

Every skip increments a counter. `SyncOddsSummary` (currently `{gamesUpserted, marketsUpserted,
selectionsUpserted, snapshotsWritten}`) gains `gamesSkipped` and `marketsSkipped`, surfaced in
the existing `/api/cron/sync-odds` JSON response. This doesn't add alerting (phase 6 still
owns that) — it makes the count exist so phase 6 has something to alert on, instead of a silent
drop being invisible until someone asks why a game never showed up.

A request-level failure (ESPN unreachable, non-200, unparseable top-level JSON) is not caught
here — it propagates out of `fetchScoreboard` and fails that sync tick openly. The next `*/15`
cron run tries again; this mirrors how `STALE_AFTER_MS` already handles a feed that goes dark
by suspending markets rather than leaving stale lines bettable; no separate retry logic is
needed inside one tick.

This means a request-level failure is scoped to the whole tick, not to the sport that failed:
`syncOdds`'s existing loop over `['NFL', 'NCAAF']` ([sync.ts](../../src/server/odds/sync.ts))
isn't modified by this design, so an NFL-only ESPN outage still aborts that call before NCAAF's
turn runs, and `suspendStaleMarkets()` in the cron route never executes either. Per-sport
isolation would mean wrapping each loop iteration in `sync.ts` itself — out of scope here since
that file is shared with the fixture path and this design's goal is zero behavior change to it.
Accepted for v1 on the same grounds the roadmap already gives this whole adapter: a private
group's Saturday going stale for 15 minutes is an annoyance, not an incident.

## Testing

No live ESPN calls in tests — this is an undocumented endpoint with no SLA, and CI can't
depend on it being reachable or shaped the same way tomorrow. Instead:

- 2–3 real payloads captured during this spike are committed as fixture JSON under
  `src/server/odds/espn/__tests__/fixtures/`: one game with odds posted, one with no odds yet,
  one `STATUS_FINAL` game with a score. Same spirit as `src/fixtures/`, but recording ESPN's
  actual shape instead of a hand-authored one.
- `mappers.test.ts` unit-tests the ESPN → `Provider*` mapping directly against that recorded
  JSON, including the per-item skip behavior on a deliberately mangled copy of one fixture.
- `sync.ts`'s existing tests already cover `syncOdds`/`syncResults` behavior against
  `FixtureOddsProvider`/`FixtureScoreProvider` — that coverage is untouched, since the mappers
  are the only new surface.
- No new test exercises the kill switch's env var branching beyond confirming
  `sync-odds/route.ts` constructs the right pair of classes for each value — an integration
  concern, not a unit-test one.

## Open questions carried forward

None from this design. The roadmap's task 4 ("CFB paging") turned out not to need pagination —
`groups=80&limit=200` is a single request — so it's absorbed into Architecture above rather
than remaining a separate task. Task 7 (admin-run backfill against a real season) is
implementation/rollout, not design, and stays on the roadmap as-is.
