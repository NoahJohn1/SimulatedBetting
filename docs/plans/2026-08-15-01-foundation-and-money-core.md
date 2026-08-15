# Foundation & Money Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fully tested, headless money core — Postgres schema, an append-only ledger with idempotent writes, season lifecycle, and the pure betting math — with no odds feed and no UI.

**Architecture:** A single Next.js application. Business logic lives in two layers: a pure `src/domain/` layer with no I/O (odds arithmetic and grading), and a `src/server/` layer that owns transactions against Postgres via Drizzle. Postgres runs locally in Docker. Every money movement is an append-only `ledger_entries` row carrying a unique idempotency key; `season_memberships.balance_cents` is a cache updated in the same transaction.

**Tech Stack:** Next.js (App Router) · TypeScript · Drizzle ORM · postgres.js · Postgres 16 (Docker) · Vitest

## Global Constraints

- Node.js 22 or newer (this machine runs v23.10.0). npm is the package manager — pnpm is not installed.
- All monetary values are **integer cents** as JavaScript `bigint`, stored as Postgres `BIGINT`. No `number`, and no floating point, may represent money anywhere.
- All timestamps are `TIMESTAMPTZ`. Week boundaries use the `America/New_York` timezone.
- Rounding happens exactly once, on a final payout, using **half-up**. Never round per parlay leg.
- Every function that writes to `ledger_entries` must accept an idempotency key and be safe to call twice.
- `src/domain/**` must not import from `src/db/**` or `src/server/**`. The domain layer performs no I/O.
- Tests use TDD: failing test first, verify it fails, minimal implementation, verify it passes, commit.
- Commit after every task. Never commit a failing test suite.

## Ownership — read this before starting

This plan is built for **two workers running at the same time**, whether people or AI agents.

- **Worker A — betting logic.** Owns `src/domain/**`. See [worker-a-brief.md](worker-a-brief.md).
- **Worker B — data & money.** Owns `src/db/**` and `src/server/**`. See [worker-b-brief.md](worker-b-brief.md).

Every task below carries an **Owner** line. Do only the tasks assigned to you.

| Task | Owner | Depends on |
|---|---|---|
| 1. Project scaffold | **Both** (pair) | — |
| 2. Local Postgres in Docker | **Both** (pair) | 1 |
| 3. Drizzle client and identity schema | **B** | 2 |
| 4. Ledger schema | **B** | 3 |
| 5. The ledger write path | **B** | 4 |
| 6. Season creation and joining | **B** | 5 |
| 7. Weekly allowance | **B** | 6 |
| 8. Admin adjustments | **B** | 5 |
| 9. Reconciliation | **B** | 6 |
| 10. Money formatting | **A** | 1 |
| 11. Odds arithmetic | **A** | 1 |
| 12. Leg grading | **A** | 1 |
| 13. Parlay grading and settled payout | **A** | 11, 12 |
| 14. Continuous integration | **Both**, after A and B have merged | 9, 13 |

Task numbers are not in worker order — B's tasks (3–9) are numbered before A's (10–13) simply
because the database work was written first. The two sets are independent; neither waits on the
other.

### File ownership

| Path | Who may write it |
|---|---|
| `src/db/**` | B only |
| `src/server/**` | B only |
| `src/test/**` | B only |
| `drizzle/**` | B only |
| `src/domain/**` | A only |
| `package.json`, `vitest.config.ts`, `tsconfig.json`, `.env*`, `docker-compose.yml` | Pair phase (Tasks 1–2), plus B's dependency install in Task 3 |
| `.github/**`, `README.md` | Task 14 only |

`src/domain/money.ts` is created in Task 1 with a single constant and then owned entirely by A.

### Rules that keep the two workers out of each other's way

1. **Never edit a file you don't own.** If your task seems to require it, stop and raise it
   instead of editing. That situation is a design problem, not a coding problem.
2. **Never edit the other worker's tests**, including to make your build pass.
3. **The `Interfaces` block is the contract.** It states exactly what each task consumes and
   produces. Changing a published signature requires telling the other worker first.
4. **One branch per task**, named `b/task-5-ledger` or `a/task-11-odds`. Merge to `main` as
   each task passes. Do not batch several tasks into one branch.
5. **Run only your own tests while working**: `npm test -- src/domain/` for A,
   `npm test -- src/db/ src/server/` for B. The full suite is expected to fail for A until B's
   work merges, and vice versa — that is not a bug and not something to fix.
6. **B's tasks are strictly sequential** (3→4→5→6→7, with 8 and 9 after 5 and 6).
   **A's tasks 10, 11, and 12 are independent** and may be done in any order; 13 needs 11 and 12.

### Handing this to two AI agents

Give each agent its own brief — [worker-a-brief.md](worker-a-brief.md) or
[worker-b-brief.md](worker-b-brief.md) — plus this plan file, and one of these instructions:

> **Worker A:** You own Track A in `docs/plans/2026-08-15-01-foundation-and-money-core.md`.
> Tasks 1 and 2 have already been completed jointly — verify they are done, then implement
> Tasks 10 through 13 exactly as written. You may only create or modify files under
> `src/domain/`. Never touch `src/db/`, `src/server/`, or `src/test/` — another worker owns
> them, and their files may be missing or incomplete while you work. Your code must not import
> anything from those directories. Verify with `npm test -- src/domain/`, not the full suite.
> Commit after each task using the commit message given in that task's final step. Stop and
> report if any task requires a file outside your ownership.

> **Worker B:** You own Track B in `docs/plans/2026-08-15-01-foundation-and-money-core.md`.
> Tasks 1 and 2 have already been completed jointly — verify they are done, then implement
> Tasks 3 through 9 in order, exactly as written. You may only create or modify files under
> `src/db/`, `src/server/`, `src/test/`, and `drizzle/`. Never touch `src/domain/` — another
> worker owns it, and their files may be missing or incomplete while you work. Verify with
> `npm test -- src/db/ src/server/`, not the full suite. Commit after each task using the
> commit message given in that task's final step. Stop and report if any task requires a file
> outside your ownership.

Tasks 1, 2, and 14 are **not** agent-parallel work. Run them yourselves, or with a single
agent, while both of you watch.

## Deviations from the spec

One, recorded here and in `docs/decisions.md`:

**Primary keys are UUIDv4, not UUIDv7.** The spec calls for time-sortable UUIDv7. Postgres 16 has no native `uuidv7()` function, and adding a dependency purely to generate keys is not worth it. Every table carries a `created_at` column that ordering uses instead. Revisit if the project moves to Postgres 18.

## File structure

| File | Responsibility |
|---|---|
| `docker-compose.yml` | Local Postgres 16 container |
| `drizzle.config.ts` | drizzle-kit migration config |
| `vitest.config.ts` | Test runner config; disables file parallelism for DB tests |
| `src/db/client.ts` | Postgres connection and Drizzle instance; exports the `Tx` type |
| `src/db/schema/identity.ts` | `users`, `seasons`, `season_memberships` |
| `src/db/schema/money.ts` | `ledger_entries` |
| `src/db/schema/index.ts` | Re-exports every table for Drizzle |
| `src/db/migrate.ts` | Migration runner |
| `src/domain/money.ts` | Cents parsing and formatting |
| `src/domain/odds.ts` | American price ↔ rational, payout arithmetic |
| `src/domain/grading.ts` | Leg and parlay grading, settled payout |
| `src/server/money/ledger.ts` | `postEntry` — the only function that writes money |
| `src/server/money/errors.ts` | Typed money errors |
| `src/server/seasons/service.ts` | Create season, join season, weekly allowance |
| `src/server/admin/adjust.ts` | Admin credit/debit |
| `src/server/money/reconcile.ts` | Balance-vs-ledger reconciliation |
| `src/test/db.ts` | Test database helpers (`resetDb`, factories) |

Track B (Tasks 3–9) touches only `src/db/**` and `src/server/**`. Track A (Tasks 10–13) touches only `src/domain/**`. They share no files, so the two tracks can run in parallel after Task 2.

---

### Task 1: Project scaffold

**Owner: Both — pair on this. Do not split.**

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.gitignore`
- Create: `src/app/layout.tsx`, `src/app/page.tsx`
- Test: `src/domain/__tests__/scaffold.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `npm test`, `npm run typecheck`, `npm run dev` all work. Path alias `@/*` → `src/*`.

- [ ] **Step 1: Create the Next.js app**

Run from the repo root. Answer the prompts as shown — the directory already contains `docs/` and `.claude/`, so scaffold into a temp directory and move the files in.

```bash
npx --yes create-next-app@latest /tmp/simbet-scaffold \
  --typescript --app --tailwind --eslint --src-dir \
  --import-alias "@/*" --use-npm --no-turbopack --yes
```

- [ ] **Step 2: Move the scaffold into the repo**

