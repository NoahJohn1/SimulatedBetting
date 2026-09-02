# Core Betting Engine — Design Spec

**Date:** 2026-08-14
**Status:** Built (fixture odds only; see [docs/README.md](../README.md#where-things-stand))
**Scope:** Subsystem 1 of 4 (see [../roadmap.md](../roadmap.md))

## Purpose

A play-money sportsbook for a small private group, covering NFL and college football.
Members receive simulated currency, bet against real sportsbook lines, and compete on a
season-long leaderboard. No real money is involved at any point.

The product goal is that betting _feels_ like ESPN Bet or DraftKings on a phone. The
engineering goal is that every simulated dollar is accounted for.

## Success criteria

V1 is done when all of the following are true:

1. A member can sign in, join the active season, and receive a starting bankroll.
2. The Games board shows NFL and CFB games with moneyline, spread, and total markets.
3. A member can place single bets and parlays, and the odds are locked at placement.
4. Finished games settle automatically and pay out correctly, including pushes and voids.
5. Every balance change has a corresponding immutable ledger entry, and each member can
   read their own full transaction history.
6. An admin can approve members, run seasons, and adjust balances with a required note.
7. Running any background job twice produces no duplicate money.

## Non-goals for v1

Live in-game betting · cash-out · player props · teasers · same-game parlays ·
multi-book line shopping · push notifications · native mobile apps · real currency of any kind.

Each is deliberately excluded. None is required to prove the engine works, and several
(live betting, cash-out) depend on continuous odds polling that v1 does not have.

## Architecture

A single Next.js application (App Router, TypeScript) deployed on Vercel, backed by
Postgres via Drizzle ORM. Three cron-triggered route handlers run the background work.

```
┌─────────────────────────────────────────────────────────┐
│  Next.js app (single deployment)                        │
│                                                          │
│  React UI (mobile-first, PWA)                            │
│      ↕ server actions / route handlers                   │
│  Domain layer  ── pure functions, no I/O                 │
│      odds math · leg grading · parlay grading            │
│  Service layer ── transactions, validation               │
│      placeBet · settleGame · payAllowance · adjust       │
│      ↕                                                   │
│  Drizzle → Postgres                                      │
│                                                          │
│  /api/cron/sync-odds     (every 15 min)                  │
│  /api/cron/settle        (every 10 min)                  │
│  /api/cron/allowance     (weekly)                        │
│  /api/cron/reconcile     (daily)                         │
└─────────────────────────────────────────────────────────┘
              ↕ OddsProvider / ScoreProvider interfaces
     FixtureProvider (v1)  ·  TheOddsApiProvider (later)
```

**Why one deployment.** Two people, no ops budget. One repo, one language, one place to
look when something breaks. Cron routes are thin wrappers that call plain functions, so
moving to a dedicated worker later is a deployment change rather than a rewrite.

**Known constraint.** Vercel cron invocations are time-limited (~60s on the free tier).
Settlement therefore processes games in batches and is safe to resume — see
[Background jobs](#background-jobs).

### Layering rule

The domain layer performs no I/O. Odds conversion, leg grading, and parlay grading are
pure functions taking values and returning values. This is what makes the highest-risk
logic in the system exhaustively testable without a database.

## Data model

All monetary values are **integer cents** stored as `BIGINT`. No floating-point value ever
touches a balance. All timestamps are `TIMESTAMPTZ`. Primary keys are UUIDv7 (time-sortable).

### Identity and league

**`users`**

| Column                | Type        | Notes                               |
| --------------------- | ----------- | ----------------------------------- |
| `id`                  | uuid        | PK                                  |
| `provider`            | enum        | `GOOGLE`                            |
| `provider_account_id` | text        | unique with `provider`              |
| `email`               | text        | from OAuth                          |
| `display_name`        | text        | editable                            |
| `avatar_url`          | text        | nullable                            |
| `role`                | enum        | `USER` · `ADMIN`                    |
| `status`              | enum        | `PENDING` · `APPROVED` · `DISABLED` |
| `created_at`          | timestamptz |                                     |

New OAuth sign-ins land in `PENDING`. A `PENDING` user can sign in and see a holding
screen, and nothing else. This gate exists because Google sign-in means anyone with a
Google account can reach the login page.

**`seasons`**

| Column                    | Type        | Notes                               |
| ------------------------- | ----------- | ----------------------------------- |
| `id`                      | uuid        | PK                                  |
| `name`                    | text        | e.g. "2026 Football Season"         |
| `starts_at` / `ends_at`   | timestamptz |                                     |
| `starting_bankroll_cents` | bigint      | default 1,000,000 ($10,000)         |
| `weekly_allowance_cents`  | bigint      | default 50,000 ($500)               |
| `allowance_weekday`       | smallint    | 0–6, default Tuesday                |
| `status`                  | enum        | `UPCOMING` · `ACTIVE` · `COMPLETED` |

Exactly one season may be `ACTIVE` at a time; enforced by a partial unique index.

**`season_memberships`**

| Column                  | Type        | Notes                                               |
| ----------------------- | ----------- | --------------------------------------------------- |
| `id`                    | uuid        | PK                                                  |
| `user_id` / `season_id` | uuid        | unique together                                     |
| `balance_cents`         | bigint      | cached; see [Balance integrity](#balance-integrity) |
| `joined_at`             | timestamptz |                                                     |

Joining writes the `SEASON_STARTING_GRANT` entry with idempotency key
`grant:<membership_id>`, so a retried join cannot mint a second bankroll.

**Membership holds the money, not the user.** A balance belongs to a season. New season,
new membership, fresh grant, and the prior season's ledger stays intact forever.

### Money

**`ledger_entries`** — append-only. Never updated, never deleted.

| Column                | Type        | Notes                           |
| --------------------- | ----------- | ------------------------------- |
| `id`                  | uuid        | PK                              |
| `membership_id`       | uuid        | FK                              |
| `amount_cents`        | bigint      | signed; negative = money out    |
| `type`                | enum        | see below                       |
| `balance_after_cents` | bigint      | snapshot for auditability       |
| `bet_id`              | uuid        | nullable FK                     |
| `actor_user_id`       | uuid        | nullable; set for admin actions |
| `note`                | text        | required for admin types        |
| `idempotency_key`     | text        | **unique**                      |
| `created_at`          | timestamptz |                                 |

Entry types: `SEASON_STARTING_GRANT` · `WEEKLY_ALLOWANCE` · `BET_PLACED` · `BET_WON` ·
`BET_PUSHED` · `BET_VOIDED` · `ADMIN_CREDIT` · `ADMIN_DEBIT` · `SETTLEMENT_REVERSAL`.

Nothing in the system moves money without writing one of these.

### Sports and odds

**`teams`** — `id`, `sport` (`NFL` · `NCAAF`), `external_id`, `name`, `abbreviation`, `logo_url`.

**`games`** — `id`, `sport`, `external_id` (unique per sport), `home_team_id`,
`away_team_id`, `starts_at`, `season_year`, `week` (nullable), `status`
(`SCHEDULED` · `IN_PROGRESS` · `FINAL` · `POSTPONED` · `CANCELED`),
`home_score`, `away_score` (nullable until final).

**`markets`** — `id`, `game_id`, `type` (`MONEYLINE` · `SPREAD` · `TOTAL`),
`source_book` (text, e.g. `draftkings`), `status` (`OPEN` · `SUSPENDED` · `SETTLED`),
`last_synced_at`. Unique on (`game_id`, `type`).

**`selections`** — `id`, `market_id`, `side` (`HOME` · `AWAY` · `OVER` · `UNDER`),
`line` (numeric, nullable — null for moneyline), `price_american` (integer),
`updated_at`. Unique on (`market_id`, `side`).

**`odds_snapshots`** — `id`, `selection_id`, `line`, `price_american`, `captured_at`.
Append-only history. Enables line-movement display and records what was actually offered.

### Betting

**`bets`** — `id`, `membership_id`, `type` (`SINGLE` · `PARLAY`), `stake_cents`,
`potential_payout_cents`, `combined_price_american`, `status`
(`PENDING` · `WON` · `LOST` · `PUSHED` · `VOIDED`), `settlement_attempts` (integer,
default 0), `placed_at`, `settled_at` (nullable).

`settlement_attempts` increments each time the bet is settled or re-settled, and feeds the
settlement idempotency key so a correction cannot collide with the original payout.

**`bet_legs`** — `id`, `bet_id`, `selection_id`, `line_at_placement` (numeric, nullable),
`price_at_placement` (integer), `status` (same enum), `settled_at` (nullable).

**Legs freeze their line and price.** Later line movement cannot retroactively change a
placed bet. This is the single most important correctness property in the system.

**Bets reference selections, never games.** This keeps the betting and money paths
independent of where a market came from, which is what allows user-created events to be
added later without touching the ledger. See [../roadmap.md](../roadmap.md).

## Odds math

American prices are converted to an exact **rational** decimal multiplier, never a float.

For price `p`:

- `p > 0` → numerator `p + 100`, denominator `100`
- `p < 0` → numerator `100 + |p|`, denominator `|p|`

A parlay multiplies numerators and denominators across all surviving legs. Payout is
computed once, at the end, with BigInt arithmetic:

```
payout_cents = round_half_up(stake_cents × NUM ÷ DEN)
profit_cents = payout_cents − stake_cents
```

Rounding happens exactly once, on the final payout — never per leg. The combined price is
converted back to American purely for display.

Worked examples: `-110` on a $100 stake returns $190.91 ($90.91 profit). A three-leg parlay
of `-110 / -110 / +150` on $100 returns $911.16 — `(210/110) × (210/110) × (250/100) ×
10000 cents`, rounded once.

## Grading rules

### Single leg

| Market    | Won                                              | Lost              | Push                                                                              |
| --------- | ------------------------------------------------ | ----------------- | --------------------------------------------------------------------------------- |
| Moneyline | chosen team wins                                 | chosen team loses | game ends tied (possible in the NFL after overtime; college football has no ties) |
| Spread    | `score + line` beats opponent's score            | it doesn't        | `score + line` equals opponent's score                                            |
| Total     | combined score clears the line in your direction | it doesn't        | combined score equals the line                                                    |

Half-point lines cannot push. That is the entire purpose of the hook.

Spread grading, concretely: a leg on `HOME` with line `L` computes `home_score + L`
against `away_score`. Greater is a win, equal is a push, less is a loss. Away legs use
their own stored line symmetrically.

### Parlay

Evaluated from leg statuses:

1. Any leg `LOST` → parlay `LOST`. Remaining legs need not resolve.
2. Legs that `PUSH` or `VOID` are **removed**, and the parlay recalculates at the reduced
   odds. A three-leg parlay with one push pays as a two-leg parlay.
3. All surviving legs `WON` → parlay `WON` at the recomputed combined odds.
4. Every leg pushed or voided → full stake refunded, parlay `PUSHED`.

Because pushed and voided legs are removed, the payout computed at settlement can be lower
than `potential_payout_cents`. That column is the figure quoted at placement; **settlement
always recomputes the payout from the surviving legs** and pays that. The two agree only
when no leg pushed or voided.

## Bet placement

Validation, all of which must pass:

1. User is `APPROVED` and holds a membership in the `ACTIVE` season.
2. Every leg's game is `SCHEDULED` and its kickoff is in the future.
3. Every leg's market is `OPEN`.
4. `stake_cents ≥ 100` ($1.00 minimum) and `≤ balance_cents`.
5. Each leg's submitted line and price match the current stored values.
6. Parlays: 2–10 legs, and **no two legs from the same game**.

Rule 5 is the standard sportsbook race. If the sync job moved a line while the slip was
open, the request is rejected with the new price and the UI asks the member to re-confirm.
Silently accepting a different number than the one displayed is never acceptable.

Rule 6 exists because same-game legs are correlated — "Chiefs win" and "Chiefs −3.5" are
close to the same wager, and paying them at independent odds is free money. Real books
price same-game parlays separately; v1 disallows them.

Placement executes as one transaction:

```
BEGIN
  SELECT … FROM season_memberships WHERE id = ? FOR UPDATE   -- row lock
  re-validate balance and all leg lines/prices
  INSERT bets, bet_legs
  INSERT ledger_entries (BET_PLACED, −stake, idempotency_key = 'bet:<bet_id>:placed')
  UPDATE season_memberships SET balance_cents = balance_cents − stake
COMMIT
```

The row lock is what prevents two devices from spending the same balance twice.

## Background jobs

Every job is a thin cron route calling a plain function, and every ledger write it
performs carries a deterministic idempotency key. Running any job twice is a no-op.

**`sync-odds` — every 15 minutes.** Fetches games and markets for the next 14 days from
the `OddsProvider`, upserts `games` / `markets` / `selections`, and appends an
`odds_snapshots` row whenever a line or price changed. Markets whose `last_synced_at` is
older than 30 minutes are set to `SUSPENDED` so nobody bets a dead line.

**`settle` — every 10 minutes.** Finds `FINAL` games with pending legs, in batches sized
to fit the invocation limit. Each game settles in its own transaction: grade every leg,
grade each affected bet, write the payout entry, update the cached balance, set the market
to `SETTLED`. Partial progress persists; the next run continues.

Payout entry amounts, given that `BET_PLACED` already debited the full stake:

| Bet outcome                   | Entry        | Amount                                                              |
| ----------------------------- | ------------ | ------------------------------------------------------------------- |
| Won                           | `BET_WON`    | full return — stake **plus** profit, recomputed from surviving legs |
| Pushed / all legs void        | `BET_PUSHED` | stake returned in full                                              |
| Voided (canceled game, admin) | `BET_VOIDED` | stake returned in full                                              |
| Lost                          | none         | the `BET_PLACED` debit already stands                               |

A losing bet writes no entry at settlement — the money left the balance when the bet was
placed. Only its status changes.

Idempotency keys are `bet:<bet_id>:settled:<settlement_attempt>`, where the attempt counter
starts at 1 and increments on re-settlement. A plain `bet:<id>:settled` key would collide
with the corrected entries written after a `SETTLEMENT_REVERSAL`, silently swallowing the
correction.

**`allowance` — weekly.** Credits `weekly_allowance_cents` to every membership in the
`ACTIVE` season. Idempotency key `allowance:<membership_id>:<iso_week>` makes double runs
harmless. Week boundaries use `America/New_York`; the default day is Tuesday, matching the
NFL week rollover.

**`reconcile` — daily.** Asserts `balance_cents = SUM(ledger_entries.amount_cents)` for
every membership and raises loudly on any mismatch.

## Balance integrity

The ledger is the source of truth. `season_memberships.balance_cents` is a cache, updated
in the same transaction as the entry that justifies it. Reads are fast; drift is detected
rather than hidden.

Corrections never rewrite history. A bet settled against a wrong score is fixed by writing
`SETTLEMENT_REVERSAL` entries and then the correct ones. The ledger only grows, and it can
always be replayed to explain how a balance came to be — including the mistake.

## Failure handling

| Failure                                   | Behavior                                                                                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Odds provider unavailable or rate-limited | Serve last-known odds with a staleness indicator; suspend markets stale beyond 30 minutes. The app does not go down because a feed did. |
| Settlement interrupted mid-batch          | Per-game transactions; completed work persists, remainder retries next run.                                                             |
| Cron double-fires                         | Unique idempotency keys make the second write a no-op.                                                                                  |
| Concurrent bets from two devices          | `FOR UPDATE` lock on the membership row; the second bet is rejected for insufficient funds.                                             |
| Score reported incorrectly                | Admin re-settles; reversing entries plus corrected ones.                                                                                |
| Line moves between slip and placement     | `409` with the new price; UI requires re-confirmation.                                                                                  |
| Game postponed or canceled                | Pending legs `VOIDED`. Singles refunded in full; parlay legs dropped and odds recomputed.                                               |
| Cached balance drifts                     | Daily reconciliation job raises on mismatch.                                                                                            |
| `PENDING` user calls an API               | `403`. Authorization is checked server-side on every request, not by hiding UI.                                                         |

## Screens

Four bottom tabs, plus detail views and a hidden admin area. Mobile-first, installable as
a PWA.

- **Sign in** — Google. Pending users see a holding screen.
- **Games** (tab 1) — sport toggle, week selector, one row per game with a
  spread / moneyline / total grid. The default landing screen.
- **Game detail** — all markets for one matchup, with line-movement history.
- **Bet slip** — bottom sheet. One leg is a single; adding a second reveals a
  Singles/Parlay toggle. Stake input with quick-amount chips and a live payout preview.
- **My Bets** (tab 2) — Pending and Settled, showing every leg and its result.
- **Standings** (tab 3) — season leaderboard ordered by balance, with record and ROI shown.
- **Me** (tab 4) — balance and **the full transaction history**. Every ledger entry is
  visible to its owner, including admin adjustments and their notes.
- **Admin** (hidden) — approve users, manage seasons, adjust balances with a mandatory
  note, void and re-settle bets, read any ledger.

The member-facing ledger is a deliberate choice: if an admin adjusts your balance, you see
it and you see why.

## Testing

**Unit, table-driven, no I/O** — the domain layer:

- American-to-rational conversion across positive, negative, and boundary prices
- Payout rounding at the half-cent boundary
- Every push case for all three market types
- Parlay grading: all-win, any-loss, one push, one void, all push

**Integration, against fixtures:**

1. _Settlement correctness_ — seed a season, place known bets on fixture games, mark them
   final, assert exact ledger entries and exact resulting balances.
2. _Idempotency_ — run every job twice; assert the ledger is identical after the second run.
3. _Reconciliation as a property_ — after any sequence of operations,
   `balance = SUM(ledger)` holds for every membership.
4. _Concurrency_ — two simultaneous placements against a balance that only covers one;
   assert exactly one succeeds.

The fixture-backed `OddsProvider` is what makes these deterministic. A live feed would make
them slow and flaky.

## Provider interfaces

```ts
interface OddsProvider {
  getUpcomingGames(sport: Sport, withinDays: number): Promise<ProviderGame[]>;
  getMarkets(gameExternalIds: string[]): Promise<ProviderMarket[]>;
}

interface ScoreProvider {
  getResults(gameExternalIds: string[]): Promise<ProviderResult[]>;
}
```

V1 ships `FixtureOddsProvider` and `FixtureScoreProvider`, reading committed JSON fixtures
covering a realistic NFL and CFB slate with predetermined outcomes — including at least one
push, one postponement, and one line movement.

The first real implementation targets **The Odds API** (the-odds-api.com), which aggregates
DraftKings, FanDuel, BetMGM, ESPN Bet and others, and covers `americanfootball_nfl` and
`americanfootball_ncaaf`. One book is designated the house line per market; `source_book`
records which. ESPN Bet and Underdog have no public API, and scraping them would violate
their terms — the aggregator is the legitimate route to those same numbers.
