# Worker A — Betting logic

**Your half of the project:** everything that decides what a bet is worth and whether it won.
Odds arithmetic, grading, bet placement, settlement, and the screens people place bets on.

Worker B owns the database, the money ledger, and odds ingestion. Their brief is
[worker-b-brief.md](worker-b-brief.md). Read it once so you know where the boundary is; you
never need to read it again.

---

## What you own

| Plan | Directories you may write |
|---|---|
| 1 | `src/domain/**` |
| 2 | `src/domain/**`, `src/server/bets/**` |
| 3 | `src/domain/**`, `src/server/bets/**`, `src/app/(app)/games/**`, `src/app/(app)/bets/**`, `src/components/bet-slip/**`, `src/app/api/cron/settle/**` |

## What you must never write

`src/db/**` · `src/server/money/**` · `src/server/seasons/**` · `src/server/admin/**` ·
`src/server/odds/**` · `src/fixtures/**` · `src/test/**` · `drizzle/**` ·
`src/app/(app)/standings/**` · `src/app/(app)/me/**` · `src/app/admin/**`

In Plan 1, Worker B owns *all* of `src/server/`. From Plan 2 onward it splits by
subdirectory, as above — you get `src/server/bets/`, they keep the rest.

If a task seems to require touching one of B's files, **stop and raise it**. That is a design
problem, not a coding problem, and editing their file is how two people end up with a repo
neither of them understands.

---

## The contract between you and B

**What you consume from B** (already built and merged before you need it):

```ts
// from '@/server/money/ledger' — the only function that may change a balance
postEntry(tx: Tx, input: {
  membershipId: string;
  amountCents: bigint;
  type: LedgerEntryType;
  idempotencyKey: string;
  actorUserId?: string;
  note?: string;
}): Promise<{ applied: boolean; balanceCents: bigint }>

// from '@/db/client'
db, type Tx

// from '@/db/schema' — tables and enums, agreed jointly in each pair phase
```

**What you produce for B** (they read these; don't rename without telling them):

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
formatCents(cents: bigint): string
```

`formatCents` in particular gets used all over B's screens. Changing its output format breaks
their UI.

---

## Plan 1 — already fully specified, nothing to flesh out

**Your tasks: 10, 11, 12, 13** in
[the plan](2026-08-15-01-foundation-and-money-core.md). Every test and every implementation is
written out. Follow it as-is.

Tasks 10, 11, and 12 are independent — do them in any order. Task 13 needs 11 and 12.

You need **no database and no Docker** for any of it. Your entire track is pure functions.

**Before you start:** Tasks 1–2 (scaffold and Docker) are done jointly with B. Don't start
until those are merged.

**Verify with** `npm test -- src/domain/` — never `npm run verify`, which runs B's database
tests and will fail until their work merges. That failure is not yours.

**Branch naming:** `a/task-11-odds`.

---

## Plan 2 — Odds & betting engine

> **Task detail is now written:**
> [2026-08-15-02a-betting-engine-worker-a.md](2026-08-15-02a-betting-engine-worker-a.md).
> It answers the five open questions below and turns them into Tasks A1–A8. The section here
> stays as the statement of scope those tasks were derived from.

**Pair phase first.** You and B agree the sports and betting schema together before either of
you starts: `teams`, `games`, `markets`, `selections`, `odds_snapshots`, `bets`, `bet_legs`,
and adding `bet_id` to `ledger_entries`. Both of your halves build directly on these tables,
so this is not a phase to skip. One sitting.

**Then your half: the bet lifecycle.** Files: `src/server/bets/**`.

**`placeBet`** — implements every validation rule in
[the spec](../specs/2026-08-14-core-betting-engine-design.md#bet-placement):
user approved and a member of the active season · every leg's game `SCHEDULED` with kickoff in
the future · every market `OPEN` · stake ≥ $1 and ≤ balance · **submitted line and price still
match stored values** · parlays 2–10 legs with no two legs from the same game. Then one
transaction: lock the membership row, re-validate, insert `bets` and `bet_legs`, call B's
`postEntry` with `BET_PLACED`.

**`settleGame`** — find `FINAL` games with pending legs, grade each leg with your `gradeLeg`,
grade each bet with your `gradeParlay`, compute the payout with your `settledPayoutCents`, and
write the payout entry through `postEntry`. Idempotency key
`bet:<bet_id>:settled:<settlement_attempt>`. Losing bets write **no** entry — the money left at
placement.

### What you need to work out before writing your tasks

1. **Error reporting for a rejected placement.** Six validation rules, and the UI has to react
   differently to each. A stale line needs "accept the new price?", insufficient funds needs
   something else entirely. Decide the error codes and the response shape now, because your
   Plan 3 bet slip consumes them.
2. **The placement request payload.** What exactly the client sends per leg — selection id,
   plus the line and price it displayed. That's what makes rule 5 checkable.
3. **Settlement batching.** Vercel cron caps an invocation at roughly 60 seconds and a Saturday
   CFB slate is large. Decide the batch size and how a partially-finished run resumes.
4. **The re-settlement path.** `SETTLEMENT_REVERSAL` entries then corrected ones, per
   [D15](../decisions.md). Work out whether this is an admin-triggered function or automatic on
   a score correction.
5. **Test fixtures you need from B.** Their fixture slate must include a push, a postponement,
   and a line movement — tell them what your settlement tests need before they build it.

---

## Plan 3 — the betting screens

> **Task detail is now written:**
> [2026-08-15-03a-web-app-worker-a.md](2026-08-15-03a-web-app-worker-a.md).
> It answers the three open questions below and turns them into Tasks A9–A16.

**Pair phase first:** auth, the app shell, the bottom tab bar, session and authorization
helpers, and the shared UI primitives. Two people independently inventing a button component is
exactly the conflict the split exists to prevent.

**Then your screens:** Games board · Game detail · Bet slip · My Bets. Plus the `settle` cron
route, since you wrote settlement.

Wireframes for all four are in
[the spec](../specs/2026-08-14-core-betting-engine-design.md#screens). The bet slip is the
hardest: one sheet that is a single bet with one leg and reveals a Singles/Parlay toggle at two.

### What you need to work out

1. **Bet slip state.** Where legs live while the slip is open, and whether the slip survives
   navigating between games.
2. **What happens when a line moves while the slip is open.** The API will reject the bet — the
   spec is firm on that. The open question is whether the slip notices beforehand or only when
   the placement fails.
3. **Odds board performance.** A Saturday CFB slate is 60+ games with three markets each.
   Decide how much renders at once.

---

## Rules

1. Never edit a file you don't own, and never edit B's tests.
2. One branch per task, merged to `main` as it passes. Small PRs get reviewed; large ones sit.
3. Your published function signatures are a contract. Tell B before changing one.
4. Run only your own tests while working.
5. Review B's PRs even when the area is unfamiliar. "Why does this take a lock here?" is a good
   review, and it stops either of you becoming the only person who understands half the system.

## Where the answers live

- [Core betting engine spec](../specs/2026-08-14-core-betting-engine-design.md) — grading rules, payout math, placement validation
- [Decision log](../decisions.md) — why things are the way they are
- [Plan 1](2026-08-15-01-foundation-and-money-core.md) — your Tasks 10–13, fully written
- [Plan 2, Track A](2026-08-15-02a-betting-engine-worker-a.md) — your Tasks A1–A8: placement, settlement, re-settlement
- [Plan 3, Track A](2026-08-15-03a-web-app-worker-a.md) — your Tasks A9–A16: the four betting screens