```bash
cd /Users/connerrauguth/Repos/SimulatedBetting
rsync -a --exclude node_modules --exclude .git /tmp/simbet-scaffold/ ./
rm -rf /tmp/simbet-scaffold
npm install
```

- [ ] **Step 3: Add Vitest**

```bash
npm install --save-dev vitest @vitejs/plugin-react vite-tsconfig-paths dotenv
```

- [ ] **Step 4: Write `vitest.config.ts`**

`fileParallelism: false` matters — Task 5 onward runs real transactions against one database, and parallel files would interfere with each other.

```ts
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    fileParallelism: false,
    include: ['src/**/__tests__/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
  },
});
```

- [ ] **Step 5: Write `src/test/setup.ts`**

```ts
import { config } from 'dotenv';

config({ path: '.env.test', override: true });
```

- [ ] **Step 6: Add scripts to `package.json`**

Merge these into the existing `"scripts"` block:

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "typecheck": "tsc --noEmit",
  "verify": "npm run typecheck && npm run lint && npm test"
}
```

- [ ] **Step 7: Write the failing scaffold test**

Create `src/domain/__tests__/scaffold.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CENTS_PER_DOLLAR } from '@/domain/money';

describe('scaffold', () => {
  it('resolves the @/ path alias', () => {
    expect(CENTS_PER_DOLLAR).toBe(100n);
  });
});
```

- [ ] **Step 8: Run it to confirm it fails**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "@/domain/money"`.

- [ ] **Step 9: Create `src/domain/money.ts` with just the constant**

```ts
export const CENTS_PER_DOLLAR = 100n;
```

- [ ] **Step 10: Run it again**

Run: `npm test`
Expected: PASS, 1 test.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js app with TypeScript and Vitest"
```

---

### Task 2: Local Postgres in Docker

**Owner: Both — pair on this. Both workers need a running database before the split.**

**Files:**
- Create: `docker-compose.yml`, `.env.example`, `.env.local`, `.env.test`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing
- Produces: a Postgres 16 server on `localhost:5433` with databases `simbet` and `simbet_test`. `DATABASE_URL` and `TEST_DATABASE_URL` env vars.

The credentials below are throwaway values for a local container that is never exposed off the machine. Real deployment credentials are handled in Plan 3 and never committed.

- [ ] **Step 1: Write `docker-compose.yml`**

Port 5433 avoids colliding with any Postgres already listening on the default 5432.

```yaml
services:
  db:
    image: postgres:16-alpine
    container_name: simbet-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: simbet
      POSTGRES_PASSWORD: simbet
      POSTGRES_DB: simbet
    ports:
      - '5433:5432'
    volumes:
      - simbet-pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U simbet']
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  simbet-pgdata:
```

- [ ] **Step 2: Write `.env.example`**

```bash
DATABASE_URL=postgres://simbet:simbet@localhost:5433/simbet
TEST_DATABASE_URL=postgres://simbet:simbet@localhost:5433/simbet_test
```

- [ ] **Step 3: Create the real env files**

```bash
cp .env.example .env.local
printf 'DATABASE_URL=postgres://simbet:simbet@localhost:5433/simbet_test\nTEST_DATABASE_URL=postgres://simbet:simbet@localhost:5433/simbet_test\n' > .env.test
```

`.env.test` sets `DATABASE_URL` to the *test* database as well, so any code reading `DATABASE_URL` during a test run cannot touch development data.

- [ ] **Step 4: Ignore the env files**

Append to `.gitignore`:

```
.env.local
.env.test
```

- [ ] **Step 5: Add database scripts to `package.json`**

```json
{
  "db:up": "docker compose up -d --wait",
  "db:down": "docker compose down",
  "db:reset": "docker compose down -v && docker compose up -d --wait && npm run db:test:create",
  "db:test:create": "docker compose exec -T db psql -U simbet -d simbet -c 'CREATE DATABASE simbet_test' || true"
}
```

- [ ] **Step 6: Start the database**

```bash
npm run db:up && npm run db:test:create
```

Expected: `simbet-db` reports healthy, and `CREATE DATABASE` succeeds (or is skipped if it already exists).

- [ ] **Step 7: Verify both databases exist**

Run:

```bash
docker compose exec -T db psql -U simbet -d simbet -c '\l' | grep simbet
```

Expected: both `simbet` and `simbet_test` listed.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add local Postgres via Docker Compose"
```

---

## Track B — Data & money (Tasks 3–9) — Worker B

### Task 3: Drizzle client and identity schema

**Owner: B**

**Files:**
- Create: `drizzle.config.ts`, `src/db/client.ts`, `src/db/schema/identity.ts`, `src/db/schema/index.ts`, `src/db/migrate.ts`
- Test: `src/db/__tests__/identity.test.ts`

**Interfaces:**
- Consumes: `DATABASE_URL` from Task 2
- Produces:
  - `db` — the Drizzle instance
  - `type Tx` — the transaction type every service function accepts
  - Tables `users`, `seasons`, `seasonMemberships`
  - Enums `authProvider`, `userRole`, `userStatus`, `seasonStatus`

- [ ] **Step 1: Install Drizzle**

```bash
npm install drizzle-orm postgres
npm install --save-dev drizzle-kit
```

- [ ] **Step 2: Write `src/db/schema/identity.ts`**

```ts
import { sql } from 'drizzle-orm';
import {
  bigint,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const authProvider = pgEnum('auth_provider', ['GOOGLE', 'APPLE']);
export const userRole = pgEnum('user_role', ['USER', 'ADMIN']);
export const userStatus = pgEnum('user_status', ['PENDING', 'APPROVED', 'DISABLED']);
export const seasonStatus = pgEnum('season_status', ['UPCOMING', 'ACTIVE', 'COMPLETED']);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: authProvider('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    avatarUrl: text('avatar_url'),
    role: userRole('role').notNull().default('USER'),
    status: userStatus('status').notNull().default('PENDING'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_provider_account_idx').on(t.provider, t.providerAccountId)],
);

export const seasons = pgTable(
  'seasons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    startingBankrollCents: bigint('starting_bankroll_cents', { mode: 'bigint' }).notNull(),
    weeklyAllowanceCents: bigint('weekly_allowance_cents', { mode: 'bigint' }).notNull(),
    allowanceWeekday: smallint('allowance_weekday').notNull(),
    status: seasonStatus('status').notNull().default('UPCOMING'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('seasons_one_active_idx')
      .on(t.status)
      .where(sql`${t.status} = 'ACTIVE'`),
  ],
);

export const seasonMemberships = pgTable(
  'season_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => seasons.id),
    balanceCents: bigint('balance_cents', { mode: 'bigint' }).notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('season_memberships_user_season_idx').on(t.userId, t.seasonId)],
);
```

The partial unique index on `status` is what enforces "at most one `ACTIVE` season" — every active row indexes to the same key, so a second one violates uniqueness.

- [ ] **Step 3: Write `src/db/schema/index.ts`**

```ts
export * from './identity';
```

- [ ] **Step 4: Write `src/db/client.ts`**

```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

export const pgClient = postgres(connectionString, { max: 10 });
export const db = drizzle(pgClient, { schema });

export type Database = typeof db;
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
```

The raw client is exported as `pgClient`, not `sql` — `sql` is Drizzle's query-template
helper, and having both under one name in scope is a genuine source of confusion later.

`Tx` is derived from Drizzle's own transaction callback, so service functions accept either a transaction or nothing else — they never open their own.

- [ ] **Step 5: Write `drizzle.config.ts`**

```ts
import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

config({ path: '.env.local' });

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

- [ ] **Step 6: Write `src/db/migrate.ts`**

```ts
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

config({ path: process.env.ENV_FILE ?? '.env.local' });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

const client = postgres(connectionString, { max: 1 });

await migrate(drizzle(client), { migrationsFolder: './drizzle' });
await client.end();

console.log('migrations applied');
```

- [ ] **Step 7: Add migration scripts to `package.json`**

```json
{
  "db:generate": "drizzle-kit generate",
  "db:migrate": "tsx src/db/migrate.ts",
  "db:migrate:test": "ENV_FILE=.env.test tsx src/db/migrate.ts"
}
```

Install the TypeScript runner:

```bash
npm install --save-dev tsx
```

- [ ] **Step 8: Generate and apply the migration**

```bash
npm run db:generate && npm run db:migrate && npm run db:migrate:test
```

Expected: a file appears under `drizzle/`, and both runs print `migrations applied`.

- [ ] **Step 9: Write `src/test/db.ts`**

```ts
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

export async function resetDb(): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE ledger_entries, season_memberships, seasons, users RESTART IDENTITY CASCADE`,
  );
}
```

