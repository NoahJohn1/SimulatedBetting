# SimulatedBetting

A play-money sportsbook for a small private group — NFL and college football, real
sportsbook lines, simulated currency. No real money is involved at any point.

Design documentation lives in [`docs/`](docs/README.md). Start with the
[core betting engine spec](docs/specs/2026-08-14-core-betting-engine-design.md).

Subsystem 1 (the core betting engine) is built: Postgres schema, the append-only
ledger, seasons, weekly allowance, admin adjustments, reconciliation, fixture-backed
odds sync and settlement, Google sign-in with admin approval, and the four member
screens (Games, My Bets, Standings, Me) plus the admin area. See
[where things stand](docs/README.md#where-things-stand) for what's covered and what
isn't. Subsystems 2–4 (social layer, custom events, peer-to-peer bets) are
[roadmap only](docs/roadmap.md).

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
