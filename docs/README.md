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

Subsystem 1 (the core betting engine) is built end-to-end and verified: `npm run verify`
(typecheck, lint, 26 test files / 222 tests) passes clean, and the app runs, seeds a
fixture slate, takes a bet through placement and settlement (including a push), and
reconciles the ledger correctly. Covered:

- Postgres schema (Drizzle), the append-only ledger, seasons, weekly allowance, admin
  balance adjustments, and daily reconciliation
- Odds math and grading (moneyline/spread/total, singles and parlays) as pure functions
- Fixture-backed odds sync and result sync, with market suspension on stale data
- Bet placement (with line/price re-validation at commit) and idempotent settlement,
  including resumable batching and admin-triggered re-settlement
- Google sign-in with admin-approval gating, seeded admins via `ADMIN_EMAILS`
- All four member screens (Games, My Bets, Standings, Me) and the admin area
- The four cron routes: `sync-odds`, `settle`, `allowance`, `reconcile`

Not built: a real odds provider adapter (still fixture-only — see [D2](decisions.md)) and
production deployment/hosted Postgres wiring. Subsystems 2–4 (social layer, custom events,
peer-to-peer bets) are [roadmap only](roadmap.md).

## Conventions

- Design documents live in `specs/`, dated and named by topic.
- Decisions get an entry in `decisions.md`. When one turns out to be wrong, add a new entry
  rather than editing the old one.
- Roadmap items graduate into their own spec when their turn comes.