`ledger_entries` is listed now because Task 4 adds it; until then this helper is written but not yet used by a passing test. If Task 4 has not run, temporarily drop that table name from the list.

- [ ] **Step 10: Write the failing test**

Create `src/db/__tests__/identity.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { seasons, users } from '@/db/schema';
import { resetDb } from '@/test/db';

describe('identity schema', () => {
  beforeEach(resetDb);

  it('stores a user defaulting to PENDING', async () => {
    const [user] = await db
      .insert(users)
      .values({
        provider: 'GOOGLE',
        providerAccountId: 'google-1',
        email: 'a@example.com',
        displayName: 'Conner',
      })
      .returning();

    expect(user.status).toBe('PENDING');
    expect(user.role).toBe('USER');
  });

  it('allows only one ACTIVE season', async () => {
    const base = {
      startsAt: new Date('2026-09-01'),
      endsAt: new Date('2027-01-31'),
      startingBankrollCents: 1_000_000n,
      weeklyAllowanceCents: 50_000n,
      allowanceWeekday: 2,
      status: 'ACTIVE' as const,
    };

    await db.insert(seasons).values({ ...base, name: 'First' });

    await expect(db.insert(seasons).values({ ...base, name: 'Second' })).rejects.toThrow();
  });
});
```

- [ ] **Step 11: Run it to confirm it fails**

Run: `npm test -- src/db/__tests__/identity.test.ts`
Expected: FAIL, if the migration has not been applied to the test database. If it already passes, the migration ran in Step 8 — that is fine, and proves the schema.

- [ ] **Step 12: Run the full suite**

Run: `npm test`
Expected: PASS, 3 tests.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat: add Drizzle client and identity schema"
```

---

### Task 4: Ledger schema

**Owner: B**

**Files:**
- Create: `src/db/schema/money.ts`
- Modify: `src/db/schema/index.ts`
- Test: `src/db/__tests__/ledger-schema.test.ts`

**Interfaces:**
- Consumes: `seasonMemberships`, `users` from Task 3
- Produces: table `ledgerEntries`, enum `ledgerEntryType`, and the exported union type `LedgerEntryType`

`bet_id` is deliberately absent — bets do not exist until Plan 2, which adds that column in its own migration.

- [ ] **Step 1: Write `src/db/schema/money.ts`**

```ts
import { bigint, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { seasonMemberships, users } from './identity';

export const ledgerEntryType = pgEnum('ledger_entry_type', [
  'SEASON_STARTING_GRANT',
  'WEEKLY_ALLOWANCE',
  'BET_PLACED',
  'BET_WON',
  'BET_PUSHED',
  'BET_VOIDED',
  'ADMIN_CREDIT',
  'ADMIN_DEBIT',
  'SETTLEMENT_REVERSAL',
]);

export type LedgerEntryType = (typeof ledgerEntryType.enumValues)[number];

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => seasonMemberships.id),
    amountCents: bigint('amount_cents', { mode: 'bigint' }).notNull(),
    type: ledgerEntryType('type').notNull(),
    balanceAfterCents: bigint('balance_after_cents', { mode: 'bigint' }).notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    note: text('note'),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ledger_entries_idempotency_key_idx').on(t.idempotencyKey),
    index('ledger_entries_membership_idx').on(t.membershipId, t.createdAt),
  ],
);
```

- [ ] **Step 2: Export it**

`src/db/schema/index.ts`:

```ts
export * from './identity';
export * from './money';
```

- [ ] **Step 3: Write the failing test**

Create `src/db/__tests__/ledger-schema.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { ledgerEntries } from '@/db/schema';
import { resetDb } from '@/test/db';
import { makeMembership } from '@/test/factories';

describe('ledger schema', () => {
  beforeEach(resetDb);

  it('rejects a duplicate idempotency key', async () => {
    const membership = await makeMembership();

    const entry = {
      membershipId: membership.id,
      amountCents: 1_000_000n,
      type: 'SEASON_STARTING_GRANT' as const,
      balanceAfterCents: 1_000_000n,
      idempotencyKey: `grant:${membership.id}`,
    };

    await db.insert(ledgerEntries).values(entry);
    await expect(db.insert(ledgerEntries).values(entry)).rejects.toThrow();
  });

  it('stores amounts as bigint cents', async () => {
    const membership = await makeMembership();

    const [row] = await db
      .insert(ledgerEntries)
      .values({
        membershipId: membership.id,
        amountCents: -12_345n,
        type: 'BET_PLACED',
        balanceAfterCents: 987_655n,
        idempotencyKey: `bet:${membership.id}:placed`,
      })
      .returning();

    expect(row.amountCents).toBe(-12_345n);
    expect(typeof row.amountCents).toBe('bigint');
  });
});
```

- [ ] **Step 4: Write `src/test/factories.ts`**

```ts
import { db } from '@/db/client';
import { seasonMemberships, seasons, users } from '@/db/schema';

let counter = 0;

export async function makeUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  counter += 1;
  const [user] = await db
    .insert(users)
    .values({
      provider: 'GOOGLE',
      providerAccountId: `google-${counter}`,
      email: `user${counter}@example.com`,
      displayName: `User ${counter}`,
      status: 'APPROVED',
      ...overrides,
    })
    .returning();
  return user;
}

export async function makeSeason(overrides: Partial<typeof seasons.$inferInsert> = {}) {
  counter += 1;
  const [season] = await db
    .insert(seasons)
    .values({
      name: `Season ${counter}`,
      startsAt: new Date('2026-09-01T00:00:00Z'),
      endsAt: new Date('2027-01-31T00:00:00Z'),
      startingBankrollCents: 1_000_000n,
      weeklyAllowanceCents: 50_000n,
      allowanceWeekday: 2,
      status: 'UPCOMING',
      ...overrides,
    })
    .returning();
  return season;
}

export async function makeMembership(balanceCents = 1_000_000n) {
  const user = await makeUser();
  const season = await makeSeason();
  const [membership] = await db
    .insert(seasonMemberships)
    .values({ userId: user.id, seasonId: season.id, balanceCents })
    .returning();
  return membership;
}
```

- [ ] **Step 5: Run it to confirm it fails**

Run: `npm test -- src/db/__tests__/ledger-schema.test.ts`
Expected: FAIL — `relation "ledger_entries" does not exist`.

- [ ] **Step 6: Generate and apply the migration**

```bash
npm run db:generate && npm run db:migrate && npm run db:migrate:test
```

- [ ] **Step 7: Run it again**

Run: `npm test -- src/db/__tests__/ledger-schema.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add append-only ledger schema"
```

---

### Task 5: The ledger write path

**Owner: B** — the hardest task in the plan. Do not rush the concurrency test.

**Files:**
- Create: `src/server/money/errors.ts`, `src/server/money/ledger.ts`
- Test: `src/server/money/__tests__/ledger.test.ts`

**Interfaces:**
- Consumes: `Tx` and `db` from Task 3, `ledgerEntries` and `LedgerEntryType` from Task 4
- Produces:
  - `postEntry(tx: Tx, input: PostEntryInput): Promise<PostEntryResult>`
  - `interface PostEntryInput { membershipId: string; amountCents: bigint; type: LedgerEntryType; idempotencyKey: string; actorUserId?: string; note?: string }`
  - `interface PostEntryResult { applied: boolean; balanceCents: bigint }`
  - `class MoneyError extends Error` with `code: 'MEMBERSHIP_NOT_FOUND' | 'INSUFFICIENT_FUNDS' | 'NOTE_REQUIRED'`

This is the only function in the entire system permitted to change a balance. Every later task calls it.

- [ ] **Step 1: Write the failing test**

Create `src/server/money/__tests__/ledger.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { ledgerEntries, seasonMemberships } from '@/db/schema';
import { MoneyError } from '@/server/money/errors';
import { postEntry } from '@/server/money/ledger';
import { resetDb } from '@/test/db';
import { makeMembership } from '@/test/factories';

async function balanceOf(membershipId: string): Promise<bigint> {
  const [row] = await db
    .select({ balanceCents: seasonMemberships.balanceCents })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, membershipId));
  return row.balanceCents;
}

