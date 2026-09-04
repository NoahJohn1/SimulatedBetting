# SimulatedBetting

r
A play-money sportsbook for a small private group — NFL and college football, real
sportsbook lines, simulated currency. No real money is involved at any point.

Design documentation lives in [`docs/`](docs/README.md). Start there for the full picture —
this file covers what the app does and how to run it locally.

All four subsystems are built end-to-end and verified: `npm run verify` passes clean (76 test
files / 814 tests, 0 lint errors), and `npm run build` compiles every route. See
[where things stand](docs/README.md#where-things-stand) for the detailed rundown.

The odds board is still fixture data and nothing is deployed yet. The work between here and a
production deployment — a real data source, hosting, UI polish, notifications, and hardening —
is [part two of the roadmap](docs/roadmap.md#part-two--production-readiness).

## What it does

**1. Core betting engine.** Members sign in with Google, an admin approves them, and they
join a season with an equal starting bankroll plus a weekly allowance. They bet singles and
parlays (moneyline, spread, total) against real sportsbook lines on NFL and CFB games, priced
from a fixture provider. Odds and results sync on a schedule; finished games settle
automatically, with corrections handled by reversing ledger entries rather than editing
history. A season-long leaderboard ranks everyone by balance.

**2. Social layer.** A season-scoped activity feed shows bets placed and settled, members
joining, the weekly allowance, admin adjustments, lead changes, big wins, and parlay hits.
Members react and comment on feed cards, and each has a profile with season record, ROI, net,
and streak.

**3. Custom events.** Any approved member can create a betting market for something no
sportsbook covers, price it themselves, and resolve it once the outcome is known. Custom
events are staked in **credits** — a second, non-convertible currency — so a market priced and
judged by a person can never touch the cash bankroll the standings are built on. Disputed
resolutions go to an admin, who can re-resolve or void.

**4. Peer-to-peer bets.** Two members can bet each other directly — one offers terms (a stake
on each side, against a real game or a freeform claim), the other accepts, and both stakes are
escrowed in credits until there's a winner. Wagers on a real game settle automatically from
the same grading the engine already runs; freeform wagers settle when both parties agree on
who won, with admin arbitration when they don't or when one side goes silent. Every pair of
members has a derived head-to-head record.

Three properties the whole design is organized around — see
[docs/README.md](docs/README.md#the-short-version) for the full explanation:

1. Every simulated dollar (and credit) is accounted for, via an append-only ledger that
   balances are cached against and reconciled daily.
2. Bets and wagers freeze their price/line at the moment they're placed.
3. Every background job is idempotent — running one twice moves no extra money.

## Local development

Requires Node 22+ and Docker.

```bash
npm install

# .env.local holds your real config; .env.example documents every variable.
cp .env.example .env.local
```

Fill in `.env.local`:

- `AUTH_SECRET` — any random string (`openssl rand -base64 32`).
- `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` — a Google OAuth client (sign-in is Google-only,
  with no dev bypass — see [D20](docs/decisions.md#d20--auth-google-only-apple-dropped)). Add
  `http://localhost:3000/api/auth/callback/google` as an authorized redirect URI in the Google
  Cloud console. Without real credentials you can still run everything below except signing
  into the running app in a browser.
- `ADMIN_EMAILS` — comma-separated addresses that land pre-approved. This is how the first
  admin gets in, since nobody exists yet to approve them.
- `CRON_SECRET` — any random string; the cron routes require it as a bearer token.
- `ALERT_WEBHOOK_URL` — a Discord or Slack incoming-webhook URL for cron-failure and
  reconciliation-drift alerts. Unset, alerts are logged and not sent, which is the expected
  state in CI and locally.
- `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` — Sentry project DSNs. Unset, `Sentry.init` is never
  called and nothing reports.
- `SENTRY_AUTH_TOKEN` — only for source-map upload at build time. Without it the build warns
  and succeeds.

Then:

```bash
npm run db:up            # starts Postgres in Docker on localhost:5433
npm run db:test:create   # creates the test database

npm run db:migrate       # apply migrations to the dev database
npm run db:migrate:test  # apply migrations to the test database

npm run db:seed          # fixture odds slate + an active season to join
                          # WITH_RESULTS=1 npm run db:seed also finalizes results

npm run dev              # http://localhost:3000
```

To get past `/sign-in` without configuring real Google OAuth credentials, or to make yourself
an admin once you have signed in:

```bash
npm run admin:promote -- you@example.com
```

Safe to run before your first sign-in too — it records the intent so the row is promoted the
moment your account exists.

### Testing

The suite reads its connection string from `.env.test`, which is gitignored and therefore
missing from a fresh checkout. `src/test/setup.ts` loads it with `override: true`, so it wins
over `.env.local` and the tests cannot accidentally run against your development database.
Create it once:

```bash
echo 'DATABASE_URL=postgres://simbet:simbet@localhost:5433/simbet_test' > .env.test
```

The `SessionStart` hook in `.claude/hooks/session-start.sh` writes this file for you if it is
missing, so a Claude Code session handles it automatically.

```bash
npm run verify      # typecheck + lint + full test suite — the same gate CI runs
npm test             # vitest run — the test suite alone
npm run test:watch   # vitest in watch mode
npx vitest run src/server/p2p/__tests__/offer.test.ts   # a single test file
npm run typecheck    # tsc --noEmit (plus generated route types)
npm run lint         # eslint
npm run build        # production build — also the fastest way to catch a broken route
```

Tests run against the `simbet_test` database created by `db:test:create` above and truncate
it between runs, so they're safe to run repeatedly against your local Postgres.

### Other useful scripts

```bash
npm run db:down    # stop Postgres
npm run db:reset   # wipe the Docker volume, restart Postgres, recreate the test database
npm run db:generate  # generate a new Drizzle migration after a schema change
```

## Conventions

- Design documents live in [`docs/specs/`](docs/specs/), dated and named by topic, with an
  implementation plan alongside each one in [`docs/plans/`](docs/plans/).
- Decisions get an entry in [`docs/decisions.md`](docs/decisions.md). When one turns out to be
  wrong, add a new entry rather than editing the old one.
- See [`docs/roadmap.md`](docs/roadmap.md) for what each subsystem added and why it was built
  in that order.
