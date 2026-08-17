# SimulatedBetting — documentation

A play-money sportsbook for a small private group. NFL and college football, real
sportsbook lines, simulated currency. No real money is involved at any point.

## Documents

| Document | What's in it |
|---|---|
| [Core betting engine spec](specs/2026-08-14-core-betting-engine-design.md) | The v1 build: architecture, data model, odds math, grading rules, jobs, failure handling, screens, testing |
| [Social layer spec](specs/2026-08-17-social-layer-design.md) | Subsystem 2: the season activity feed, reactions and comments, member profiles, per-viewer feed filters |
| [Social layer plan](plans/2026-08-17-social-layer-implementation-plan.md) | The task-by-task implementation plan for subsystem 2 |
| [Roadmap](roadmap.md) | The four subsystems, what each adds, and build order |
| [Decision log](decisions.md) | Every design decision, what was rejected, and why |

## The short version

Members sign in with Google, an admin approves them, and they join a season with
an equal starting bankroll plus a weekly allowance. They bet singles and parlays against
real sportsbook lines on NFL and CFB games. Finished games settle automatically. A
season-long leaderboard ranks everyone by balance.

Three properties the design is organized around:

1. **Every simulated dollar is accounted for.** An append-only ledger is the source of
   truth for all money. Balances are a cache reconciled against it daily. Corrections write
   reversing entries — history is never edited.
2. **Bets freeze their odds at placement.** Line movement afterward cannot change a placed
   bet.
3. **Running any background job twice moves no extra money.** Every ledger write carries a
   deterministic idempotency key.

## Where things stand

Subsystems 1 and 2 are built end-to-end and verified: `npm run verify` (typecheck, lint, 40
test files / 305 tests) passes clean, and the app runs, seeds a fixture slate, takes a bet
through placement and settlement (including a push), reconciles the ledger correctly, and
posts and reads back the feed cards those actions generate.

**Subsystem 1 — core betting engine:**

- Postgres schema (Drizzle), the append-only ledger, seasons, weekly allowance, admin
  balance adjustments, and daily reconciliation
- Odds math and grading (moneyline/spread/total, singles and parlays) as pure functions
- Fixture-backed odds sync and result sync, with market suspension on stale data
- Bet placement (with line/price re-validation at commit) and idempotent settlement,
  including resumable batching and admin-triggered re-settlement
- Google sign-in with admin-approval gating, seeded admins via `ADMIN_EMAILS`
- The four cron routes: `sync-odds`, `settle`, `allowance`, `reconcile`

**Subsystem 2 — social layer:**

- `feed_events`, an append-only, dedupe-keyed table mirroring the ledger's idempotency
  pattern, emitted inline from `placeBet`, `settleGame`, `resettleBet`, `joinSeason`,
  `payWeeklyAllowance`, and `adjustBalance`
- Eight event types: bets placed and settled, members joining, the weekly allowance
  (aggregated to one card, not one per member), admin adjustments (now season-visible — see
  [D24](decisions.md#d24--admin-adjustments-are-published-to-the-season-feed)), lead changes,
  big wins (10×+), and parlay hits (4+ surviving legs)
- Lead-change detection riding along in the `settle` cron route and after admin adjustments,
  with no new schedule and no cursor to get stuck
- A keyset-paginated feed read, reactions (six fixed emoji, toggle on/off), and comments
  (flat, author or admin soft-delete)
- Member profiles with season record, ROI, net, streak, and biggest win, computed by a pure
  `computeMemberStats` function
- Per-member feed filters, applied at read time so nothing muted is ever deleted
- Five member screens (Games, Feed, My Bets, Standings, Me) plus event detail and member
  profile pages

See [D30](decisions.md#d30--correlated-subqueries-in-drizzle-need-literal-qualified-identifiers)
for a real correlated-subquery bug the profile stats query's own test caught mid-build.

Not built: a real odds provider adapter (still fixture-only — see [D2](decisions.md)) and
production deployment/hosted Postgres wiring. Subsystems 3–4 (custom events, peer-to-peer
bets) are [roadmap only](roadmap.md).

## Conventions

- Design documents live in `specs/`, dated and named by topic.
- Decisions get an entry in `decisions.md`. When one turns out to be wrong, add a new entry
  rather than editing the old one.
- Roadmap items graduate into their own spec when their turn comes.