describe('postEntry', () => {
  beforeEach(resetDb);

  it('credits a balance and records the entry', async () => {
    const membership = await makeMembership(1_000_000n);

    const result = await db.transaction((tx) =>
      postEntry(tx, {
        membershipId: membership.id,
        amountCents: 50_000n,
        type: 'WEEKLY_ALLOWANCE',
        idempotencyKey: `allowance:${membership.id}:2026-W36`,
      }),
    );

    expect(result.applied).toBe(true);
    expect(result.balanceCents).toBe(1_050_000n);
    expect(await balanceOf(membership.id)).toBe(1_050_000n);

    const entries = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.membershipId, membership.id));
    expect(entries).toHaveLength(1);
    expect(entries[0].balanceAfterCents).toBe(1_050_000n);
  });

  it('is a no-op when the idempotency key was already used', async () => {
    const membership = await makeMembership(1_000_000n);
    const input = {
      membershipId: membership.id,
      amountCents: 50_000n,
      type: 'WEEKLY_ALLOWANCE' as const,
      idempotencyKey: `allowance:${membership.id}:2026-W36`,
    };

    await db.transaction((tx) => postEntry(tx, input));
    const second = await db.transaction((tx) => postEntry(tx, input));

    expect(second.applied).toBe(false);
    expect(await balanceOf(membership.id)).toBe(1_050_000n);
    expect(
      await db.select().from(ledgerEntries).where(eq(ledgerEntries.membershipId, membership.id)),
    ).toHaveLength(1);
  });

  it('refuses to overdraw a balance', async () => {
    const membership = await makeMembership(10_000n);

    await expect(
      db.transaction((tx) =>
        postEntry(tx, {
          membershipId: membership.id,
          amountCents: -10_001n,
          type: 'BET_PLACED',
          idempotencyKey: 'bet:x:placed',
        }),
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });

    expect(await balanceOf(membership.id)).toBe(10_000n);
  });

  it('requires a note on admin entries', async () => {
    const membership = await makeMembership();

    await expect(
      db.transaction((tx) =>
        postEntry(tx, {
          membershipId: membership.id,
          amountCents: 25_000n,
          type: 'ADMIN_CREDIT',
          idempotencyKey: 'admin:1',
        }),
      ),
    ).rejects.toBeInstanceOf(MoneyError);
  });

  it('serialises concurrent writes against the same membership', async () => {
    const membership = await makeMembership(10_000n);

    const attempt = (key: string) =>
      db
        .transaction((tx) =>
          postEntry(tx, {
            membershipId: membership.id,
            amountCents: -8_000n,
            type: 'BET_PLACED',
            idempotencyKey: key,
          }),
        )
        .then(() => 'ok' as const)
        .catch(() => 'rejected' as const);

    const results = await Promise.all([attempt('bet:a:placed'), attempt('bet:b:placed')]);

    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(await balanceOf(membership.id)).toBe(2_000n);
  });
});
```

The last test is the important one: it proves two devices cannot spend the same balance.

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- src/server/money/__tests__/ledger.test.ts`
Expected: FAIL — `Failed to resolve import "@/server/money/ledger"`.

- [ ] **Step 3: Write `src/server/money/errors.ts`**

```ts
export type MoneyErrorCode = 'MEMBERSHIP_NOT_FOUND' | 'INSUFFICIENT_FUNDS' | 'NOTE_REQUIRED';

export class MoneyError extends Error {
  readonly code: MoneyErrorCode;

  constructor(code: MoneyErrorCode, message: string) {
    super(message);
    this.name = 'MoneyError';
    this.code = code;
  }
}
```

- [ ] **Step 4: Write `src/server/money/ledger.ts`**

```ts
import { eq } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { ledgerEntries, seasonMemberships, type LedgerEntryType } from '@/db/schema';
import { MoneyError } from './errors';

const ADMIN_TYPES: ReadonlySet<LedgerEntryType> = new Set(['ADMIN_CREDIT', 'ADMIN_DEBIT']);

export interface PostEntryInput {
  membershipId: string;
  amountCents: bigint;
  type: LedgerEntryType;
  idempotencyKey: string;
  actorUserId?: string;
  note?: string;
}

export interface PostEntryResult {
  applied: boolean;
  balanceCents: bigint;
}

export async function postEntry(tx: Tx, input: PostEntryInput): Promise<PostEntryResult> {
  if (ADMIN_TYPES.has(input.type) && !input.note?.trim()) {
    throw new MoneyError('NOTE_REQUIRED', `${input.type} requires a note`);
  }

  const [membership] = await tx
    .select({ balanceCents: seasonMemberships.balanceCents })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, input.membershipId))
    .for('update');

  if (!membership) {
    throw new MoneyError('MEMBERSHIP_NOT_FOUND', `no membership ${input.membershipId}`);
  }

  const nextBalance = membership.balanceCents + input.amountCents;
  if (nextBalance < 0n) {
    throw new MoneyError(
      'INSUFFICIENT_FUNDS',
      `balance ${membership.balanceCents} cannot absorb ${input.amountCents}`,
    );
  }

  const inserted = await tx
    .insert(ledgerEntries)
    .values({
      membershipId: input.membershipId,
      amountCents: input.amountCents,
      type: input.type,
      balanceAfterCents: nextBalance,
      actorUserId: input.actorUserId,
      note: input.note,
      idempotencyKey: input.idempotencyKey,
    })
    .onConflictDoNothing({ target: ledgerEntries.idempotencyKey })
    .returning({ id: ledgerEntries.id });

  if (inserted.length === 0) {
    return { applied: false, balanceCents: membership.balanceCents };
  }

  await tx
    .update(seasonMemberships)
    .set({ balanceCents: nextBalance })
    .where(eq(seasonMemberships.id, input.membershipId));

  return { applied: true, balanceCents: nextBalance };
}
```

The `.for('update')` row lock is taken *before* the balance is read, so a concurrent transaction blocks until this one commits and then re-reads the updated balance.

- [ ] **Step 5: Run the test**

Run: `npm test -- src/server/money/__tests__/ledger.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add idempotent ledger write path with row locking"
```

---

### Task 6: Season creation and joining

**Owner: B**

**Files:**
- Create: `src/server/seasons/service.ts`, `src/server/seasons/defaults.ts`
- Test: `src/server/seasons/__tests__/service.test.ts`

**Interfaces:**
- Consumes: `postEntry` from Task 5
- Produces:
  - `createSeason(input): Promise<Season>`
  - `joinSeason(userId: string, seasonId: string): Promise<{ membershipId: string; balanceCents: bigint }>`
  - Constants `DEFAULT_STARTING_BANKROLL_CENTS = 1_000_000n`, `DEFAULT_WEEKLY_ALLOWANCE_CENTS = 50_000n`, `DEFAULT_ALLOWANCE_WEEKDAY = 2`

- [ ] **Step 1: Write the failing test**

Create `src/server/seasons/__tests__/service.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { ledgerEntries } from '@/db/schema';
import { createSeason, joinSeason } from '@/server/seasons/service';
import { resetDb } from '@/test/db';
import { makeUser } from '@/test/factories';

describe('season service', () => {
  beforeEach(resetDb);

  it('creates a season with the default economy settings', async () => {
    const season = await createSeason({
      name: '2026 Football',
      startsAt: new Date('2026-09-01T00:00:00Z'),
      endsAt: new Date('2027-01-31T00:00:00Z'),
    });

    expect(season.startingBankrollCents).toBe(1_000_000n);
    expect(season.weeklyAllowanceCents).toBe(50_000n);
    expect(season.allowanceWeekday).toBe(2);
    expect(season.status).toBe('UPCOMING');
  });

  it('grants the starting bankroll on join', async () => {
    const user = await makeUser();
    const season = await createSeason({
      name: '2026 Football',
      startsAt: new Date('2026-09-01T00:00:00Z'),
      endsAt: new Date('2027-01-31T00:00:00Z'),
    });

    const membership = await joinSeason(user.id, season.id);

    expect(membership.balanceCents).toBe(1_000_000n);

    const entries = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.membershipId, membership.membershipId));

    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('SEASON_STARTING_GRANT');
    expect(entries[0].amountCents).toBe(1_000_000n);
  });

  it('does not mint a second bankroll when a join is retried', async () => {
    const user = await makeUser();
    const season = await createSeason({
      name: '2026 Football',
      startsAt: new Date('2026-09-01T00:00:00Z'),
      endsAt: new Date('2027-01-31T00:00:00Z'),
    });

    const first = await joinSeason(user.id, season.id);
    const second = await joinSeason(user.id, season.id);

    expect(second.membershipId).toBe(first.membershipId);
    expect(second.balanceCents).toBe(1_000_000n);
    expect(
      await db.select().from(ledgerEntries).where(eq(ledgerEntries.membershipId, first.membershipId)),
    ).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- src/server/seasons/__tests__/service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/server/seasons/defaults.ts`**

```ts
export const DEFAULT_STARTING_BANKROLL_CENTS = 1_000_000n; // $10,000.00
export const DEFAULT_WEEKLY_ALLOWANCE_CENTS = 50_000n; // $500.00
export const DEFAULT_ALLOWANCE_WEEKDAY = 2; // Tuesday, matching the NFL week rollover
```

- [ ] **Step 4: Write `src/server/seasons/service.ts`**

