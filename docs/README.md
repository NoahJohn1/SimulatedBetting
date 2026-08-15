# SimulatedBetting — documentation

A play-money sportsbook for a small private group. NFL and college football, real
sportsbook lines, simulated currency. No real money is involved at any point.

## Documents

| Document | What's in it |
|---|---|
| [Core betting engine spec](specs/2026-08-14-core-betting-engine-design.md) | The v1 build: architecture, data model, odds math, grading rules, jobs, failure handling, screens, testing |
| [Implementation plans](plans/README.md) | The three build plans, and how two people split the work |
| [Worker A brief](plans/worker-a-brief.md) | Betting logic: odds math, grading, placement, settlement, betting screens |
| [Worker B brief](plans/worker-b-brief.md) | Data & money: database, ledger, seasons, admin, odds ingestion, account screens |
| [Roadmap](roadmap.md) | The four subsystems, what each adds, and build order |
| [Decision log](decisions.md) | Every design decision, what was rejected, and why |

## The short version

Members sign in with Google or Apple, an admin approves them, and they join a season with
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

The core betting engine spec is approved and [Plan 1](plans/2026-08-15-01-foundation-and-money-core.md)
is written and ready to build. Nothing is implemented yet.

## Conventions

- Design documents live in `specs/`, dated and named by topic.
- Decisions get an entry in `decisions.md`. When one turns out to be wrong, add a new entry
  rather than editing the old one.
- Roadmap items graduate into their own spec when their turn comes.
