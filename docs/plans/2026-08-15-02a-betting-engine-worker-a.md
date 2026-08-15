# Plan 2, Track A — Bet placement & settlement (Worker A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** A member can place a validated single or parlay against stored lines, and finished
games settle automatically and correctly — including pushes, voids, partial batches, and
admin-corrected scores. Still headless: no UI, driven by tests.

**Scope:** Worker A's half of Plan 2 only. Worker B's half (provider interfaces, fixtures,
`syncOdds`, market suspension) is a separate document that B writes. Nothing here creates or
modifies a file B owns.

**Prerequisite:** Plan 1 merged, and the Plan 2 **pair phase** (sports and betting schema)
agreed and migrated by B.

**New for you in this plan: you now need Docker.** Plan 1 Track A was pure functions. Tasks A4
onward run real transactions against Postgres. Run `npm run db:up` before you start.

---

## Files you own in this plan

| Path | Note |
|---|---|
| `src/domain/**` | Yours since Plan 1 |
| `src/server/bets/**` | New — yours from Plan 2 onward |
| `src/server/bets/__tests__/**` | Your tests, including your own DB helpers (see below) |

## Files you must not touch

`src/db/**` · `drizzle/**` · `src/server/money/**` · `src/server/seasons/**` ·
`src/server/admin/**` · `src/server/odds/**` · `src/fixtures/**` · `src/test/**`

**One consequence worth naming up front:** `src/test/db.ts` (`resetDb`, factories) belongs to B.
You need equivalent helpers for bets and legs and you may not add them there. Build your own in
`src/server/bets/__tests__/helpers.ts` — importing `resetDb` from `@/test/db` is fine, adding to
it is not. The small duplication is cheaper than a shared file two people edit.

---

## What you consume from B

Already built and merged in Plan 1:

```ts
// '@/server/money/ledger'
postEntry(tx: Tx, input: {
  membershipId: string;
  amountCents: bigint;
  type: LedgerEntryType;
  idempotencyKey: string;
  actorUserId?: string;
  note?: string;
}): Promise<{ applied: boolean; balanceCents: bigint }>

// '@/db/client'
db, type Tx
```

`postEntry` takes the `FOR UPDATE` lock on the membership row and updates the cached balance.
**You never write `season_memberships.balance_cents` yourself, and you never insert a
`ledger_entries` row directly.**

Two properties of `postEntry` your code depends on and your tests must assert:

1. `applied: false` when the idempotency key already exists — a duplicate call is a no-op that
   still returns the current balance.
2. It participates in *your* transaction (it takes a `Tx`), so a failure later in your
   transaction rolls the entry back with everything else.

Landing in Plan 2, from B's half: `syncOdds` populating `games`, `markets`, `selections`,
`odds_snapshots`, and the fixture providers. You do not call these — your tests seed rows
directly — but their existence is what makes end-to-end verification possible at the rejoin.

## What you publish to B in this plan

```ts
// '@/server/bets/place'
placeBet(input: PlaceBetInput): Promise<PlaceBetResult>

// '@/server/bets/settle'
settleGame(gameId: string): Promise<SettleGameSummary>
settleFinalGames(options?: SettleRunOptions): Promise<SettleRunSummary>

// '@/server/bets/resettle'
resettleBet(input: ResettleBetInput): Promise<ResettleBetResult>
```

`resettleBet` is the one B calls: their admin screen is the trigger, but the money-moving logic
is settlement logic and lives on your side. Agree this signature with B before either of you
builds against it.

---

## Decisions this plan makes