```ts
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { seasonMemberships, seasons } from '@/db/schema';
import { postEntry } from '@/server/money/ledger';
import {
  DEFAULT_ALLOWANCE_WEEKDAY,
  DEFAULT_STARTING_BANKROLL_CENTS,
  DEFAULT_WEEKLY_ALLOWANCE_CENTS,
} from './defaults';

export interface CreateSeasonInput {
  name: string;
  startsAt: Date;
  endsAt: Date;
  startingBankrollCents?: bigint;
  weeklyAllowanceCents?: bigint;
  allowanceWeekday?: number;
}

export async function createSeason(input: CreateSeasonInput) {
  const [season] = await db
    .insert(seasons)
    .values({
      name: input.name,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      startingBankrollCents: input.startingBankrollCents ?? DEFAULT_STARTING_BANKROLL_CENTS,
      weeklyAllowanceCents: input.weeklyAllowanceCents ?? DEFAULT_WEEKLY_ALLOWANCE_CENTS,
      allowanceWeekday: input.allowanceWeekday ?? DEFAULT_ALLOWANCE_WEEKDAY,
    })
    .returning();

  return season;
}

export interface JoinSeasonResult {
  membershipId: string;
  balanceCents: bigint;
}

export async function joinSeason(userId: string, seasonId: string): Promise<JoinSeasonResult> {
  return db.transaction(async (tx) => {
    const [season] = await tx.select().from(seasons).where(eq(seasons.id, seasonId));
    if (!season) throw new Error(`no season ${seasonId}`);

    const [existing] = await tx
      .select()
      .from(seasonMemberships)
      .where(and(eq(seasonMemberships.userId, userId), eq(seasonMemberships.seasonId, seasonId)));

    const membership =
      existing ??
      (
        await tx
          .insert(seasonMemberships)
          .values({ userId, seasonId, balanceCents: 0n })
          .returning()
      )[0];

    const result = await postEntry(tx, {
      membershipId: membership.id,
      amountCents: season.startingBankrollCents,
      type: 'SEASON_STARTING_GRANT',
      idempotencyKey: `grant:${membership.id}`,
    });

    return { membershipId: membership.id, balanceCents: result.balanceCents };
  });
}
```

A membership is created with a zero balance and the grant is posted as a ledger entry, so even the opening bankroll has a row explaining where it came from.

- [ ] **Step 5: Run the test**

Run: `npm test -- src/server/seasons/__tests__/service.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add season creation and joining with starting grant"
```

---

### Task 7: Weekly allowance

**Owner: B**

**Files:**
- Create: `src/server/seasons/allowance.ts`
- Test: `src/server/seasons/__tests__/allowance.test.ts`

**Interfaces:**
- Consumes: `postEntry` from Task 5
- Produces:
  - `isoWeekKey(date: Date): string` — e.g. `'2026-W36'`, computed in `America/New_York`
  - `payWeeklyAllowance(now?: Date): Promise<{ credited: number; skipped: number }>`

- [ ] **Step 1: Write the failing test**

Create `src/server/seasons/__tests__/allowance.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { ledgerEntries, seasons } from '@/db/schema';
import { isoWeekKey, payWeeklyAllowance } from '@/server/seasons/allowance';
import { createSeason, joinSeason } from '@/server/seasons/service';
import { resetDb } from '@/test/db';
import { makeUser } from '@/test/factories';

async function activeSeasonWithMember() {
  const user = await makeUser();
  const season = await createSeason({
    name: '2026 Football',
    startsAt: new Date('2026-09-01T00:00:00Z'),
    endsAt: new Date('2027-01-31T00:00:00Z'),
  });
  await db.update(seasons).set({ status: 'ACTIVE' }).where(eq(seasons.id, season.id));
  const membership = await joinSeason(user.id, season.id);
  return membership;
}

describe('weekly allowance', () => {
  beforeEach(resetDb);

  it('derives a stable ISO week key in New York time', () => {
    expect(isoWeekKey(new Date('2026-09-01T12:00:00Z'))).toBe('2026-W36');
    expect(isoWeekKey(new Date('2026-09-06T12:00:00Z'))).toBe('2026-W36');
    expect(isoWeekKey(new Date('2026-09-07T12:00:00Z'))).toBe('2026-W37');
  });

  it('credits every member of the active season once', async () => {
    const membership = await activeSeasonWithMember();
    const now = new Date('2026-09-01T13:00:00Z');

    const first = await payWeeklyAllowance(now);
    const second = await payWeeklyAllowance(now);

    expect(first.credited).toBe(1);
    expect(second.credited).toBe(0);
    expect(second.skipped).toBe(1);

    const entries = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.membershipId, membership.membershipId));

    const allowances = entries.filter((e) => e.type === 'WEEKLY_ALLOWANCE');
    expect(allowances).toHaveLength(1);
    expect(allowances[0].amountCents).toBe(50_000n);
  });

  it('credits again in a later week', async () => {
    const membership = await activeSeasonWithMember();

    await payWeeklyAllowance(new Date('2026-09-01T13:00:00Z'));
    await payWeeklyAllowance(new Date('2026-09-08T13:00:00Z'));

    const entries = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.membershipId, membership.membershipId));

    expect(entries.filter((e) => e.type === 'WEEKLY_ALLOWANCE')).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- src/server/seasons/__tests__/allowance.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/server/seasons/allowance.ts`**

```ts
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { seasonMemberships, seasons } from '@/db/schema';
import { postEntry } from '@/server/money/ledger';

const LEAGUE_TIMEZONE = 'America/New_York';

/** ISO-8601 week key (e.g. "2026-W36") for the given instant, in league time. */
export function isoWeekKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: LEAGUE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const local = new Date(Date.UTC(get('year'), get('month') - 1, get('day')));

  // Shift to the Thursday of this ISO week, which always sits in the ISO year.
  const dayOfWeek = (local.getUTCDay() + 6) % 7; // Monday = 0
  local.setUTCDate(local.getUTCDate() - dayOfWeek + 3);

  const isoYear = local.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayOfWeek = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayOfWeek + 3);

  const week = 1 + Math.round((local.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

export interface AllowanceRunResult {
  credited: number;
  skipped: number;
}

export async function payWeeklyAllowance(now: Date = new Date()): Promise<AllowanceRunResult> {
  const [season] = await db.select().from(seasons).where(eq(seasons.status, 'ACTIVE'));
  if (!season) return { credited: 0, skipped: 0 };

  const memberships = await db
    .select({ id: seasonMemberships.id })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.seasonId, season.id));

  const weekKey = isoWeekKey(now);
  let credited = 0;
  let skipped = 0;

  for (const membership of memberships) {
    const result = await db.transaction((tx) =>
      postEntry(tx, {
        membershipId: membership.id,
        amountCents: season.weeklyAllowanceCents,
        type: 'WEEKLY_ALLOWANCE',
        idempotencyKey: `allowance:${membership.id}:${weekKey}`,
      }),
    );
    if (result.applied) credited += 1;
    else skipped += 1;
  }

  return { credited, skipped };
}
```

Each membership gets its own transaction, so one failure cannot roll back everyone else's allowance.

- [ ] **Step 4: Run the test**

Run: `npm test -- src/server/seasons/__tests__/allowance.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add idempotent weekly allowance"
```

---

### Task 8: Admin adjustments

**Owner: B**

**Files:**
- Create: `src/server/admin/adjust.ts`
- Test: `src/server/admin/__tests__/adjust.test.ts`

**Interfaces:**
- Consumes: `postEntry` from Task 5
- Produces: `adjustBalance(input: AdjustBalanceInput): Promise<{ balanceCents: bigint }>` where
  `AdjustBalanceInput = { membershipId: string; amountCents: bigint; note: string; actorUserId: string; idempotencyKey: string }`

- [ ] **Step 1: Write the failing test**

Create `src/server/admin/__tests__/adjust.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { ledgerEntries } from '@/db/schema';
import { adjustBalance } from '@/server/admin/adjust';
import { resetDb } from '@/test/db';
import { makeMembership, makeUser } from '@/test/factories';

describe('adjustBalance', () => {
  beforeEach(resetDb);

  it('credits with an ADMIN_CREDIT entry carrying the note and actor', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const membership = await makeMembership(1_000_000n);

    const result = await adjustBalance({
      membershipId: membership.id,
      amountCents: 25_000n,
      note: 'tournament buy-in',
      actorUserId: admin.id,
      idempotencyKey: 'admin:test:1',
    });

    expect(result.balanceCents).toBe(1_025_000n);

    const [entry] = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.membershipId, membership.id));

    expect(entry.type).toBe('ADMIN_CREDIT');
    expect(entry.note).toBe('tournament buy-in');
    expect(entry.actorUserId).toBe(admin.id);
  });

  it('debits with an ADMIN_DEBIT entry', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const membership = await makeMembership(1_000_000n);

    await adjustBalance({
      membershipId: membership.id,
      amountCents: -40_000n,
      note: 'correcting a mistake',
      actorUserId: admin.id,
      idempotencyKey: 'admin:test:2',
    });

    const [entry] = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.membershipId, membership.id));

    expect(entry.type).toBe('ADMIN_DEBIT');
    expect(entry.amountCents).toBe(-40_000n);
  });

  it('rejects a blank note', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const membership = await makeMembership();

    await expect(
      adjustBalance({
        membershipId: membership.id,
        amountCents: 1_000n,
        note: '   ',
        actorUserId: admin.id,
        idempotencyKey: 'admin:test:3',
      }),
    ).rejects.toMatchObject({ code: 'NOTE_REQUIRED' });
  });

  it('rejects a zero adjustment', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const membership = await makeMembership();

    await expect(
      adjustBalance({
        membershipId: membership.id,
        amountCents: 0n,
        note: 'nothing',
        actorUserId: admin.id,
        idempotencyKey: 'admin:test:4',
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- src/server/admin/__tests__/adjust.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/server/admin/adjust.ts`**

