# Worker B — Data & money

**Your half of the project:** the database and every dollar that moves through it. Schema,
migrations, the append-only ledger, seasons and allowances, admin controls, odds ingestion, and
the account screens.

Worker A owns the betting math, bet placement, settlement, and the betting screens. Their brief
is [worker-a-brief.md](worker-a-brief.md). Read it once so you know where the boundary is.

You own the part of this system that must never be wrong. A UI bug is annoying; a ledger bug
silently invents or destroys money and nobody notices for a week.

---

## What you own

| Plan | Directories you may write |
|---|---|
| 1 | `src/db/**`, `src/server/**`, `src/test/**`, `drizzle/**` |
| 2 | `src/db/**`, `src/server/money/**`, `src/server/seasons/**`, `src/server/admin/**`, `src/server/odds/**`, `src/fixtures/**`, `src/test/**`, `drizzle/**` |
| 3 | all of the above, plus `src/app/(app)/standings/**`, `src/app/(app)/me/**`, `src/app/admin/**`, `src/app/api/cron/{sync-odds,allowance,reconcile}/**` |

In Plan 1 you own *all* of `src/server/` because A has nothing there yet. From Plan 2 onward
A takes `src/server/bets/` and you keep everything else under `src/server/`.

## What you must never write

`src/domain/**` · `src/server/bets/**` · `src/app/(app)/games/**` · `src/app/(app)/bets/**` ·
`src/components/bet-slip/**` · `src/app/api/cron/settle/**`

If a task seems to require touching one of A's files, **stop and raise it**.

---

## The contract between you and A

**What you consume from A:**

```ts
// from '@/domain/odds'
americanToRational(price: number): Rational
combine(rationals: Rational[]): Rational
payoutCents(stakeCents: bigint, r: Rational): bigint
rationalToAmerican(r: Rational): number

// from '@/domain/grading'
gradeLeg(input: GradeLegInput): 'WON' | 'LOST' | 'PUSHED'
gradeParlay(statuses: LegStatus[]): LegStatus
settledPayoutCents(stakeCents: bigint, legs: SettledLeg[]): bigint

// from '@/domain/money'
dollarsToCents(input: string | number): bigint
formatCents(cents: bigint): string   // you'll use this on every screen you build
```

**What you produce for A** (they build directly on these; don't rename without telling them):

```ts
// from '@/db/client'
db, pgClient, type Tx

// from '@/server/money/ledger' — the only function permitted to change a balance
postEntry(tx: Tx, input: PostEntryInput): Promise<PostEntryResult>

// from '@/db/schema' — every table and enum
```

A's `placeBet` and `settleGame` both call your `postEntry`. Its signature is the single most
depended-on interface in the codebase.

---

## Plan 1 — already fully specified, nothing to flesh out

**Your tasks: 3, 4, 5, 6, 7, 8, 9** in
[the plan](2026-08-15-01-foundation-and-money-core.md). Every test and every implementation is
written out. Follow it as-is.

**Do them in order.** Unlike A's track, yours is sequential: 3→4→5→6→7, with 8 and 9 after 5
and 6.

**Task 5 is the hardest work in the entire project.** The `SELECT … FOR UPDATE` row lock and
the `onConflictDoNothing` idempotency path are what make it impossible to double-spend a
balance or pay a bet twice. The concurrency test at the end of that task is not optional
polish — it is the test that proves the system is sound. Don't rush it.

**Before you start:** Tasks 1–2 (scaffold and Docker) are done jointly with A. Don't start
until those are merged.

**Verify with** `npm test -- src/db/ src/server/` — never `npm run verify`, which runs A's
domain tests and will fail until their work merges. That failure is not yours.

**Branch naming:** `b/task-5-ledger`.

---

## Plan 2 — Odds ingestion

**Pair phase first.** You and A agree the sports and betting schema together: `teams`, `games`,
`markets`, `selections`, `odds_snapshots`, `bets`, `bet_legs`, and adding `bet_id` to
`ledger_entries`. You'll write the migration, but the shape is agreed jointly — A's placement
and settlement code reads these tables constantly. One sitting.

**Then your half: getting odds into the database.** Files: `src/server/odds/**`,
`src/fixtures/**`.

- The `OddsProvider` and `ScoreProvider` interfaces
  ([defined in the spec](../specs/2026-08-14-core-betting-engine-design.md#provider-interfaces))
- `FixtureOddsProvider` and `FixtureScoreProvider`, plus the fixture data itself
- The `syncOdds` job — upsert games, markets, and selections; append an `odds_snapshots` row
  whenever a line or price changed
- Market suspension when data goes stale past 30 minutes

### What you need to work out before writing your tasks

1. **The fixture slate.** This is more important than it sounds — it's the test data the entire
   project is verified against. It needs a realistic NFL and CFB slate and must include **a
   push, a postponement, and a line movement**, because A's settlement tests depend on all
   three. Ask A what else their tests need before you build it.
2. **Upsert strategy.** How you detect that a line actually changed (and therefore needs a
   snapshot) versus a sync that returned identical data. Snapshotting unchanged lines every 15
   minutes would bloat the table fast.
3. **The house-line rule in practice.** [D9](../decisions.md) says one designated book per
   market. Decide what happens when that book doesn't price a game the others do.
4. **The Odds API adapter shape.** You don't build it in Plan 2, but design the interface so it
   fits — check the real response format now rather than discovering a mismatch later.
5. **Staleness mechanics.** Whether suspension is a column write during sync or computed at
   read time from `last_synced_at`.

---

## Plan 3 — the account screens

**Pair phase first:** auth, the app shell, the bottom tab bar, session and authorization
helpers, and the shared UI primitives.

**Then your screens:** Standings · Me (the ledger view) · the entire Admin area. Plus the
`sync-odds`, `allowance`, and `reconcile` cron routes, since you wrote those jobs.

You built the ledger, so you build the view onto it. The **Me** tab is the user-facing
transaction history — every entry visible to its owner, including admin adjustments and their
notes ([D16](../decisions.md)).

### What you need to work out

1. **Ledger pagination.** A season's history gets long. Decide cursor or offset, and what the
   default page shows.
2. **Admin authorization.** Every admin route checked server-side, not by hiding UI. Decide
   where that check lives so it can't be forgotten on a new route.
3. **Cron route authentication.** These endpoints move money. They need a shared secret or
   Vercel's cron header — work out which, and how it's verified.
4. **Hosted Postgres.** Neon or Supabase, connection pooling for serverless, and how migrations
   run against production. This one needs an account, so it's a conversation with Conner, not a
   decision you make alone.

---

## Rules

1. Never edit a file you don't own, and never edit A's tests.
2. One branch per task, merged to `main` as it passes. Small PRs get reviewed; large ones sit.
3. Your published signatures are a contract — especially `postEntry`. Tell A before changing one.
4. Run only your own tests while working.
5. Review A's PRs even when the area is unfamiliar.
6. **Nothing changes a balance except `postEntry`.** If you ever find yourself writing an
   `UPDATE season_memberships SET balance_cents`, something has gone wrong.

## Where the answers live

- [Core betting engine spec](../specs/2026-08-14-core-betting-engine-design.md) — data model, jobs, failure handling, balance integrity
- [Decision log](../decisions.md) — why things are the way they are
- [Plan 1](2026-08-15-01-foundation-and-money-core.md) — your Tasks 3–9, fully written