These answer the five open questions in [worker-a-brief.md](worker-a-brief.md#what-you-need-to-work-out-before-writing-your-tasks).
Raise each with B, then promote them to [decisions.md](../decisions.md) as new numbered entries
(don't renumber existing ones).

### A-D1 — Expected validation failures are a returned result, not a thrown error

`placeBet` returns `{ ok: false, error }` for every one of the six spec rules. It throws only for
programmer errors — a malformed input that no user could produce. Rejecting a bet is a normal
outcome of a correct system, and modelling it as an exception loses the structured data the UI
needs (the new price, the current balance).

### A-D2 — Line checks collect every movement; other rules fail fast in a fixed order

Rule 5 (`LINE_MOVED`) is evaluated across **all** legs and reports every leg that moved in one
error. A three-leg parlay where two legs moved must produce one re-confirmation prompt, not two
sequential rejections. Every other rule short-circuits on the first violation, in the fixed order
listed in Task A3, so the error a given input produces is deterministic and testable.

### A-D3 — Submitted lines are compared as normalized decimal strings, never as floats

Postgres `numeric` arrives as a string. The client sends what it displayed. Both are normalized
to a canonical decimal string (`-3.5`, `44`, `0`) and compared exactly. Parsing to `number` on
either side of the comparison invites a `-3.5 !== -3.5000000001` bug in the one check whose whole
job is to catch a mismatch.

Grading still uses `number` for the line, as Plan 1's `gradeLeg` already does. Half- and
quarter-point lines are exactly representable in binary floating point, so comparison-by-value
inside grading is safe; it is the *equality check against stored text* that must not round-trip.

### A-D4 — `placeBet` places exactly one bet; multiple singles are multiple calls

The slip can hold four legs as four singles. That is four calls, each independently valid or
rejected, each with its own derived idempotency key. One call that half-succeeds would need a
partial-failure result type that every caller then has to handle.

### A-D5 — Double submission is prevented by a client-generated request id on `bets`

`bets.client_request_id` (text, unique, nullable) carries a UUID the client generates when the
slip opens. A retried submission hits the unique constraint and returns the existing bet with
`DUPLICATE_REQUEST` rather than placing a second wager. **This is a schema addition you must
raise in the pair phase** — the ledger's `bet:<bet_id>:placed` key cannot help here, because a
retry generates a new `bet_id` and therefore a new key.

### A-D6 — Settlement is per-game transactions with a wall-clock budget; no cursor

Each game settles in its own transaction. The candidate query is "games that are `FINAL`,
`POSTPONED`, or `CANCELED` and still have a `PENDING` leg" — settling a game removes it from that
set, so a run that stops halfway simply finds fewer games next time. Resumability needs no
checkpoint table, because the work itself is the checkpoint.

The runner stops when it has spent its budget (default 45s of the ~60s Vercel limit) or hit
`maxGames` (default 25), checked **before** starting each game so no game is abandoned mid-flight.

### A-D7 — Bets are settled in `membership_id` order to avoid deadlocking against placement

`placeBet` locks one membership row. A settlement transaction covering a game with bets from six
members locks six. Two settlement transactions taking those locks in different orders deadlock.
Within every transaction, affected bets are processed ordered by `membership_id` ascending.

### A-D8 — A parlay that has already lost does not wait for its remaining legs

Spec rule 1: any leg `LOST` → parlay `LOST`, remaining legs need not resolve. Those legs stay
`PENDING` and grade normally when their own game finalizes. Bet-level settlement is guarded by
`bets.status = 'PENDING'`, so a bet is never settled twice and its status is never reopened.

### A-D9 — Re-settlement is admin-triggered, never automatic on a score change

A corrected score sets no money in motion by itself. `resettleBet` runs when an admin invokes it,
with a required note and an `actor_user_id`. A score feed that flaps would otherwise churn
balances with reversals, and D15's audit trail exists precisely so a human is on the record.

### A-D10 — One reversal entry per re-settlement, not one per prior entry

The reversal amount is the negated sum of every non-`BET_PLACED` entry for that bet. The
`BET_PLACED` debit is never reversed — the stake left the balance at placement and the corrected
settlement entry accounts for it. Key: `bet:<bet_id>:reversal:<new_attempt>`.

---

## What you need from the pair phase

Bring this list to the schema sitting. Everything below is B's migration to write; your code
breaks without it.

**Columns you read or write:**

| Table | Columns your code depends on |
|---|---|
| `games` | `id`, `status`, `starts_at`, `home_score`, `away_score`, `home_team_id`, `away_team_id` |
| `markets` | `id`, `game_id`, `type`, `status`, `last_synced_at` |
| `selections` | `id`, `market_id`, `side`, `line`, `price_american` |
| `bets` | all spec columns, **plus `client_request_id text unique`** (A-D5) |
| `bet_legs` | all spec columns |
| `ledger_entries` | `bet_id` (spec already adds it) |

**Indexes to request:**

- `bet_legs (status)` partial `WHERE status = 'PENDING'` — the settlement candidate query scans
  this every ten minutes forever
- `bet_legs (selection_id)`
- `bet_legs (bet_id)`
- `bets (membership_id, status)` — powers My Bets in Plan 3 as well
- `games (status, starts_at)`

**Enum values you rely on:** `bets.status` and `bet_legs.status` both need `VOIDED`. `markets.status`
needs `SETTLED`. `ledger_entries.type` already has `BET_PLACED`, `BET_WON`, `BET_PUSHED`,
`BET_VOIDED`, `SETTLEMENT_REVERSAL` from Plan 1.

**One judgment call to settle jointly:** whether `selections.line` is `numeric(5,2)` or text.
Numeric is right; just confirm how Drizzle returns it in this project's config, because A-D3
assumes a string.

## What you owe B in the pair phase

B's fixture slate is the test data your settlement tests run against, and their brief says to ask
you what you need. Hand them this list:

1. A **spread landing exactly on a whole number** (e.g. `-4` with a 24–20 final) — spread push.
2. A **total landing exactly on a whole number** (`44` with 24–20) — total push.
3. An **NFL game finishing tied** — moneyline push. College football cannot tie; the fixture must
   be an NFL game or the case is untestable.
4. A **postponed** game and a **canceled** game, both with markets you can attach bets to.
5. A **line movement** on a market between two sync runs — the raw material for the rule 5 test.
6. A game with **all three market types** priced, so the same-game-parlay rule (rule 6) is
   testable against real rows.
7. **At least four games finalizing in the same window**, so the batch runner has something to
   batch and to leave behind.
8. A game with a **corrected final score** — an initial score and a revised one — for the
   `resettleBet` tests.
9. At least one game whose markets you can leave `OPEN` and one you can leave `SUSPENDED`.

Give them this before they build the fixtures. Retrofitting a push into an existing slate means
re-deriving every expected balance in their tests too.

---

## Tasks

| Task | Produces | Needs a DB | Depends on |
|---|---|---|---|
| A1. Line normalization | `src/domain/line.ts` | No | — |
| A2. Placement types and error taxonomy | `src/server/bets/types.ts` | No | A1 |
| A3. Pure placement validation | `src/server/bets/validate.ts` | No | A2 |
| A4. `placeBet` transaction | `src/server/bets/place.ts` | Yes | A3, pair phase |
| A5. `settleGame` | `src/server/bets/settle.ts` | Yes | A4 |
| A6. Void path for postponed and canceled games | `src/server/bets/settle.ts` | Yes | A5 |
| A7. `settleFinalGames` batch runner | `src/server/bets/settle.ts` | Yes | A5, A6 |
| A8. `resettleBet` | `src/server/bets/resettle.ts` | Yes | A5 |

A1–A3 need no database and no pair phase — **start them the day Plan 1 merges**, while B is still
writing the migration. That is roughly a third of this plan's work available immediately.

Branch naming continues from Plan 1: `a/task-a4-place-bet`.

Verify with `npm test -- src/domain/ src/server/bets/`. Never `npm run verify` until the rejoin.

---

### Task A1: Line normalization

**Files:**
- Create: `src/domain/line.ts`
- Test: `src/domain/__tests__/line.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `normalizeLine(line: string | number | null): string | null`
  - `linesEqual(a: string | number | null, b: string | number | null): boolean`
  - `lineToNumber(line: string | null): number | null` — for handing to `gradeLeg`

- [ ] **Step 1: Write the failing test**

Cases to cover:

```ts
normalizeLine('-3.50')   // '-3.5'
normalizeLine('-3.5')    // '-3.5'
normalizeLine(-3.5)      // '-3.5'
normalizeLine('44.00')   // '44'
normalizeLine('0.0')     // '0'
normalizeLine('-0')      // '0'      ← there is no negative zero line
normalizeLine(null)      // null

linesEqual('-3.50', -3.5)     // true
linesEqual('44', '44.0')      // true
linesEqual(null, null)        // true
linesEqual(null, '0')         // false ← a moneyline is not a pick'em spread
linesEqual('-3.5', '-4')      // false

lineToNumber('-3.5')  // -3.5
lineToNumber(null)    // null
normalizeLine('abc')  // throws
normalizeLine('1.234')// throws — no line is finer than a quarter point
```

The `null` vs `'0'` case is the one that matters. A moneyline leg has no line at all; a spread of
zero is a pick'em. Treating them as equal would let a moneyline selection be submitted as a
spread and pass rule 5.

- [ ] **Step 2: Run it and confirm it fails**
- [ ] **Step 3: Implement `src/domain/line.ts`**

Trim, reject anything not matching `/^-?\d+(\.\d{1,2})?$/`, strip trailing fractional zeros and a
trailing `.`, collapse `-0` to `0`. Keep it string-in, string-out; do not route through `Number`.

- [ ] **Step 4: Run the test — expect PASS**
- [ ] **Step 5: Commit** — `feat: add canonical line normalization and comparison`

---

### Task A2: Placement types and the error taxonomy

**Files:**
- Create: `src/server/bets/types.ts`
- Test: none of its own (types are exercised by A3)

**Interfaces:**
- Consumes: `LegStatus`, `MarketType`, `Side` from `@/domain/grading`
- Produces: the input, result, and error types below

- [ ] **Step 1: Write the request types**

```ts
export interface PlaceBetLegInput {
  selectionId: string;
  /** Exactly the line the client displayed. null for moneyline. */
  line: string | null;
  /** Exactly the American price the client displayed. */
  priceAmerican: number;
}

export interface PlaceBetInput {
  userId: string;
  type: 'SINGLE' | 'PARLAY';
  stakeCents: bigint;
  legs: PlaceBetLegInput[];
  /** Client-generated UUID, stable across retries of the same submission. */
  clientRequestId: string;
}
```

The client sends `line` and `priceAmerican` per leg because that is what makes spec rule 5
checkable at all. Without them the server has nothing to compare against and "the price you saw
is the price you got" becomes unenforceable.

- [ ] **Step 2: Write the result and error types**

```ts
export interface PlacedBet {
  id: string;
  type: 'SINGLE' | 'PARLAY';
  stakeCents: bigint;
  potentialPayoutCents: bigint;
  combinedPriceAmerican: number;
  balanceAfterCents: bigint;
  legs: { selectionId: string; line: string | null; priceAmerican: number }[];
}

export interface LineMovement {
  legIndex: number;
  selectionId: string;
  submittedLine: string | null;
  currentLine: string | null;
  submittedPrice: number;
  currentPrice: number;
}

export type PlaceBetError =
  | { code: 'NOT_APPROVED' }
  | { code: 'NO_ACTIVE_SEASON' }
  | { code: 'NOT_A_MEMBER' }
  | { code: 'UNKNOWN_SELECTION'; legIndex: number; selectionId: string }
  | { code: 'INVALID_LEG_COUNT'; legCount: number; min: number; max: number }
  | { code: 'DUPLICATE_GAME'; gameId: string; legIndexes: number[] }
  | { code: 'GAME_NOT_BETTABLE'; legIndex: number; gameStatus: string; startsAt: string }
  | { code: 'MARKET_CLOSED'; legIndex: number; marketStatus: string }
  | { code: 'STAKE_BELOW_MINIMUM'; stakeCents: bigint; minimumCents: bigint }
  | { code: 'INSUFFICIENT_FUNDS'; stakeCents: bigint; balanceCents: bigint }
  | { code: 'LINE_MOVED'; movements: LineMovement[]; newPotentialPayoutCents: bigint }
  | { code: 'DUPLICATE_REQUEST'; betId: string };

export type PlaceBetResult =
  | { ok: true; bet: PlacedBet }
  | { ok: false; error: PlaceBetError };
```

Every error carries what the UI needs to act. `LINE_MOVED` carries the recomputed payout so the
re-confirm prompt can say "$911.16 → $884.20" without a second round trip. `INSUFFICIENT_FUNDS`
carries the balance so the slip can offer "bet max" instead of a dead end.

- [ ] **Step 3: Write the HTTP mapping as a comment block in this file**

Plan 3 consumes it, and it belongs next to the codes:

| Code | Status |
|---|---|
| `NOT_APPROVED`, `NOT_A_MEMBER`, `NO_ACTIVE_SEASON` | 403 |
| `LINE_MOVED` | 409 (spec: [Failure handling](../specs/2026-08-14-core-betting-engine-design.md#failure-handling)) |
| `DUPLICATE_REQUEST` | 200 with the existing bet |
| everything else | 422 |

- [ ] **Step 4: `npm run typecheck` — expect PASS**
- [ ] **Step 5: Commit** — `feat: add bet placement request and error types`

---

### Task A3: Pure placement validation

The six rules evaluated against an already-loaded snapshot of the world. No database access in
this file, which is what lets every rule and every ordering interaction be table-tested in
milliseconds.

**Files:**
- Create: `src/server/bets/validate.ts`
- Test: `src/server/bets/__tests__/validate.test.ts`

**Interfaces:**
- Consumes: `@/domain/line`, `@/domain/odds`, types from A2
- Produces:

```ts
export const MIN_STAKE_CENTS = 100n;
export const MIN_PARLAY_LEGS = 2;
export const MAX_PARLAY_LEGS = 10;

export interface PlacementContext {
  now: Date;
  user: { status: 'PENDING' | 'APPROVED' | 'DISABLED' };
  membership: { id: string; balanceCents: bigint } | null;
  activeSeasonId: string | null;
  /** One entry per submitted leg, in submission order. null when the selection doesn't exist. */
  selections: (LoadedSelection | null)[];
}

export interface LoadedSelection {
  selectionId: string;
  marketId: string;
  marketType: MarketType;
  marketStatus: 'OPEN' | 'SUSPENDED' | 'SETTLED';
  side: Side;
  line: string | null;
  priceAmerican: number;
  gameId: string;
  gameStatus: string;
  gameStartsAt: Date;
}

export function validatePlacement(
  input: PlaceBetInput,
  ctx: PlacementContext,
): PlaceBetError | null;

export function quotePlacement(
  input: PlaceBetInput,
  ctx: PlacementContext,
): { potentialPayoutCents: bigint; combinedPriceAmerican: number };
```

- [ ] **Step 1: Write the failing test**

One `describe` per rule, plus an ordering block. Minimum cases:

- **Identity:** `PENDING` user → `NOT_APPROVED`; `DISABLED` → `NOT_APPROVED`; no active season →
  `NO_ACTIVE_SEASON`; approved user with no membership → `NOT_A_MEMBER`.
- **Shape:** unknown selection → `UNKNOWN_SELECTION` with the right `legIndex`; `SINGLE` with two
  legs → `INVALID_LEG_COUNT`; `PARLAY` with one leg → `INVALID_LEG_COUNT`; 11 legs →
  `INVALID_LEG_COUNT`; two legs from one game → `DUPLICATE_GAME` listing both indexes.
- **Bettability:** game `IN_PROGRESS` → `GAME_NOT_BETTABLE`; game `FINAL` → same; kickoff one
  second in the past → same; kickoff one second in the future → passes. Market `SUSPENDED` →
  `MARKET_CLOSED`; `SETTLED` → `MARKET_CLOSED`.
- **Stake:** `99n` → `STAKE_BELOW_MINIMUM`; exactly `100n` passes; stake one cent over balance →
  `INSUFFICIENT_FUNDS`; stake exactly equal to balance passes.
- **Lines:** price changed → `LINE_MOVED`; line changed → `LINE_MOVED`; `'-3.50'` submitted
  against `'-3.5'` stored → passes (A-D3); a moneyline submitted with `line: '0'` against stored
  `null` → `LINE_MOVED`; **two legs moved → one error with two movements** (A-D2).
- **Ordering** (A-D2): an input that violates several rules at once returns the first in this
  order — identity → shape → bettability → stake → lines. A disabled user betting $0.50 on a
  finished game gets `NOT_APPROVED`, deterministically.
- **Quote:** a three-leg `-110 / -110 / +150` parlay on `10_000n` quotes `91_116n` and a positive
  combined American price, matching the Plan 1 odds tests.

- [ ] **Step 2: Run it and confirm it fails**
- [ ] **Step 3: Implement `validatePlacement`**

Rules in the A-D2 order. Line checks iterate every leg accumulating `LineMovement[]` and return a
single error if the array is non-empty. `quotePlacement` is `payoutCents(stake, combine(legs))`
and `rationalToAmerican(combined)` — reuse Plan 1's functions, never re-derive the arithmetic.

- [ ] **Step 4: Run the test — expect PASS**
- [ ] **Step 5: Commit** — `feat: add pure bet placement validation`

---

### Task A4: `placeBet`

First task needing a database. `npm run db:up` first.

**Files:**
- Create: `src/server/bets/place.ts`
- Create: `src/server/bets/__tests__/helpers.ts` (your own factories — see the ownership note)
- Test: `src/server/bets/__tests__/place.test.ts`

**Interfaces:**
- Consumes: `db`/`Tx` from `@/db/client`, `postEntry` from `@/server/money/ledger`, A3's validation
- Produces: `placeBet(input: PlaceBetInput): Promise<PlaceBetResult>`

- [ ] **Step 1: Write the test helpers**

`makeUser`, `makeSeason`, `makeMembership`, `makeGame`, `makeMarket`, `makeSelection`, and a
`seedBettableGame()` convenience returning a game with three priced markets. Import `resetDb`
from `@/test/db`; do not extend it.

- [ ] **Step 2: Write the failing test**

- Places a valid single: one `bets` row, one `bet_legs` row, one `BET_PLACED` ledger entry of
  `-stake`, and `balance_cents` reduced by exactly the stake.
- Places a valid three-leg parlay: `potential_payout_cents` and `combined_price_american` match
  `quotePlacement`, and each leg stores `line_at_placement` / `price_at_placement`.
- **Legs freeze their price:** after placement, update the `selections` row to a different price
  and assert the stored leg is unchanged. This is [D10](../decisions.md), the most important
  correctness property in the system — test it explicitly.
- **Rejection writes nothing:** a stake over balance leaves zero `bets`, zero `bet_legs`, and zero
  new `ledger_entries` rows. Assert row counts, not just the error code.
- **The race is caught inside the transaction:** validate against a snapshot, mutate the selection
  price in a concurrent connection before the transaction commits, and assert the bet is rejected.
  The pre-transaction check is an optimization; the in-transaction re-check is the guarantee.
- **Concurrent placement:** two `placeBet` calls with a balance covering only one. Exactly one
  succeeds, the other returns `INSUFFICIENT_FUNDS`, and the balance never goes negative. This is
  the placement-side mirror of B's Task 5 concurrency test.
- **Retry is idempotent:** the same `clientRequestId` twice returns `DUPLICATE_REQUEST` with the
  original `betId`, and there is still exactly one bet and one ledger entry.

- [ ] **Step 3: Run it and confirm it fails**
- [ ] **Step 4: Implement `placeBet`**

```
load context (user, active season, membership, selections)   -- outside the transaction
validatePlacement → return early on error                     -- fail fast, cheap

BEGIN
  insert bets (…, client_request_id) ON CONFLICT (client_request_id) DO NOTHING
    → no row returned means a retry: load and return DUPLICATE_REQUEST
  re-load membership FOR UPDATE and re-load the selections
  validatePlacement again against the fresh context → ROLLBACK and return the error
  insert bet_legs, freezing line and price
  postEntry(tx, { membershipId, amountCents: -stake, type: 'BET_PLACED',
                  idempotencyKey: `bet:${betId}:placed` })
COMMIT
```

The double validation is deliberate: once cheaply before opening a transaction, once inside it
holding the lock. Only the second one is load-bearing.

Note the ordering — inserting the bet row first is what makes `client_request_id` the retry guard
and gives you the `betId` for the idempotency key.

- [ ] **Step 5: Run the test — expect PASS**
- [ ] **Step 6: Commit** — `feat: add transactional bet placement`

---

### Task A5: `settleGame`

**Files:**
- Create: `src/server/bets/settle.ts`
- Test: `src/server/bets/__tests__/settle.test.ts`

**Interfaces:**
- Consumes: `gradeLeg`, `gradeParlay`, `settledPayoutCents` from `@/domain/grading`; `postEntry`
- Produces:

```ts
export interface SettleGameSummary {
  gameId: string;
  legsGraded: number;
  betsSettled: number;
  centsPaid: bigint;
}

export function settleGame(gameId: string): Promise<SettleGameSummary>;
```

- [ ] **Step 1: Write the failing test**

- **Winning single** pays `stake + profit` via one `BET_WON` entry; balance matches; bet and leg
  both `WON`.
- **Losing single** writes **no ledger entry at all** — assert the entry count is unchanged — and
  sets the bet to `LOST`. The stake left at placement; paying nothing is the correct action, and
  an accidental `0n` entry would pollute the ledger.
- **Pushed single** refunds the stake exactly via `BET_PUSHED`.
- **Parlay with one pushed leg** pays the reduced parlay, and the amount is **less than**
  `potential_payout_cents`. Assert that inequality explicitly — it is the behavior most likely to
  be "fixed" into a bug later.
- **Parlay spanning two games** stays `PENDING` after the first game settles, with no entry
  written, then settles when the second finalizes.
- **Parlay that has already lost** (A-D8): after the losing game settles, the bet is `LOST` and
  the leg on the unfinished game is still `PENDING`. Settling the second game later changes that
  leg's status but writes no entry and does not touch the bet's status.
- **Idempotency:** call `settleGame` twice; the second call writes nothing and the ledger is
  byte-identical. This is spec success criterion 7.
- **Market status** becomes `SETTLED` for every market on the game.
- **Two members on one game:** both are paid correctly in a single call.

- [ ] **Step 2: Run it and confirm it fails**
- [ ] **Step 3: Implement `settleGame`**

```
BEGIN
  load the game FOR UPDATE; require status FINAL with both scores present
  load every PENDING bet_leg on this game's selections
  grade each with gradeLeg(marketType, side, lineToNumber(line_at_placement), result)
  update those legs
  collect affected bet ids where bets.status = 'PENDING'     -- A-D8 guard
  for each bet, ORDERED BY membership_id ASC:                -- A-D7 lock order
      load all its legs
      status = gradeParlay(legStatuses)
      if PENDING → next bet, no entry
      attempts = settlement_attempts + 1
      payout = settledPayoutCents(stake, legs)
      if status !== LOST and payout > 0:
          postEntry(tx, { amountCents: payout, type: WON|PUSHED|VOIDED,
                          idempotencyKey: `bet:${betId}:settled:${attempts}`, betId })
      update bets set status, settled_at, settlement_attempts = attempts
  update markets set status = 'SETTLED' where game_id = ?
COMMIT
```

The entry type follows the bet status: `WON` → `BET_WON`, `PUSHED` → `BET_PUSHED`, all-voided →
`BET_VOIDED`. `LOST` writes nothing.

**Grade from the frozen leg values, never from the live `selections` row.** The leg stores what was
offered; the selection stores what is offered now. Reading the wrong one is silent and only shows
up as wrong money.

- [ ] **Step 4: Run the test — expect PASS**
- [ ] **Step 5: Commit** — `feat: settle bets for a finished game`

---

### Task A6: Voids for postponed and canceled games

**Files:**
- Modify: `src/server/bets/settle.ts`
- Test: `src/server/bets/__tests__/settle-void.test.ts`

- [ ] **Step 1: Write the failing test**

- A `POSTPONED` game voids its pending legs; a single is refunded in full via `BET_VOIDED` and the
  bet is `VOIDED`.
- A `CANCELED` game behaves identically.
- A parlay with one voided leg **drops that leg and recalculates**, exactly like a push
  ([D12](../decisions.md)) — assert the payout equals the same parlay without that leg.
- A parlay where every leg voided refunds the stake and the bet is `PUSHED` (`gradeParlay` returns
  `PUSHED` for all-void, and Plan 1's tests already pin that).
- A postponed game whose status later becomes `SCHEDULED` again does **not** un-void anything.
  Voided is terminal; the member re-bets if they want to.

- [ ] **Step 2: Run it and confirm it fails**
- [ ] **Step 3: Implement**

Widen the candidate check: `FINAL` grades from scores, `POSTPONED` and `CANCELED` void every
pending leg without touching `gradeLeg`. Markets on a voided game become `SETTLED` too — nobody
should be able to bet a market whose game is gone.

- [ ] **Step 4: Run the test — expect PASS**
- [ ] **Step 5: Commit** — `feat: void pending legs on postponed and canceled games`

---

### Task A7: `settleFinalGames` — the batch runner

**Files:**
- Modify: `src/server/bets/settle.ts`
- Test: `src/server/bets/__tests__/settle-batch.test.ts`

**Interfaces:**

```ts
export interface SettleRunOptions {
  maxGames?: number;   // default 25
  budgetMs?: number;   // default 45_000
  now?: () => number;  // injectable clock, so tests don't sleep
}

export interface SettleRunSummary {
  gamesSettled: number;
  betsSettled: number;
  centsPaid: bigint;
  remaining: number;
  exhausted: 'none' | 'maxGames' | 'budget';
  errors: { gameId: string; message: string }[];
}

export function settleFinalGames(options?: SettleRunOptions): Promise<SettleRunSummary>;
```

- [ ] **Step 1: Write the failing test**

- Five settleable games with `maxGames: 2` settles two, reports `remaining: 3` and
  `exhausted: 'maxGames'`; a second run settles two more; a third finishes the set and reports
  `exhausted: 'none'`. **No checkpoint state exists between runs** (A-D6) — that is the property
  under test.
- An injected clock that jumps past the budget stops the run cleanly with `exhausted: 'budget'`,
  and the game that was never started is untouched.
- **A game that throws does not abort the run:** it lands in `errors`, its own transaction rolls
  back, and the remaining games still settle. A single malformed fixture must not stop everyone's
  payouts.
- Games are processed oldest kickoff first.
- Running the whole thing twice pays nobody twice.

- [ ] **Step 2: Run it and confirm it fails**
- [ ] **Step 3: Implement**

Candidate query: distinct games joined through `selections` → `markets` → `bet_legs` where
`bet_legs.status = 'PENDING'` and `games.status IN ('FINAL','POSTPONED','CANCELED')`, ordered by
`games.starts_at`, limited to `maxGames + 1` so `remaining` is knowable without a second count.

Loop with a `try`/`catch` per game. Check the budget **before** starting each game, never during.

- [ ] **Step 4: Run the test — expect PASS**
- [ ] **Step 5: Commit** — `feat: add resumable batched settlement runner`

---

### Task A8: `resettleBet`

**Files:**
- Create: `src/server/bets/resettle.ts`
- Test: `src/server/bets/__tests__/resettle.test.ts`

**Interfaces:**

```ts
export interface ResettleBetInput {
  betId: string;
  actorUserId: string;
  note: string;          // required — D15's audit trail
}

export type ResettleBetResult =
  | { ok: true; previousStatus: BetStatus; newStatus: BetStatus;
      reversedCents: bigint; paidCents: bigint; attempt: number }
  | { ok: false; error: { code: 'BET_NOT_FOUND' | 'BET_STILL_PENDING' | 'NOTE_REQUIRED' } };

export function resettleBet(input: ResettleBetInput): Promise<ResettleBetResult>;
```

This is the function B's admin screen calls. Confirm the signature with them before building.

- [ ] **Step 1: Write the failing test**

- A bet settled `WON` against a wrong score, re-settled after the score is corrected to a loss:
  one `SETTLEMENT_REVERSAL` of exactly the original payout, no new payout entry, bet becomes
  `LOST`, and the final balance equals what it would have been had the correct score been there
  from the start. **Assert that equality directly** — it is the whole point of the feature.
- A bet settled `LOST` and corrected to `WON`: no reversal entry (there was nothing to reverse),
  one `BET_WON`, correct balance.
- `settlement_attempts` increments, and the new entry's key is
  `bet:<id>:settled:2` — not colliding with `:1`. Assert both keys exist. A plain
  `bet:<id>:settled` key would be silently swallowed as a duplicate, which is exactly the bug the
  attempt counter exists to prevent.
- Re-settling twice with no score change is a **no-op in effect**: it writes a reversal and an
  identical corrected entry, netting zero. Assert the balance is unchanged. (It is not idempotent
  in the ledger — it appends rows — and that is correct under D15.)
- A `PENDING` bet returns `BET_STILL_PENDING`.
- An empty note returns `NOTE_REQUIRED` and writes nothing.
- The `actor_user_id` and note land on both the reversal and the corrected entry.

- [ ] **Step 2: Run it and confirm it fails**
- [ ] **Step 3: Implement**

```
BEGIN
  load bet FOR UPDATE; require status != PENDING
  netPaid = SUM(amount_cents) over this bet's entries WHERE type != 'BET_PLACED'
  attempt = settlement_attempts + 1
  if netPaid != 0:
      postEntry(tx, { amountCents: -netPaid, type: 'SETTLEMENT_REVERSAL',
                      idempotencyKey: `bet:${betId}:reversal:${attempt}`,
                      actorUserId, note, betId })
  re-grade every leg from current game scores; update leg statuses
  status = gradeParlay(...); payout = settledPayoutCents(...)
  if payout > 0: postEntry(tx, { amountCents: payout, type: …,
                                 idempotencyKey: `bet:${betId}:settled:${attempt}`,
                                 actorUserId, note, betId })
  update bets set status, settlement_attempts = attempt, settled_at = now()
COMMIT
```

`BET_PLACED` is never reversed (A-D10). The stake genuinely left the balance at placement, and the
corrected settlement entry already accounts for it.

- [ ] **Step 4: Run the test — expect PASS**
- [ ] **Step 5: Run all of Track A** — `npm test -- src/domain/ src/server/bets/`
- [ ] **Step 6: Commit** — `feat: add admin-triggered bet re-settlement`

---

## Definition of done for your half of Plan 2

- [ ] `npm test -- src/domain/ src/server/bets/` passes with the database running
- [ ] `npm run typecheck` passes
- [ ] Every one of the six placement rules has a rejecting test and a passing-boundary test
- [ ] The concurrency test proves two devices cannot spend one balance
- [ ] Every job-style function has a run-it-twice test asserting an unchanged ledger
- [ ] A losing bet is proven to write zero ledger entries
- [ ] No file outside `src/domain/**` and `src/server/bets/**` has your name on it
- [ ] `placeBet`, `settleGame`, `settleFinalGames`, and `resettleBet` signatures are agreed with B

## Rejoin with B

Once B's `syncOdds` and fixtures land, write one end-to-end test together: sync the fixture slate,
place a spread of bets across it, advance the fixture scores to final, run `settleFinalGames`, and
assert every balance and `SUM(ledger) = balance_cents` for every membership. That test belongs to
neither of you alone — write it side by side, and put it wherever you both agree.

## Open items to raise with B before you start

1. `bets.client_request_id` unique column (A-D5) — schema, so it must be in the pair phase.
2. `resettleBet` living in `src/server/bets/` while the admin *screen* is theirs (A-D9).
3. The `bet_legs (status) WHERE status = 'PENDING'` index — settlement's hot path.
4. Whether `postEntry` accepts `betId`; the spec has the column, confirm the parameter exists.
5. Your fixture requirements list, handed over before they build the slate.