```ts
import { db } from '@/db/client';
import { postEntry } from '@/server/money/ledger';

export interface AdjustBalanceInput {
  membershipId: string;
  amountCents: bigint;
  note: string;
  actorUserId: string;
  idempotencyKey: string;
}

export async function adjustBalance(input: AdjustBalanceInput): Promise<{ balanceCents: bigint }> {
  if (input.amountCents === 0n) {
    throw new Error('adjustment must be non-zero');
  }

  const result = await db.transaction((tx) =>
    postEntry(tx, {
      membershipId: input.membershipId,
      amountCents: input.amountCents,
      type: input.amountCents > 0n ? 'ADMIN_CREDIT' : 'ADMIN_DEBIT',
      idempotencyKey: input.idempotencyKey,
      actorUserId: input.actorUserId,
      note: input.note,
    }),
  );

  return { balanceCents: result.balanceCents };
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- src/server/admin/__tests__/adjust.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add admin balance adjustments with mandatory notes"
```

---

### Task 9: Reconciliation

**Owner: B** — last task of Track B. Merge to `main` after this passes.

**Files:**
- Create: `src/server/money/reconcile.ts`
- Test: `src/server/money/__tests__/reconcile.test.ts`

**Interfaces:**
- Consumes: schema from Tasks 3–4
- Produces: `reconcileBalances(): Promise<Discrepancy[]>` where
  `interface Discrepancy { membershipId: string; cachedCents: bigint; ledgerCents: bigint }`

- [ ] **Step 1: Write the failing test**

Create `src/server/money/__tests__/reconcile.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { seasonMemberships } from '@/db/schema';
import { reconcileBalances } from '@/server/money/reconcile';
import { createSeason, joinSeason } from '@/server/seasons/service';
import { resetDb } from '@/test/db';
import { makeUser } from '@/test/factories';

async function memberWithGrant() {
  const user = await makeUser();
  const season = await createSeason({
    name: '2026 Football',
    startsAt: new Date('2026-09-01T00:00:00Z'),
    endsAt: new Date('2027-01-31T00:00:00Z'),
  });
  return joinSeason(user.id, season.id);
}

describe('reconcileBalances', () => {
  beforeEach(resetDb);

  it('reports nothing when balances match the ledger', async () => {
    await memberWithGrant();
    expect(await reconcileBalances()).toEqual([]);
  });

  it('reports a membership whose cached balance drifted', async () => {
    const membership = await memberWithGrant();

    await db
      .update(seasonMemberships)
      .set({ balanceCents: 999n })
      .where(eq(seasonMemberships.id, membership.membershipId));

    const discrepancies = await reconcileBalances();

    expect(discrepancies).toHaveLength(1);
    expect(discrepancies[0]).toMatchObject({
      membershipId: membership.membershipId,
      cachedCents: 999n,
      ledgerCents: 1_000_000n,
    });
  });

  it('treats a membership with no entries as zero', async () => {
    const membership = await memberWithGrant();

    await db
      .update(seasonMemberships)
      .set({ balanceCents: 0n })
      .where(eq(seasonMemberships.id, membership.membershipId));

    const discrepancies = await reconcileBalances();
    expect(discrepancies[0].ledgerCents).toBe(1_000_000n);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- src/server/money/__tests__/reconcile.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/server/money/reconcile.ts`**

```ts
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

export interface Discrepancy {
  membershipId: string;
  cachedCents: bigint;
  ledgerCents: bigint;
}

export async function reconcileBalances(): Promise<Discrepancy[]> {
  const rows = await db.execute<{
    membership_id: string;
    cached_cents: string;
    ledger_cents: string;
  }>(sql`
    SELECT m.id                                   AS membership_id,
           m.balance_cents                        AS cached_cents,
           COALESCE(SUM(l.amount_cents), 0)       AS ledger_cents
    FROM season_memberships m
    LEFT JOIN ledger_entries l ON l.membership_id = m.id
    GROUP BY m.id, m.balance_cents
    HAVING m.balance_cents <> COALESCE(SUM(l.amount_cents), 0)
  `);

  return Array.from(rows).map((row) => ({
    membershipId: row.membership_id,
    cachedCents: BigInt(row.cached_cents),
    ledgerCents: BigInt(row.ledger_cents),
  }));
}
```

The comparison happens in Postgres, so this stays a single query no matter how many members exist.

- [ ] **Step 4: Run the test**

Run: `npm test -- src/server/money/__tests__/reconcile.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add balance reconciliation against the ledger"
```

---

## Track A — Betting math (Tasks 10–13) — Worker A

These four tasks import nothing from `src/db/` or `src/server/`. They need no database and can be built in parallel with Track B.

### Task 10: Money formatting

**Owner: A**

**Files:**
- Modify: `src/domain/money.ts`
- Test: `src/domain/__tests__/money.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `CENTS_PER_DOLLAR = 100n` (already exists from Task 1)
  - `dollarsToCents(input: string | number): bigint`
  - `formatCents(cents: bigint): string` — e.g. `-190_91n` → `'-$190.91'`

- [ ] **Step 1: Write the failing test**

Create `src/domain/__tests__/money.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { dollarsToCents, formatCents } from '@/domain/money';

describe('dollarsToCents', () => {
  it('converts whole and fractional dollars', () => {
    expect(dollarsToCents(100)).toBe(10_000n);
    expect(dollarsToCents('10.5')).toBe(1_050n);
    expect(dollarsToCents('0.07')).toBe(7n);
  });

  it('rejects sub-cent precision', () => {
    expect(() => dollarsToCents('1.234')).toThrow();
  });

  it('rejects values that are not numbers', () => {
    expect(() => dollarsToCents('abc')).toThrow();
  });
});

