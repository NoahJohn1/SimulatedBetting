# SimulatedBetting

A play-money sportsbook for a small private group — NFL and college football, real
sportsbook lines, simulated currency. No real money is involved at any point.

Design documentation lives in [`docs/`](docs/README.md). Start with the
[core betting engine spec](docs/specs/2026-08-14-core-betting-engine-design.md).

Plan 1 — the headless money core — is complete: Postgres schema, the append-only
ledger, seasons, weekly allowance, admin adjustments, reconciliation, and the pure
betting math (money formatting, odds arithmetic, leg and parlay grading). There is
no odds feed and no UI yet; those are
[Plans 2 and 3](docs/plans/README.md).

## Local development

Requires Node 22+ and Docker.

```bash
npm install
npm run db:up          # starts Postgres on localhost:5433
npm run db:test:create # creates the test database
npm run db:migrate && npm run db:migrate:test
npm run verify         # typecheck, lint, test
npm run dev            # http://localhost:3000
```