describe('formatCents', () => {
  it('formats positive, negative, and zero', () => {
    expect(formatCents(19_091n)).toBe('$190.91');
    expect(formatCents(-50_000n)).toBe('-$500.00');
    expect(formatCents(0n)).toBe('$0.00');
  });

  it('groups thousands', () => {
    expect(formatCents(1_000_000n)).toBe('$10,000.00');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- src/domain/__tests__/money.test.ts`
Expected: FAIL — `dollarsToCents is not a function`.

- [ ] **Step 3: Implement in `src/domain/money.ts`**

```ts
export const CENTS_PER_DOLLAR = 100n;

/** Parse a dollar amount into integer cents. Rejects anything finer than a cent. */
export function dollarsToCents(input: string | number): bigint {
  const text = typeof input === 'number' ? input.toString() : input.trim();

  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) {
    throw new Error(`not a valid dollar amount: ${input}`);
  }

  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  const cents = BigInt(whole) * CENTS_PER_DOLLAR + BigInt(fraction.padEnd(2, '0'));

  return negative ? -cents : cents;
}

export function formatCents(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;

  const whole = abs / CENTS_PER_DOLLAR;
  const fraction = abs % CENTS_PER_DOLLAR;

  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = `$${grouped}.${fraction.toString().padStart(2, '0')}`;

  return negative ? `-${body}` : body;
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- src/domain/__tests__/money.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add cents parsing and formatting"
```

---

### Task 11: Odds arithmetic

**Owner: A** — the most correctness-critical task in either track. Every payout depends on it.

**Files:**
- Create: `src/domain/odds.ts`
- Test: `src/domain/__tests__/odds.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `interface Rational { num: bigint; den: bigint }`
  - `americanToRational(price: number): Rational` — the total return multiplier, not just profit
  - `combine(rationals: Rational[]): Rational`
  - `payoutCents(stakeCents: bigint, r: Rational): bigint` — half-up, rounded once
  - `rationalToAmerican(r: Rational): number`

- [ ] **Step 1: Write the failing test**

Create `src/domain/__tests__/odds.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { americanToRational, combine, payoutCents, rationalToAmerican } from '@/domain/odds';

describe('americanToRational', () => {
  it('converts a favourite', () => {
    expect(americanToRational(-110)).toEqual({ num: 210n, den: 110n });
  });

  it('converts an underdog', () => {
    expect(americanToRational(150)).toEqual({ num: 250n, den: 100n });
  });

  it('rejects prices inside the invalid band', () => {
    expect(() => americanToRational(0)).toThrow();
    expect(() => americanToRational(50)).toThrow();
    expect(() => americanToRational(-99)).toThrow();
  });

  it('rejects non-integer prices', () => {
    expect(() => americanToRational(-110.5)).toThrow();
  });
});

describe('payoutCents', () => {
  it('returns stake plus profit for a single bet', () => {
    expect(payoutCents(10_000n, americanToRational(-110))).toBe(19_091n);
    expect(payoutCents(10_000n, americanToRational(150))).toBe(25_000n);
  });

  it('rounds half up', () => {
    // 3 cents at +150 = 7.5 cents exactly
    expect(payoutCents(3n, americanToRational(150))).toBe(8n);
  });

  it('computes a three-leg parlay with a single rounding', () => {
    const parlay = combine([
      americanToRational(-110),
      americanToRational(-110),
      americanToRational(150),
    ]);
    expect(payoutCents(10_000n, parlay)).toBe(91_116n);
  });

  it('never loses precision on large parlays', () => {
    const legs = Array.from({ length: 10 }, () => americanToRational(-110));
    const payout = payoutCents(10_000n, combine(legs));
    expect(payout).toBeGreaterThan(10_000n);
    expect(typeof payout).toBe('bigint');
  });
});

describe('rationalToAmerican', () => {
  it('round-trips a favourite and an underdog', () => {
    expect(rationalToAmerican(americanToRational(-110))).toBe(-110);
    expect(rationalToAmerican(americanToRational(150))).toBe(150);
  });

  it('expresses combined parlay odds as a positive price', () => {
    const parlay = combine([americanToRational(-110), americanToRational(-110)]);
    expect(rationalToAmerican(parlay)).toBe(264);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- src/domain/__tests__/odds.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/domain/odds.ts`**

```ts
/**
 * A price expressed as an exact rational total-return multiplier.
 * `num / den` includes the stake: -110 is 210/110, so a $100 stake returns $190.91.
 */
export interface Rational {
  num: bigint;
  den: bigint;
}

/** Divide with half-up rounding. Both arguments must be positive. */
function roundHalfUpDiv(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

export function americanToRational(price: number): Rational {
  if (!Number.isInteger(price)) {
    throw new Error(`American price must be an integer: ${price}`);
  }
  if (price > -100 && price < 100) {
    throw new Error(`American price must be <= -100 or >= 100: ${price}`);
  }

  if (price > 0) {
    return { num: BigInt(price) + 100n, den: 100n };
  }

  const magnitude = BigInt(-price);
  return { num: 100n + magnitude, den: magnitude };
}

export function combine(rationals: Rational[]): Rational {
  return rationals.reduce<Rational>(
    (acc, r) => ({ num: acc.num * r.num, den: acc.den * r.den }),
    { num: 1n, den: 1n },
  );
}

/** Total return (stake included) for a stake at the given price. Rounds exactly once. */
export function payoutCents(stakeCents: bigint, r: Rational): bigint {
  if (stakeCents < 0n) throw new Error('stake must not be negative');
  return roundHalfUpDiv(stakeCents * r.num, r.den);
}

export function rationalToAmerican(r: Rational): number {
  const profitNum = r.num - r.den;
  if (profitNum <= 0n) {
    throw new Error('price must pay more than the stake');
  }

  // Decimal odds >= 2 means profit multiplier >= 1, i.e. profitNum >= den.
  if (profitNum >= r.den) {
    return Number(roundHalfUpDiv(profitNum * 100n, r.den));
  }
  return -Number(roundHalfUpDiv(r.den * 100n, profitNum));
}
```

Everything is `bigint` from end to end, so a ten-leg parlay multiplies exactly rather than drifting through floating point.

- [ ] **Step 4: Run the test**

Run: `npm test -- src/domain/__tests__/odds.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add exact rational odds arithmetic"
```

---

### Task 12: Leg grading

**Owner: A**

**Files:**
- Create: `src/domain/grading.ts`
- Test: `src/domain/__tests__/grading-leg.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type MarketType = 'MONEYLINE' | 'SPREAD' | 'TOTAL'`
  - `type Side = 'HOME' | 'AWAY' | 'OVER' | 'UNDER'`
  - `type LegStatus = 'PENDING' | 'WON' | 'LOST' | 'PUSHED' | 'VOIDED'`
  - `interface GameResult { homeScore: number; awayScore: number }`
  - `gradeLeg(input: GradeLegInput): 'WON' | 'LOST' | 'PUSHED'`

- [ ] **Step 1: Write the failing test**

Create `src/domain/__tests__/grading-leg.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { gradeLeg } from '@/domain/grading';

const result = { homeScore: 24, awayScore: 20 };

describe('gradeLeg — moneyline', () => {
  it('grades the winner and loser', () => {
    expect(gradeLeg({ marketType: 'MONEYLINE', side: 'HOME', line: null, result })).toBe('WON');
    expect(gradeLeg({ marketType: 'MONEYLINE', side: 'AWAY', line: null, result })).toBe('LOST');
  });

  it('pushes a tie', () => {
    const tie = { homeScore: 20, awayScore: 20 };
    expect(gradeLeg({ marketType: 'MONEYLINE', side: 'HOME', line: null, result: tie })).toBe('PUSHED');
  });

  it('rejects a line on a moneyline', () => {
    expect(() => gradeLeg({ marketType: 'MONEYLINE', side: 'HOME', line: -3.5, result })).toThrow();
  });
});

describe('gradeLeg — spread', () => {
  it('covers and fails to cover', () => {
    expect(gradeLeg({ marketType: 'SPREAD', side: 'HOME', line: -3.5, result })).toBe('WON');
    expect(gradeLeg({ marketType: 'SPREAD', side: 'HOME', line: -6.5, result })).toBe('LOST');
    expect(gradeLeg({ marketType: 'SPREAD', side: 'AWAY', line: 6.5, result })).toBe('WON');
  });

  it('pushes on an exact whole-number hit', () => {
    expect(gradeLeg({ marketType: 'SPREAD', side: 'HOME', line: -4, result })).toBe('PUSHED');
    expect(gradeLeg({ marketType: 'SPREAD', side: 'AWAY', line: 4, result })).toBe('PUSHED');
  });

  it('never pushes on a half-point line', () => {
    for (const line of [-3.5, -4.5, 0.5]) {
      expect(gradeLeg({ marketType: 'SPREAD', side: 'HOME', line, result })).not.toBe('PUSHED');
    }
  });

  it('requires a line', () => {
    expect(() => gradeLeg({ marketType: 'SPREAD', side: 'HOME', line: null, result })).toThrow();
  });

  it('rejects an over/under side', () => {
    expect(() => gradeLeg({ marketType: 'SPREAD', side: 'OVER', line: -3.5, result })).toThrow();
  });
});

describe('gradeLeg — total', () => {
  it('grades over and under', () => {
    expect(gradeLeg({ marketType: 'TOTAL', side: 'OVER', line: 43.5, result })).toBe('WON');
    expect(gradeLeg({ marketType: 'TOTAL', side: 'UNDER', line: 43.5, result })).toBe('LOST');
    expect(gradeLeg({ marketType: 'TOTAL', side: 'UNDER', line: 44.5, result })).toBe('WON');
  });

  it('pushes on an exact whole-number total', () => {
    expect(gradeLeg({ marketType: 'TOTAL', side: 'OVER', line: 44, result })).toBe('PUSHED');
    expect(gradeLeg({ marketType: 'TOTAL', side: 'UNDER', line: 44, result })).toBe('PUSHED');
  });

  it('rejects a home/away side', () => {
    expect(() => gradeLeg({ marketType: 'TOTAL', side: 'HOME', line: 44, result })).toThrow();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- src/domain/__tests__/grading-leg.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/domain/grading.ts`**

```ts
export type MarketType = 'MONEYLINE' | 'SPREAD' | 'TOTAL';
export type Side = 'HOME' | 'AWAY' | 'OVER' | 'UNDER';
export type LegStatus = 'PENDING' | 'WON' | 'LOST' | 'PUSHED' | 'VOIDED';
export type SettledLegStatus = 'WON' | 'LOST' | 'PUSHED';

export interface GameResult {
  homeScore: number;
  awayScore: number;
}

export interface GradeLegInput {
  marketType: MarketType;
  side: Side;
  line: number | null;
  result: GameResult;
}

function compare(a: number, b: number): SettledLegStatus {
  if (a > b) return 'WON';
  if (a < b) return 'LOST';
  return 'PUSHED';
}

export function gradeLeg(input: GradeLegInput): SettledLegStatus {
  const { marketType, side, line, result } = input;

  if (marketType === 'MONEYLINE') {
    if (line !== null) throw new Error('moneyline legs must not carry a line');
    if (side !== 'HOME' && side !== 'AWAY') throw new Error(`invalid moneyline side: ${side}`);

    return side === 'HOME'
      ? compare(result.homeScore, result.awayScore)
      : compare(result.awayScore, result.homeScore);
  }

  if (line === null) throw new Error(`${marketType} legs require a line`);

  if (marketType === 'SPREAD') {
    if (side !== 'HOME' && side !== 'AWAY') throw new Error(`invalid spread side: ${side}`);

    return side === 'HOME'
      ? compare(result.homeScore + line, result.awayScore)
      : compare(result.awayScore + line, result.homeScore);
  }

  if (side !== 'OVER' && side !== 'UNDER') throw new Error(`invalid total side: ${side}`);

  const total = result.homeScore + result.awayScore;
  return side === 'OVER' ? compare(total, line) : compare(line, total);
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- src/domain/__tests__/grading-leg.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add single-leg grading for moneyline, spread and total"
```

---

### Task 13: Parlay grading and settled payout

**Owner: A** — last task of Track A. Merge to `main` after this passes.

**Files:**
- Modify: `src/domain/grading.ts`
- Test: `src/domain/__tests__/grading-parlay.test.ts`

**Interfaces:**
- Consumes: `LegStatus` from Task 12, `americanToRational` / `combine` / `payoutCents` from Task 11
- Produces:
  - `gradeParlay(statuses: LegStatus[]): LegStatus` returning `PENDING` · `WON` · `LOST` · `PUSHED`
  - `settledPayoutCents(stakeCents: bigint, legs: SettledLeg[]): bigint` where
    `interface SettledLeg { status: LegStatus; priceAmerican: number }`

- [ ] **Step 1: Write the failing test**

Create `src/domain/__tests__/grading-parlay.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { gradeParlay, settledPayoutCents } from '@/domain/grading';

describe('gradeParlay', () => {
  it('wins when every leg wins', () => {
    expect(gradeParlay(['WON', 'WON', 'WON'])).toBe('WON');
  });

  it('loses as soon as one leg loses, even with legs pending', () => {
    expect(gradeParlay(['WON', 'LOST', 'PENDING'])).toBe('LOST');
  });

  it('stays pending while legs are unresolved', () => {
    expect(gradeParlay(['WON', 'PENDING'])).toBe('PENDING');
  });

  it('wins on the surviving legs when one pushes', () => {
    expect(gradeParlay(['WON', 'PUSHED', 'WON'])).toBe('WON');
  });

  it('pushes when every leg pushed or voided', () => {
    expect(gradeParlay(['PUSHED', 'VOIDED'])).toBe('PUSHED');
  });
});

describe('settledPayoutCents', () => {
  it('pays a two-leg parlay at combined odds', () => {
    const payout = settledPayoutCents(10_000n, [
      { status: 'WON', priceAmerican: -110 },
      { status: 'WON', priceAmerican: -110 },
    ]);
    expect(payout).toBe(36_446n);
  });

  it('drops a pushed leg and pays the reduced parlay', () => {
    const threeLegs = settledPayoutCents(10_000n, [
      { status: 'WON', priceAmerican: -110 },
      { status: 'PUSHED', priceAmerican: -110 },
      { status: 'WON', priceAmerican: -110 },
    ]);
    const twoLegs = settledPayoutCents(10_000n, [
      { status: 'WON', priceAmerican: -110 },
      { status: 'WON', priceAmerican: -110 },
    ]);
    expect(threeLegs).toBe(twoLegs);
  });

  it('refunds the stake when every leg pushed', () => {
    expect(
      settledPayoutCents(10_000n, [
        { status: 'PUSHED', priceAmerican: -110 },
        { status: 'VOIDED', priceAmerican: 150 },
      ]),
    ).toBe(10_000n);
  });

  it('pays nothing when any leg lost', () => {
    expect(
      settledPayoutCents(10_000n, [
        { status: 'WON', priceAmerican: -110 },
        { status: 'LOST', priceAmerican: -110 },
      ]),
    ).toBe(0n);
  });

  it('throws when a leg is still pending', () => {
    expect(() =>
      settledPayoutCents(10_000n, [{ status: 'PENDING', priceAmerican: -110 }]),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- src/domain/__tests__/grading-parlay.test.ts`
Expected: FAIL — `gradeParlay is not a function`.

- [ ] **Step 3: Append to `src/domain/grading.ts`**

```ts
import { americanToRational, combine, payoutCents } from './odds';

export function gradeParlay(statuses: LegStatus[]): LegStatus {
  if (statuses.length === 0) throw new Error('a parlay needs at least one leg');

  if (statuses.includes('LOST')) return 'LOST';
  if (statuses.includes('PENDING')) return 'PENDING';

  const surviving = statuses.filter((s) => s === 'WON');
  return surviving.length === 0 ? 'PUSHED' : 'WON';
}

export interface SettledLeg {
  status: LegStatus;
  priceAmerican: number;
}

/** Total return for a settled bet. Pushed and voided legs are removed from the parlay. */
export function settledPayoutCents(stakeCents: bigint, legs: SettledLeg[]): bigint {
  const outcome = gradeParlay(legs.map((leg) => leg.status));

  if (outcome === 'PENDING') throw new Error('cannot pay out a bet with pending legs');
  if (outcome === 'LOST') return 0n;
  if (outcome === 'PUSHED') return stakeCents;

  const surviving = legs.filter((leg) => leg.status === 'WON');
  return payoutCents(stakeCents, combine(surviving.map((leg) => americanToRational(leg.priceAmerican))));
}
```

Note the import goes at the top of the file alongside the existing content, not literally at the bottom.

- [ ] **Step 4: Run the test**

Run: `npm test -- src/domain/__tests__/grading-parlay.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Run all of Track A**

Run: `npm test -- src/domain/`
Expected: PASS — every test in Tasks 10 through 13.

Do not run `npm run verify` here. It runs Worker B's database tests too, which will fail if
Worker B has not merged yet. That failure would not be yours and not a bug.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add parlay grading and settled payout"
```

---

### Task 14: Continuous integration

**Owner: Both — only after Tracks A and B have both merged to `main`.** This task runs the
full suite, so it cannot pass until every earlier task exists.

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: `npm run verify` from Task 1, migrations from Tasks 3–4
- Produces: a GitHub Actions workflow gating every push and pull request

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: simbet
          POSTGRES_PASSWORD: simbet
          POSTGRES_DB: simbet_test
        ports:
          - 5433:5432
        options: >-
          --health-cmd "pg_isready -U simbet"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10

    env:
      DATABASE_URL: postgres://simbet:simbet@localhost:5433/simbet_test
      TEST_DATABASE_URL: postgres://simbet:simbet@localhost:5433/simbet_test

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      - run: npx tsx src/db/migrate.ts

      - run: npm run verify
```

The migration step runs directly rather than through `npm run db:migrate`, because that script loads `.env.local`, which does not exist in CI.

- [ ] **Step 2: Document local setup in `README.md`**

Replace the "Nothing is implemented yet." line with:

```markdown
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
```

- [ ] **Step 3: Verify the workflow file parses**

Run:

```bash
npx --yes js-yaml .github/workflows/ci.yml > /dev/null && echo "workflow yaml ok"
```

Expected: `workflow yaml ok`

- [ ] **Step 4: Run the full verification one more time**

Run: `npm run verify`
Expected: all green.

- [ ] **Step 5: Commit and push**

```bash
git add -A
git commit -m "ci: verify typecheck, lint and tests against Postgres"
git push origin main
```

- [ ] **Step 6: Confirm CI passed**

```bash
gh run watch
```

Expected: the `verify` job completes successfully.

---

## Definition of done

Plan 1 is complete when:

- `npm run verify` passes from a clean clone after `npm install && npm run db:up && npm run db:test:create && npm run db:migrate:test`
- CI is green on `main`
- A season can be created, joined, granted a bankroll, paid an allowance, adjusted by an admin, and reconciled — all through tested functions
- `gradeLeg`, `gradeParlay`, and `settledPayoutCents` handle every push, void, and rounding case in the tests
- No balance in the system can be changed except through `postEntry`

## What this plan deliberately leaves out

No odds ingestion, no games or markets, no bet placement, no settlement, no authentication, no UI. Those are Plans 2 and 3. This plan produces a money system that is correct and provable before anything is built on top of it.
