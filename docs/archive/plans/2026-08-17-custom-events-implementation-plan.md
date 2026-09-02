# Custom Events (Subsystem 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let members create their own hand-priced betting markets, resolved by a person rather than a score feed, bet with **credits** — a second currency that can never touch the cash bankroll the standings are built on.

**Architecture:** Three structural moves. (1) A new `events` table becomes the supertype `markets` hang off; `games` becomes a subtype with a unique `event_id` and `custom_events` is its sibling. (2) `currency` becomes a dimension on the existing ledger — one new column on `ledger_entries`, a second cached balance on `season_memberships`, per-currency reconciliation, and **no new ledger entry types**. (3) Grading routes by event kind: the existing score-based `gradeLeg` is untouched and a new pure `gradeCustomLeg` sits beside it, with everything downstream (`gradeParlay`, `settledPayoutCents`, all odds math) reused unchanged.

**Tech Stack:** Next.js 16.3.1 (App Router, React 19.2.8, Server Components + server actions), TypeScript 5, Drizzle ORM 0.45 on Postgres 16, Vitest 4, Tailwind 4.

**Read first:** [`docs/specs/2026-08-17-custom-events-design.md`](../specs/2026-08-17-custom-events-design.md) is the spec this plan implements. [`docs/decisions.md`](../decisions.md) D31–D38 explain why each choice was made, and D5, D10, D11, D15, D17 explain the subsystem-1 properties this must not break. You do not need to read the subsystem 1 or 2 specs to execute this plan, but they are the reference if something about the existing engine is unclear.

---

## Global Constraints

- **This is NOT the Next.js you know.** Per `AGENTS.md`, this version has breaking changes from your training data. Before writing any UI code (Tasks 16–21), read the relevant guide in `node_modules/next/dist/docs/`. In particular confirm how `params` is typed and awaited in dynamic routes and how server actions are declared. The existing code uses generated route types — `src/app/(app)/layout.tsx` takes `LayoutProps<'/'>` — so dynamic pages use `PageProps<'/events/[eventId]'>` rather than a hand-written props type.
- **All money is integer cents as `bigint`** ([D17](../decisions.md#d17--all-money-is-integer-cents)). This is as true of credits as of cash. No floating-point value touches a balance. Ratios are integer basis points.
- **`bigint` is not serializable** across a server action boundary or into JSON. Cents cross those boundaries as decimal strings (`"95450"`) and are re-parsed with `BigInt()`. This is already the convention in `src/app/(app)/bets/actions.ts` and in every feed payload ([D25](../decisions.md#d25--money-inside-a-feed-payload-is-a-decimal-string)).
- **Credits never convert to cash, in either direction** ([D31](../decisions.md#d31--custom-events-are-bet-in-credits-a-second-non-convertible-currency)). There is no exchange rate, no purchase, no admin override. If you find yourself writing code that reads one balance and writes the other, stop — that is the one thing this subsystem must make impossible.
- **Every ledger write and every feed write carries a deterministic idempotency/dedupe key.** Running any job twice must move no extra money and create no extra events. Credit keys are the cash key plus a `:credits` suffix.
- **Authorization is server-side on every request**, never by hiding UI. Use the existing `requireApprovedMember()` (pages, redirects), `requireApprovedMemberOrThrow()` (server actions, throws), and `requireAdmin()` (admin pages) from `src/server/auth/session.ts`.
- **Do not change existing money or grading behavior.** All 306 existing tests must still pass. `gradeLeg`, `gradeParlay`, `settledPayoutCents` and everything in `src/domain/odds.ts` are read-only for this plan.
- **Database for tests:** see [Environment setup](#environment-setup). The `npm run db:up` path needs Docker and does **not** work in the Claude Code cloud environment. Tests run against `simbet_test`.
- **Verification command:** `npm run verify` (typecheck + lint + test). It must pass before the final commit of every task. Two pre-existing lint _warnings_ exist (`src/server/feed/leaders.ts` unused `seasonId`, `src/server/feed/__tests__/money-emission.test.ts` unused `_`); they are not errors and are not yours to fix. Zero errors is the bar.
- **Commit after every task**, with a `feat:` / `test:` / `docs:` prefix matching the existing history style.
- **UI polish is deferred by decision of the project owner.** Tasks 16–21 must be correct, server-side authorized, and complete enough to exercise every path the services expose. They do not need to be finished design — match the existing screens' Tailwind idiom, keep the markup plain, and do not spend task budget on layout experiments. A later pass owns the visual work.

---

## Environment setup

Run this once at the start of the session, before Task 1. These commands were executed and verified in the Claude Code cloud environment on 2026-08-17: `npm ci` succeeds through the proxy, and `npm run verify` passes clean at **40 files / 306 tests** against the database this sets up.

**Docker is not available.** The `docker` CLI is installed but no daemon is running, so `npm run db:up`, `npm run db:down` and `npm run db:reset` all fail. Do not try to start the daemon — a full Postgres 16 server is already installed locally, which is what the commands below use instead. The only difference is the port: **5432**, not the 5433 the compose file publishes.

```bash
npm ci

# Start the preinstalled Postgres cluster (port 5432, already initialized).
pg_ctlcluster 16 main start

# Create the role and both databases. The role needs SUPERUSER only so that
# TRUNCATE ... RESTART IDENTITY CASCADE in src/test/db.ts works on every table.
su postgres -c "psql -q -c \"CREATE ROLE simbet LOGIN PASSWORD 'simbet' SUPERUSER\""
su postgres -c "psql -q -c 'CREATE DATABASE simbet OWNER simbet'"
su postgres -c "psql -q -c 'CREATE DATABASE simbet_test OWNER simbet'"

cat > .env << 'EOF'
DATABASE_URL=postgres://simbet:simbet@127.0.0.1:5432/simbet
TEST_DATABASE_URL=postgres://simbet:simbet@127.0.0.1:5432/simbet_test
AUTH_SECRET=dev-secret-not-for-production-use-only
AUTH_GOOGLE_ID=dev
AUTH_GOOGLE_SECRET=dev
ADMIN_EMAILS=dev@example.com
CRON_SECRET=dev-cron-secret
EOF

# drizzle.config.ts and src/db/migrate.ts both default to .env.local, so it needs to
# exist for `npm run db:generate` and `npm run db:migrate` to find a connection string.
cp .env .env.local

# .env.test points DATABASE_URL at the test database — src/db/migrate.ts reads
# DATABASE_URL, not TEST_DATABASE_URL, when ENV_FILE=.env.test. src/test/setup.ts
# loads this file with override:true, so it is what every test connects through.
cp .env .env.test
sed -i 's#^DATABASE_URL=.*#DATABASE_URL=postgres://simbet:simbet@127.0.0.1:5432/simbet_test#' .env.test

npm run db:migrate:test
npm run verify
```

Expected from the last command: **40 test files, 306 tests, all passing**, with 0 lint errors and 2 pre-existing warnings. If that does not hold, stop and fix the environment before starting Task 1 — every task gates on `npm run verify`, and you cannot tell your own regression from a broken setup.

All three `.env` files are covered by `.gitignore` (`.env*`), so they will not be committed. **Re-run `npm run db:migrate:test` after every task that adds a migration** (Tasks 1, 5, 6, 7, 11).

**The running app cannot be signed into here.** Sign-in is Google OAuth only ([D20](../decisions.md#d20--auth-google-only-apple-dropped)) with no dev bypass, so `npm run dev` serves the app but you cannot get past `/sign-in` without real Google credentials. Tasks 16–21 therefore mark their browser steps as local-only and give a substitute gate that does work here: `npm run build`, which compiles every route for real and is what catches server/client boundary mistakes — the actual risk in those tasks.

---

## File Structure

**New files**

| Path                                                      | Responsibility                                                                                                                                                                    |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/db/schema/currency.ts`                               | The `currency` pgEnum alone. Its own file because both `money.ts` and `betting.ts` import it, and `money.ts` already imports `betting.ts` — a shared leaf avoids an import cycle. |
| `src/db/schema/events.ts`                                 | `events`, `custom_events`, `custom_event_disputes` tables and their enums                                                                                                         |
| `src/domain/custom-grading.ts`                            | Pure `gradeCustomLeg` and `currencyForKinds`                                                                                                                                      |
| `src/server/events/types.ts`                              | Input/result/error types shared by the event services                                                                                                                             |
| `src/server/events/create.ts`                             | `createCustomEvent` + its validation                                                                                                                                              |
| `src/server/events/resolve.ts`                            | `resolveCustomEvent`, `voidCustomEvent`                                                                                                                                           |
| `src/server/events/dispute.ts`                            | `disputeResolution`                                                                                                                                                               |
| `src/server/events/overdue.ts`                            | `sweepOverdueEvents`                                                                                                                                                              |
| `src/server/events/manage.ts`                             | `setMarketStatus` (suspend/reopen) and `editCustomEvent` (only while unbet)                                                                                                       |
| `src/server/events/query.ts`                              | Reads for the board and the event detail page                                                                                                                                     |
| `src/server/bets/grade-legs.ts`                           | `gradeBetLegs` — the one place that routes a leg to its grader by kind                                                                                                            |
| `src/app/(app)/events/page.tsx`                           | Events board                                                                                                                                                                      |
| `src/app/(app)/events/actions.ts`                         | Server actions: create, resolve, dispute, suspend                                                                                                                                 |
| `src/app/(app)/events/new/page.tsx`                       | Create-event screen                                                                                                                                                               |
| `src/app/(app)/events/new/event-form.tsx`                 | Client component: repeatable market/outcome builder                                                                                                                               |
| `src/app/(app)/events/[eventId]/page.tsx`                 | Event detail                                                                                                                                                                      |
| `src/app/(app)/events/[eventId]/market-card.tsx`          | One market and its outcomes, bettable                                                                                                                                             |
| `src/app/(app)/events/[eventId]/dispute-form.tsx`         | Client component: dispute composer                                                                                                                                                |
| `src/app/(app)/events/[eventId]/resolve/page.tsx`         | Resolution screen                                                                                                                                                                 |
| `src/app/(app)/events/[eventId]/resolve/resolve-form.tsx` | Client component: one radio group per market                                                                                                                                      |
| `src/app/admin/events/page.tsx`                           | Overdue queue, open disputes, void control                                                                                                                                        |
| `src/app/admin/events/actions.ts`                         | Server actions: void, re-resolve                                                                                                                                                  |

**Modified files**

| Path                                                | Change                                                                                                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/db/schema/index.ts`                            | Export `./currency` and `./events`                                                                                                                                       |
| `src/db/schema/money.ts`                            | `ledger_entries.currency`                                                                                                                                                |
| `src/db/schema/identity.ts`                         | `season_memberships.credits_balance_cents`; `seasons` credit grant columns                                                                                               |
| `src/db/schema/betting.ts`                          | `bets.currency`                                                                                                                                                          |
| `src/db/schema/sports.ts`                           | `games.event_id`; `markets.event_id` replaces `game_id`, plus `title`, `winning_selection_id`, nullable `source_book`; `selections.label`, `sort_order`, nullable `side` |
| `src/db/schema/social.ts`                           | Five new `feed_event_type` values                                                                                                                                        |
| `src/test/db.ts`                                    | Truncate the three new tables                                                                                                                                            |
| `src/test/factories.ts`                             | `makeCustomEvent`, `makeCreditMembership` helpers                                                                                                                        |
| `src/server/money/ledger.ts`                        | `postEntry` takes a currency                                                                                                                                             |
| `src/server/money/reconcile.ts`                     | Reconcile per currency                                                                                                                                                   |
| `src/server/seasons/service.ts`                     | Grant starting credits on join                                                                                                                                           |
| `src/server/seasons/allowance.ts`                   | Pay the weekly credit drip                                                                                                                                               |
| `src/server/admin/adjust.ts`                        | Adjust in either currency                                                                                                                                                |
| `src/server/bets/validate.ts`                       | Kind-aware `LoadedSelection`; `DUPLICATE_EVENT`; `MIXED_CURRENCY_PARLAY`                                                                                                 |
| `src/server/bets/place.ts`                          | Kind-aware `loadSelections`; writes `bets.currency`                                                                                                                      |
| `src/server/bets/settle.ts`                         | Joins through `events`; pays in the bet's currency                                                                                                                       |
| `src/server/bets/resettle.ts`                       | Regrades by kind                                                                                                                                                         |
| `src/server/odds/sync.ts`, `board.ts`, `results.ts` | Join through `events`                                                                                                                                                    |
| `src/server/feed/payload.ts`                        | `FeedLegSnapshot` union, `currency` on bet payloads, five new payload types                                                                                              |
| `src/server/feed/snapshot.ts`                       | `buildCustomLegSnapshot`                                                                                                                                                 |
| `src/app/api/cron/settle/route.ts`                  | Call `sweepOverdueEvents`                                                                                                                                                |
| `src/components/ui/tab-bar.tsx`                     | Six tabs                                                                                                                                                                 |
| `src/components/bet-slip/*`                         | Credits mode                                                                                                                                                             |
| `src/app/(app)/standings/page.tsx`                  | Credits leaderboard                                                                                                                                                      |
| `src/app/(app)/me/page.tsx`                         | Both balances, currency column                                                                                                                                           |
| `src/app/(app)/bets/page.tsx`                       | Currency filter                                                                                                                                                          |
| `src/app/(app)/feed/feed-card.tsx`                  | Render the five new card types and custom legs                                                                                                                           |
| `src/server/__tests__/end-to-end.test.ts`           | The custom-event arc                                                                                                                                                     |

## Task order and why

Tasks 1–4 add credits to the money core with no reference to events at all — that half is independently valuable and independently testable. Tasks 5–7 introduce the supertype in three migrations that each leave `npm run verify` green (add-and-backfill, then switch reads, then drop the old column). Task 8 is pure functions. Tasks 9–15 are services. Tasks 16–21 are UI. Task 22 proves the whole thing end to end.

**Do not reorder Tasks 5, 6, and 7.** Splitting the supertype migration into add → switch → constrain is what keeps every intermediate commit working; collapsing them produces one commit where the schema and the code disagree.

---

### Task 1: Currency on the ledger

**Files:**

- Create: `src/db/schema/currency.ts`
- Modify: `src/db/schema/money.ts`, `src/db/schema/identity.ts`, `src/db/schema/betting.ts`, `src/db/schema/index.ts`
- Create: `drizzle/0005_*.sql` (generated)
- Test: `src/db/__tests__/currency-schema.test.ts`

**Interfaces:**

- Consumes: nothing — this is the first task.
- Produces: `currency` pgEnum and `type Currency = 'CASH' | 'CREDITS'`; `ledgerEntries.currency`; `seasonMemberships.creditsBalanceCents`; `seasons.startingCreditsCents`; `seasons.weeklyCreditAllowanceCents`; `bets.currency`.

- [ ] **Step 1: Write the failing test**

Create `src/db/__tests__/currency-schema.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { ledgerEntries, seasonMemberships } from '@/db/schema';
import { resetDb } from '@/test/db';
import { makeMembership } from '@/test/factories';

describe('currency schema', () => {
  beforeEach(resetDb);

  it('defaults existing-style entries to CASH', async () => {
    const membership = await makeMembership();

    const [entry] = await db
      .insert(ledgerEntries)
      .values({
        membershipId: membership.id,
        amountCents: 1000n,
        type: 'SEASON_STARTING_GRANT',
        balanceAfterCents: 1000n,
        idempotencyKey: 'test:cash',
      })
      .returning();

    expect(entry.currency).toBe('CASH');
  });

  it('stores a CREDITS entry alongside a CASH one', async () => {
    const membership = await makeMembership();

    await db.insert(ledgerEntries).values([
      {
        membershipId: membership.id,
        amountCents: 1000n,
        type: 'SEASON_STARTING_GRANT',
        balanceAfterCents: 1000n,
        idempotencyKey: 'test:cash-2',
      },
      {
        membershipId: membership.id,
        amountCents: 500n,
        type: 'SEASON_STARTING_GRANT',
        currency: 'CREDITS',
        balanceAfterCents: 500n,
        idempotencyKey: 'test:credits-2',
      },
    ]);

    const rows = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.membershipId, membership.id));

    expect(rows.map((r) => r.currency).sort()).toEqual(['CASH', 'CREDITS']);
  });

  it('gives every membership a zero credits balance by default', async () => {
    const membership = await makeMembership();

    const [row] = await db
      .select()
      .from(seasonMemberships)
      .where(eq(seasonMemberships.id, membership.id));

    expect(row.creditsBalanceCents).toBe(0n);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/db/__tests__/currency-schema.test.ts`
Expected: FAIL — TypeScript/runtime error that `currency` does not exist on the insert type.

- [ ] **Step 3: Create the currency enum**

Create `src/db/schema/currency.ts`:

```ts
import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Cash is the season bankroll the standings rank. Credits are the separate, granted,
 * non-convertible currency custom events are bet in (D31).
 *
 * This lives in its own file rather than in money.ts because betting.ts needs it too, and
 * money.ts already imports betting.ts — a shared leaf module avoids the cycle.
 */
export const currency = pgEnum('currency', ['CASH', 'CREDITS']);

export type Currency = (typeof currency.enumValues)[number];
```

- [ ] **Step 4: Add the columns**

In `src/db/schema/money.ts`, import the enum and add the column to `ledgerEntries` (after `type`):

```ts
import { currency } from './currency';
// …
    type: ledgerEntryType('type').notNull(),
    currency: currency('currency').notNull().default('CASH'),
```

Also add an index at the bottom of the `ledgerEntries` index list, which reconciliation groups on:

```ts
    index('ledger_entries_membership_currency_idx').on(t.membershipId, t.currency),
```

In `src/db/schema/identity.ts`, add to `seasons`:

```ts
    startingCreditsCents: bigint('starting_credits_cents', { mode: 'bigint' })
      .notNull()
      .default(0n),
    weeklyCreditAllowanceCents: bigint('weekly_credit_allowance_cents', { mode: 'bigint' })
      .notNull()
      .default(0n),
```

and to `seasonMemberships`:

```ts
    creditsBalanceCents: bigint('credits_balance_cents', { mode: 'bigint' })
      .notNull()
      .default(0n),
```

In `src/db/schema/betting.ts`, import `currency` from `./currency` and add to `bets` (after `type`):

```ts
    currency: currency('currency').notNull().default('CASH'),
```

In `src/db/schema/index.ts`, add the export **first**, before the others, so the enum is defined before its consumers:

```ts
export * from './currency';
export * from './identity';
export * from './sports';
export * from './betting';
export * from './money';
export * from './social';
```

- [ ] **Step 5: Generate and apply the migration**

```bash
npm run db:generate
npm run db:migrate:test
```

Open the generated `drizzle/0005_*.sql` and confirm it contains `CREATE TYPE "public"."currency"`, four `ADD COLUMN` statements, and no `DROP`. Defaults are what backfill existing rows: every pre-existing ledger entry becomes `CASH`, which is correct because every entry written before this subsystem was cash.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/db/__tests__/currency-schema.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 7: Verify nothing else broke**

Run: `npm run verify`
Expected: 41 test files, 309 tests, 0 lint errors.

- [ ] **Step 8: Commit**

```bash
git add src/db drizzle
git commit -m "feat: add a currency dimension to the ledger schema"
```

---

### Task 2: `postEntry` moves the currency it is told to

**Files:**

- Modify: `src/server/money/ledger.ts`
- Test: `src/server/money/__tests__/ledger-currency.test.ts`

**Interfaces:**

- Consumes: `Currency` from Task 1.
- Produces: `PostEntryInput` gains `currency?: Currency` (defaults `'CASH'`). `PostEntryResult` unchanged in shape — `balanceCents` is the balance **of the entry's own currency** after the write.

- [ ] **Step 1: Write the failing test**

Create `src/server/money/__tests__/ledger-currency.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { seasonMemberships } from '@/db/schema';
import { postEntry } from '@/server/money/ledger';
import { MoneyError } from '@/server/money/errors';
import { resetDb } from '@/test/db';
import { makeMembership } from '@/test/factories';

async function balances(membershipId: string) {
  const [row] = await db
    .select({
      cash: seasonMemberships.balanceCents,
      credits: seasonMemberships.creditsBalanceCents,
    })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, membershipId));
  return row;
}

describe('postEntry with a currency', () => {
  beforeEach(resetDb);

  it('defaults to cash and leaves credits alone', async () => {
    const membership = await makeMembership(1000n);

    await db.transaction((tx) =>
      postEntry(tx, {
        membershipId: membership.id,
        amountCents: 500n,
        type: 'WEEKLY_ALLOWANCE',
        idempotencyKey: 'k1',
      }),
    );

    expect(await balances(membership.id)).toEqual({ cash: 1500n, credits: 0n });
  });

  it('credits move the credits balance and leave cash alone', async () => {
    const membership = await makeMembership(1000n);

    const result = await db.transaction((tx) =>
      postEntry(tx, {
        membershipId: membership.id,
        amountCents: 700n,
        type: 'SEASON_STARTING_GRANT',
        currency: 'CREDITS',
        idempotencyKey: 'k2',
      }),
    );

    expect(result.balanceCents).toBe(700n);
    expect(await balances(membership.id)).toEqual({ cash: 1000n, credits: 700n });
  });

  it('rejects a credits debit the credits balance cannot absorb, even when cash is rich', async () => {
    const membership = await makeMembership(1_000_000n);

    await expect(
      db.transaction((tx) =>
        postEntry(tx, {
          membershipId: membership.id,
          amountCents: -1n,
          type: 'BET_PLACED',
          currency: 'CREDITS',
          idempotencyKey: 'k3',
        }),
      ),
    ).rejects.toBeInstanceOf(MoneyError);

    expect(await balances(membership.id)).toEqual({ cash: 1_000_000n, credits: 0n });
  });

  it('is still idempotent per key within a currency', async () => {
    const membership = await makeMembership(0n);

    const first = await db.transaction((tx) =>
      postEntry(tx, {
        membershipId: membership.id,
        amountCents: 100n,
        type: 'SEASON_STARTING_GRANT',
        currency: 'CREDITS',
        idempotencyKey: 'k4',
      }),
    );
    const second = await db.transaction((tx) =>
      postEntry(tx, {
        membershipId: membership.id,
        amountCents: 100n,
        type: 'SEASON_STARTING_GRANT',
        currency: 'CREDITS',
        idempotencyKey: 'k4',
      }),
    );

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(await balances(membership.id)).toEqual({ cash: 0n, credits: 100n });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/money/__tests__/ledger-currency.test.ts`
Expected: FAIL — `currency` is not a known property of `PostEntryInput`.

- [ ] **Step 3: Make `postEntry` currency-aware**

Rewrite `src/server/money/ledger.ts`. The whole file, so there is nothing to infer:

```ts
import { eq } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { ledgerEntries, seasonMemberships, type Currency, type LedgerEntryType } from '@/db/schema';
import { MoneyError } from './errors';

const ADMIN_TYPES: ReadonlySet<LedgerEntryType> = new Set(['ADMIN_CREDIT', 'ADMIN_DEBIT']);

export interface PostEntryInput {
  membershipId: string;
  amountCents: bigint;
  type: LedgerEntryType;
  idempotencyKey: string;
  /** Which denomination moves. Defaults to CASH so every existing caller is unchanged. */
  currency?: Currency;
  actorUserId?: string;
  /** The bet this movement belongs to, for BET_PLACED and every settlement entry. */
  betId?: string;
  note?: string;
}

export interface PostEntryResult {
  applied: boolean;
  /** The balance of this entry's own currency after the write. Never the other one. */
  balanceCents: bigint;
  /** The row this call inserted, or null when the idempotency key already existed. */
  entryId: string | null;
}

export async function postEntry(tx: Tx, input: PostEntryInput): Promise<PostEntryResult> {
  if (ADMIN_TYPES.has(input.type) && !input.note?.trim()) {
    throw new MoneyError('NOTE_REQUIRED', `${input.type} requires a note`);
  }

  const currency: Currency = input.currency ?? 'CASH';

  // One lock on the membership row covers both balances, so a cash write and a credits
  // write for the same member still serialize against each other. That is deliberate:
  // two cached columns on one row must not be updated by two racing transactions.
  const [membership] = await tx
    .select({
      balanceCents: seasonMemberships.balanceCents,
      creditsBalanceCents: seasonMemberships.creditsBalanceCents,
    })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, input.membershipId))
    .for('update');

  if (!membership) {
    throw new MoneyError('MEMBERSHIP_NOT_FOUND', `no membership ${input.membershipId}`);
  }

  const current = currency === 'CASH' ? membership.balanceCents : membership.creditsBalanceCents;
  const nextBalance = current + input.amountCents;
  if (nextBalance < 0n) {
    throw new MoneyError(
      'INSUFFICIENT_FUNDS',
      `${currency} balance ${current} cannot absorb ${input.amountCents}`,
    );
  }

  const inserted = await tx
    .insert(ledgerEntries)
    .values({
      membershipId: input.membershipId,
      amountCents: input.amountCents,
      type: input.type,
      currency,
      balanceAfterCents: nextBalance,
      actorUserId: input.actorUserId,
      betId: input.betId,
      note: input.note,
      idempotencyKey: input.idempotencyKey,
    })
    .onConflictDoNothing({ target: ledgerEntries.idempotencyKey })
    .returning({ id: ledgerEntries.id });

  if (inserted.length === 0) {
    return { applied: false, balanceCents: current, entryId: null };
  }

  await tx
    .update(seasonMemberships)
    .set(currency === 'CASH' ? { balanceCents: nextBalance } : { creditsBalanceCents: nextBalance })
    .where(eq(seasonMemberships.id, input.membershipId));

  return { applied: true, balanceCents: nextBalance, entryId: inserted[0].id };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/server/money/__tests__/ledger-currency.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Verify the existing ledger tests are untouched**

Run: `npm run verify`
Expected: 42 files, 313 tests. `src/server/money/__tests__/ledger.test.ts` must pass **unmodified** — the currency parameter defaults to `CASH`, so every existing caller behaves exactly as before. If you had to edit that file, you changed behavior you were not supposed to change.

- [ ] **Step 6: Commit**

```bash
git add src/server/money
git commit -m "feat: post ledger entries in a named currency"
```

---

### Task 3: Reconciliation checks each currency separately

**Files:**

- Modify: `src/server/money/reconcile.ts`
- Test: `src/server/money/__tests__/reconcile-currency.test.ts`

**Interfaces:**

- Consumes: `postEntry`'s currency from Task 2.
- Produces: `Discrepancy` gains `currency: Currency`. `reconcileBalances()` returns one row per drifting `(membership, currency)` pair.

- [ ] **Step 1: Write the failing test**

Create `src/server/money/__tests__/reconcile-currency.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { seasonMemberships } from '@/db/schema';
import { postEntry } from '@/server/money/ledger';
import { reconcileBalances } from '@/server/money/reconcile';
import { resetDb } from '@/test/db';
import { makeMembership } from '@/test/factories';

describe('reconcileBalances per currency', () => {
  beforeEach(resetDb);

  it('reports nothing when both currencies agree with the ledger', async () => {
    const membership = await makeMembership(0n);

    await db.transaction(async (tx) => {
      await postEntry(tx, {
        membershipId: membership.id,
        amountCents: 1000n,
        type: 'SEASON_STARTING_GRANT',
        idempotencyKey: 'c1',
      });
      await postEntry(tx, {
        membershipId: membership.id,
        amountCents: 250n,
        type: 'SEASON_STARTING_GRANT',
        currency: 'CREDITS',
        idempotencyKey: 'c2',
      });
    });

    expect(await reconcileBalances()).toEqual([]);
  });

  it('reports a credits drift while cash reads clean', async () => {
    const membership = await makeMembership(0n);

    await db.transaction(async (tx) => {
      await postEntry(tx, {
        membershipId: membership.id,
        amountCents: 1000n,
        type: 'SEASON_STARTING_GRANT',
        idempotencyKey: 'c3',
      });
      await postEntry(tx, {
        membershipId: membership.id,
        amountCents: 250n,
        type: 'SEASON_STARTING_GRANT',
        currency: 'CREDITS',
        idempotencyKey: 'c4',
      });
    });

    // Corrupt only the credits cache.
    await db
      .update(seasonMemberships)
      .set({ creditsBalanceCents: 999n })
      .where(eq(seasonMemberships.id, membership.id));

    const drift = await reconcileBalances();

    expect(drift).toEqual([
      {
        membershipId: membership.id,
        currency: 'CREDITS',
        cachedCents: 999n,
        ledgerCents: 250n,
      },
    ]);
  });

  it('reports a membership with no credit entries but a non-zero credits cache', async () => {
    const membership = await makeMembership(0n);

    await db
      .update(seasonMemberships)
      .set({ creditsBalanceCents: 5n })
      .where(eq(seasonMemberships.id, membership.id));

    const drift = await reconcileBalances();

    expect(drift).toEqual([
      { membershipId: membership.id, currency: 'CREDITS', cachedCents: 5n, ledgerCents: 0n },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/money/__tests__/reconcile-currency.test.ts`
Expected: FAIL — the returned rows have no `currency` property.

- [ ] **Step 3: Rewrite the reconciliation query**

Replace `src/server/money/reconcile.ts` entirely:

```ts
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import type { Currency } from '@/db/schema';

export interface Discrepancy {
  membershipId: string;
  currency: Currency;
  cachedCents: bigint;
  ledgerCents: bigint;
}

/**
 * Compares each cached balance against the sum of its own currency's ledger entries.
 *
 * The shape is a cross join of every membership against both currencies, rather than a
 * group-by over the entries: a membership with a non-zero cache and *no* entries at all in
 * that currency is exactly the drift most worth catching, and a group-by over entries
 * cannot see it.
 *
 * Written with literal, table-qualified identifiers rather than drizzle's column helpers —
 * the correlated subquery would otherwise resolve both sides against its own FROM (D30).
 */
export async function reconcileBalances(): Promise<Discrepancy[]> {
  const rows = await db.execute<{
    membership_id: string;
    currency: Currency;
    cached_cents: string;
    ledger_cents: string;
  }>(sql`
    SELECT m.id AS membership_id,
           c.currency AS currency,
           CASE c.currency
             WHEN 'CASH' THEN m.balance_cents
             ELSE m.credits_balance_cents
           END AS cached_cents,
           COALESCE((
             SELECT SUM(l.amount_cents)
             FROM ledger_entries l
             WHERE l.membership_id = m.id
               AND l.currency = c.currency
           ), 0) AS ledger_cents
    FROM season_memberships m
    CROSS JOIN (SELECT unnest(enum_range(NULL::currency)) AS currency) c
    WHERE CASE c.currency
            WHEN 'CASH' THEN m.balance_cents
            ELSE m.credits_balance_cents
          END
          <> COALESCE((
            SELECT SUM(l.amount_cents)
            FROM ledger_entries l
            WHERE l.membership_id = m.id
              AND l.currency = c.currency
          ), 0)
    ORDER BY m.id, c.currency
  `);

  return Array.from(rows).map((row) => ({
    membershipId: row.membership_id,
    currency: row.currency,
    cachedCents: BigInt(row.cached_cents),
    ledgerCents: BigInt(row.ledger_cents),
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/server/money/__tests__/reconcile-currency.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Update the existing reconcile test's expectations**

`src/server/money/__tests__/reconcile.test.ts` asserts `Discrepancy` objects without a `currency` field. Add `currency: 'CASH'` to each expected object. Do **not** weaken the assertions to `expect.objectContaining` — the exact shape is the point of the test.

- [ ] **Step 6: Check the cron route still compiles**

`src/app/api/cron/reconcile/route.ts` serializes the result. Read it; if it maps fields explicitly, add `currency`. Run `npm run typecheck` to be sure.

- [ ] **Step 7: Verify**

Run: `npm run verify`
Expected: 43 files, 316 tests, 0 lint errors.

- [ ] **Step 8: Commit**

```bash
git add src/server/money src/app/api/cron/reconcile
git commit -m "feat: reconcile cash and credits balances independently"
```

---

### Task 4: Credits are granted at join, dripped weekly, adjustable by admins

**Files:**

- Modify: `src/server/seasons/service.ts`, `src/server/seasons/allowance.ts`, `src/server/seasons/defaults.ts`, `src/server/admin/adjust.ts`
- Modify: `src/server/feed/payload.ts` (allowance and join payloads gain credit amounts)
- Test: `src/server/seasons/__tests__/credit-grants.test.ts`

**Interfaces:**

- Consumes: `postEntry` currency (Task 2).
- Produces: `createSeason` accepts `startingCreditsCents` / `weeklyCreditAllowanceCents`; `joinSeason` returns `{ membershipId, balanceCents, creditsBalanceCents }`; `adjustBalance` accepts `currency?: Currency`; `AllowancePaidPayload` gains `creditAmountCents: string`; `MemberJoinedPayload` gains `startingCreditsCents: string`.

- [ ] **Step 1: Write the failing test**

Create `src/server/seasons/__tests__/credit-grants.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { ledgerEntries, seasonMemberships } from '@/db/schema';
import { createSeason, joinSeason } from '@/server/seasons/service';
import { payWeeklyAllowance } from '@/server/seasons/allowance';
import { adjustBalance } from '@/server/admin/adjust';
import { resetDb } from '@/test/db';
import { makeUser } from '@/test/factories';

async function activeSeason() {
  const season = await createSeason({
    name: 'Credits season',
    startsAt: new Date('2026-09-01T00:00:00Z'),
    endsAt: new Date('2027-01-31T00:00:00Z'),
    startingBankrollCents: 100_000n,
    weeklyAllowanceCents: 5_000n,
    startingCreditsCents: 20_000n,
    weeklyCreditAllowanceCents: 1_000n,
  });
  await db.update(seasons).set({ status: 'ACTIVE' }).where(eq(seasons.id, season.id));
  return season;
}

describe('credit grants', () => {
  beforeEach(resetDb);

  it('grants both currencies on join, with distinct keys', async () => {
    const season = await activeSeason();
    const user = await makeUser();

    const result = await joinSeason(user.id, season.id);

    expect(result.balanceCents).toBe(100_000n);
    expect(result.creditsBalanceCents).toBe(20_000n);

    const keys = (
      await db
        .select({ key: ledgerEntries.idempotencyKey, currency: ledgerEntries.currency })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.membershipId, result.membershipId))
    ).sort((a, b) => a.key.localeCompare(b.key));

    expect(keys).toEqual([
      { key: `grant:${result.membershipId}`, currency: 'CASH' },
      { key: `grant:${result.membershipId}:credits`, currency: 'CREDITS' },
    ]);
  });

  it('joining twice grants nothing extra', async () => {
    const season = await activeSeason();
    const user = await makeUser();

    await joinSeason(user.id, season.id);
    const second = await joinSeason(user.id, season.id);

    expect(second.balanceCents).toBe(100_000n);
    expect(second.creditsBalanceCents).toBe(20_000n);
  });

  it('pays both allowances in one weekly run and is idempotent', async () => {
    const season = await activeSeason();
    const user = await makeUser();
    const { membershipId } = await joinSeason(user.id, season.id);

    const now = new Date('2026-09-08T12:00:00Z');
    await payWeeklyAllowance(now);
    await payWeeklyAllowance(now);

    const [row] = await db
      .select({
        cash: seasonMemberships.balanceCents,
        credits: seasonMemberships.creditsBalanceCents,
      })
      .from(seasonMemberships)
      .where(eq(seasonMemberships.id, membershipId));

    expect(row).toEqual({ cash: 105_000n, credits: 21_000n });
  });

  it('an admin can adjust credits without touching cash', async () => {
    const season = await activeSeason();
    const user = await makeUser();
    const admin = await makeUser({ role: 'ADMIN' });
    const { membershipId } = await joinSeason(user.id, season.id);

    await adjustBalance({
      membershipId,
      amountCents: -5_000n,
      currency: 'CREDITS',
      note: 'refunding a broken market by hand',
      actorUserId: admin.id,
      idempotencyKey: 'adj:1:credits',
    });

    const [row] = await db
      .select({
        cash: seasonMemberships.balanceCents,
        credits: seasonMemberships.creditsBalanceCents,
      })
      .from(seasonMemberships)
      .where(eq(seasonMemberships.id, membershipId));

    expect(row).toEqual({ cash: 100_000n, credits: 15_000n });

    const [entry] = await db
      .select()
      .from(ledgerEntries)
      .where(
        and(eq(ledgerEntries.membershipId, membershipId), eq(ledgerEntries.type, 'ADMIN_DEBIT')),
      );
    expect(entry.currency).toBe('CREDITS');
  });
});
```

Add the missing import at the top of the file: `import { seasons } from '@/db/schema';` — merge it into the existing `@/db/schema` import line.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/seasons/__tests__/credit-grants.test.ts`
Expected: FAIL — `startingCreditsCents` is not accepted by `createSeason`.

- [ ] **Step 3: Add the defaults**

In `src/server/seasons/defaults.ts`, add beside the existing constants:

```ts
/**
 * Credits are a smaller economy than cash on purpose — a custom market is a side bet.
 *
 * These are CENTS, like every other amount in this codebase (D17). A member starts a season
 * with 1,000.00 credits against a 10,000.00 cash bankroll, and is dripped 100.00 credits a
 * week against 500.00 cash. Do not "fix" these to look like the numbers they render as.
 */
export const DEFAULT_STARTING_CREDITS_CENTS = 100_000n; // 1,000.00 credits
export const DEFAULT_WEEKLY_CREDIT_ALLOWANCE_CENTS = 10_000n; // 100.00 credits
```

With `MIN_STAKE_CENTS` at `100n` (1.00), a starting balance of 1,000.00 credits is a real bankroll rather than a token — a member can take a meaningful position on several events before the weekly drip matters.

- [ ] **Step 4: Grant credits on season creation and join**

In `src/server/seasons/service.ts`, extend `CreateSeasonInput` with `startingCreditsCents?: bigint` and `weeklyCreditAllowanceCents?: bigint`, and pass them into the insert with the new defaults.

Then, in `joinSeason`, after the existing cash grant, add the credits grant and widen the return:

```ts
const result = await postEntry(tx, {
  membershipId: membership.id,
  amountCents: season.startingBankrollCents,
  type: 'SEASON_STARTING_GRANT',
  idempotencyKey: `grant:${membership.id}`,
});

// Credits are granted, never bought (D31). Same transaction, distinct key, so a
// replayed join grants neither currency twice.
const credits = await postEntry(tx, {
  membershipId: membership.id,
  amountCents: season.startingCreditsCents,
  type: 'SEASON_STARTING_GRANT',
  currency: 'CREDITS',
  idempotencyKey: `grant:${membership.id}:credits`,
});

if (result.applied) {
  await emitFeedEvent(tx, {
    seasonId,
    type: 'MEMBER_JOINED',
    subjectMembershipId: membership.id,
    dedupeKey: `membership:${membership.id}:joined`,
    payload: {
      startingBankrollCents: season.startingBankrollCents.toString(),
      startingCreditsCents: season.startingCreditsCents.toString(),
    },
    occurredAt: membership.joinedAt,
  });
}

return {
  membershipId: membership.id,
  balanceCents: result.balanceCents,
  creditsBalanceCents: credits.balanceCents,
};
```

Update `JoinSeasonResult` to include `creditsBalanceCents: bigint`.

- [ ] **Step 5: Pay the weekly credit drip**

In `src/server/seasons/allowance.ts`, replace the body of the membership loop so both entries post in one transaction:

```ts
for (const membership of memberships) {
  const result = await db.transaction(async (tx) => {
    const cash = await postEntry(tx, {
      membershipId: membership.id,
      amountCents: season.weeklyAllowanceCents,
      type: 'WEEKLY_ALLOWANCE',
      idempotencyKey: `allowance:${membership.id}:${weekKey}`,
    });
    await postEntry(tx, {
      membershipId: membership.id,
      amountCents: season.weeklyCreditAllowanceCents,
      type: 'WEEKLY_ALLOWANCE',
      currency: 'CREDITS',
      idempotencyKey: `allowance:${membership.id}:${weekKey}:credits`,
    });
    return cash;
  });
  if (result.applied) credited += 1;
  else skipped += 1;
}
```

`credited` / `skipped` continue to count the cash entry only — one number per member, not two, which is what the aggregated card reports.

Then widen the card's payload:

```ts
      payload: {
        weekKey,
        memberCount: memberships.length,
        amountCents: season.weeklyAllowanceCents.toString(),
        creditAmountCents: season.weeklyCreditAllowanceCents.toString(),
      },
```

- [ ] **Step 6: Let admins adjust either currency**

In `src/server/admin/adjust.ts`, add `currency?: Currency` to `AdjustBalanceInput`, pass it through to `postEntry`, and add it to the feed payload as `currency: input.currency ?? 'CASH'`.

**Skip `detectLeadChange` for credit adjustments** — the lead is a cash concept:

```ts
// The lead means the standings, and the standings are cash (D31). A credits adjustment
// cannot reorder them, so there is nothing to detect.
if (result.applied && result.seasonId && (input.currency ?? 'CASH') === 'CASH') {
  await detectLeadChange(result.seasonId);
}
```

- [ ] **Step 7: Widen the payload types**

In `src/server/feed/payload.ts`:

```ts
export interface MemberJoinedPayload {
  startingBankrollCents: string;
  startingCreditsCents: string;
}

export interface AllowancePaidPayload {
  weekKey: string;
  memberCount: number;
  amountCents: string;
  creditAmountCents: string;
}

export interface AdminAdjustmentPayload {
  amountCents: string;
  note: string;
  adminDisplayName: string;
  currency: 'CASH' | 'CREDITS';
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run src/server/seasons/__tests__/credit-grants.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 9: Fix the fallout in existing tests**

Existing tests that assert on join, allowance, or adjustment payloads will now see the extra fields. Update their expected objects to include the new keys with the right values. Existing seasons created without credit fields default both to `0n`, so a season that never asked for credits grants none — check that any test asserting an exact ledger-entry count for a join now expects **two** entries where credits are configured and still **one** where they are not (a zero-amount grant still writes a row, so decide by reading the code you wrote in Step 4: `postEntry` is called unconditionally, therefore two rows always, the second for `0n`).

Fix it by making the credits grant conditional, which is the behavior the tests should assert:

```ts
const credits =
  season.startingCreditsCents > 0n
    ? await postEntry(tx, {
        membershipId: membership.id,
        amountCents: season.startingCreditsCents,
        type: 'SEASON_STARTING_GRANT',
        currency: 'CREDITS',
        idempotencyKey: `grant:${membership.id}:credits`,
      })
    : { applied: false as const, balanceCents: 0n, entryId: null };
```

Apply the same `> 0n` guard to the weekly credit drip. A zero-credit season writes no credit rows at all.

- [ ] **Step 10: Verify**

Run: `npm run verify`
Expected: 44 files, 320 tests, 0 lint errors.

- [ ] **Step 11: Commit**

```bash
git add src/server docs
git commit -m "feat: grant, drip and adjust credits alongside cash"
```

---

### Task 5: The `events` supertype, added and backfilled

**Files:**

- Create: `src/db/schema/events.ts`
- Modify: `src/db/schema/sports.ts`, `src/db/schema/index.ts`, `src/test/db.ts`, `src/server/bets/__tests__/helpers.ts`
- Create: `drizzle/0006_*.sql` (generated, then hand-edited for the backfill)
- Test: `src/db/__tests__/events-supertype.test.ts`

**Interfaces:**

- Consumes: nothing from Tasks 1–4.
- Produces: `events` table with `eventKind` pgEnum (`'GAME' | 'CUSTOM'`) and `type EventKind`; `games.eventId` (`NOT NULL`, unique); `markets.eventId` (**nullable in this task**, populated for every existing row).

This task adds the new structure and fills it in. It changes **no query** — `markets.game_id` is still the column every read uses. That is what makes it independently committable.

- [ ] **Step 1: Write the failing test**

Create `src/db/__tests__/events-supertype.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { events, games, markets } from '@/db/schema';
import { resetDb } from '@/test/db';
import { makeMarket, seedBettableGame } from '@/server/bets/__tests__/helpers';

describe('events supertype', () => {
  beforeEach(resetDb);

  it('gives every game exactly one GAME event', async () => {
    const { game } = await seedBettableGame();

    const [row] = await db.select().from(games).where(eq(games.id, game.id));
    expect(row.eventId).toBeTruthy();

    const [event] = await db.select().from(events).where(eq(events.id, row.eventId));
    expect(event.kind).toBe('GAME');
    expect(event.startsAt.getTime()).toBe(game.startsAt.getTime());
    expect(event.title).toMatch(/ @ /);
  });

  it('points a market at the same event as its game', async () => {
    const game = (await seedBettableGame()).game;
    const market = await makeMarket(game.id, 'MONEYLINE');

    const [gameRow] = await db.select().from(games).where(eq(games.id, game.id));
    const [marketRow] = await db.select().from(markets).where(eq(markets.id, market.id));

    expect(marketRow.eventId).toBe(gameRow.eventId);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/db/__tests__/events-supertype.test.ts`
Expected: FAIL — `events` is not exported from `@/db/schema`.

- [ ] **Step 3: Define the schema**

Create `src/db/schema/events.ts`:

```ts
import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const eventKind = pgEnum('event_kind', ['GAME', 'CUSTOM']);

export type EventKind = (typeof eventKind.enumValues)[number];

/**
 * The supertype every market hangs off (D33).
 *
 * Deliberately thin, and deliberately without a status column: `games` and `custom_events`
 * each own their own lifecycle, so there is no polymorphic status that could be read wrong
 * or drift out of agreement with its subtype. `title` exists only so a polymorphic read has
 * something to render without knowing which subtype it is looking at — the sports feed
 * snapshot still builds its richer description from `teams`.
 */
export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: eventKind('kind').notNull(),
    title: text('title').notNull(),
    /** When betting closes. Kickoff for a game; the creator's close time for a custom event. */
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('events_kind_starts_at_idx').on(t.kind, t.startsAt)],
);
```

In `src/db/schema/sports.ts`, add to `games`:

```ts
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
```

and its unique index in the `games` index list:

```ts
    uniqueIndex('games_event_idx').on(t.eventId),
```

and to `markets`, **nullable for now** (Task 6 tightens it):

```ts
    eventId: uuid('event_id').references(() => events.id),
```

Import `events` at the top of `sports.ts`: `import { events } from './events';`

In `src/db/schema/index.ts`, export `./events` immediately after `./currency` (it must come before `./sports`, which now references it).

- [ ] **Step 4: Generate the migration and hand-edit the backfill**

```bash
npm run db:generate
```

Drizzle will emit `ALTER TABLE "games" ADD COLUMN "event_id" uuid NOT NULL`, which fails against any existing row. Open the generated `drizzle/0006_*.sql` and replace the `games`/`markets` portion with this, keeping the `CREATE TYPE` and `CREATE TABLE "events"` statements drizzle generated above it:

```sql
--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "event_id" uuid;--> statement-breakpoint
UPDATE "games" SET "event_id" = gen_random_uuid() WHERE "event_id" IS NULL;--> statement-breakpoint
INSERT INTO "events" ("id", "kind", "title", "starts_at", "created_at")
SELECT g."event_id",
       'GAME',
       away."abbreviation" || ' @ ' || home."abbreviation",
       g."starts_at",
       g."created_at"
FROM "games" g
JOIN "teams" home ON home."id" = g."home_team_id"
JOIN "teams" away ON away."id" = g."away_team_id";--> statement-breakpoint
ALTER TABLE "games" ALTER COLUMN "event_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_event_id_events_id_fk"
  FOREIGN KEY ("event_id") REFERENCES "public"."events"("id")
  ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "games_event_idx" ON "games" USING btree ("event_id");--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "event_id" uuid;--> statement-breakpoint
UPDATE "markets" m SET "event_id" = g."event_id" FROM "games" g WHERE g."id" = m."game_id";--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_event_id_events_id_fk"
  FOREIGN KEY ("event_id") REFERENCES "public"."events"("id")
  ON DELETE no action ON UPDATE no action;
```

Do **not** hand-edit `drizzle/meta/*` — the snapshot drizzle generated already describes the end state, which is what the next `db:generate` diffs against. Only the SQL needed rewriting, because drizzle cannot know how to fill a column it just created.

Apply it:

```bash
npm run db:migrate:test
```

- [ ] **Step 5: Teach the test factory to create the event**

Every insert into `games` now needs an `event_id`. In `src/server/bets/__tests__/helpers.ts`, rewrite `makeGame`:

```ts
export async function makeGame(overrides: Partial<typeof games.$inferInsert> = {}) {
  const n = next();
  const home = await makeTeam();
  const away = await makeTeam();
  const startsAt = overrides.startsAt ?? new Date(Date.now() + 86_400_000);

  const [event] = await db
    .insert(events)
    .values({
      kind: 'GAME',
      title: `${away.abbreviation} @ ${home.abbreviation}`,
      startsAt,
    })
    .returning();

  const [game] = await db
    .insert(games)
    .values({
      sport: 'NFL',
      externalId: `game-${n}`,
      homeTeamId: home.id,
      awayTeamId: away.id,
      seasonYear: 2026,
      week: 1,
      status: 'SCHEDULED',
      ...overrides,
      startsAt,
      eventId: event.id,
    })
    .returning();
  return game;
}
```

Note the ordering: `...overrides` comes before `startsAt` and `eventId` so a caller can override the start time (several tests do) while `eventId` can never be clobbered, and the event and the game always agree on `startsAt`.

Also update `makeMarket` to carry the event id through:

```ts
export async function makeMarket(
  gameId: string,
  type: MarketTypeValue = 'MONEYLINE',
  overrides: Partial<typeof markets.$inferInsert> = {},
) {
  const [game] = await db
    .select({ eventId: games.eventId })
    .from(games)
    .where(eq(games.id, gameId));
  const [market] = await db
    .insert(markets)
    .values({
      gameId,
      eventId: game.eventId,
      type,
      sourceBook: 'draftkings',
      status: 'OPEN',
      ...overrides,
    })
    .returning();
  return market;
}
```

Add `events` to the `@/db/schema` import at the top of the file.

- [ ] **Step 6: Truncate the new table between tests**

In `src/test/db.ts`, add `events` to the `TRUNCATE` list, after `games`:

```ts
    sql`TRUNCATE TABLE feed_reactions, feed_comments, feed_events, feed_preferences, ledger_entries, bet_legs, bets, odds_snapshots, selections, markets, games, events, teams, season_memberships, seasons, users RESTART IDENTITY CASCADE`,
```

- [ ] **Step 7: Fix any other direct `games` inserts**

Run: `grep -rn "insert(games)" src`
Every hit outside `helpers.ts` needs the same treatment — create an event, pass `eventId`. Check `src/db/seed.ts` and `src/server/odds/sync.ts` (which upserts games from the provider). For `sync.ts`, insert the event first inside the same transaction and pass its id; the title is `${awayAbbr} @ ${homeAbbr}` exactly as the backfill wrote it.

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run src/db/__tests__/events-supertype.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 9: Verify**

Run: `npm run verify`
Expected: 45 files, 322 tests, 0 lint errors. Every pre-existing test still passes — no query changed in this task.

- [ ] **Step 10: Commit**

```bash
git add src drizzle
git commit -m "feat: add the events supertype and backfill one event per game"
```

---

### Task 6: Every read goes through `markets.event_id`

**Files:**

- Modify: `src/server/bets/place.ts`, `src/server/bets/settle.ts`, `src/server/bets/resettle.ts`, `src/server/odds/sync.ts`, `src/server/odds/board.ts`, `src/app/(app)/bets/page.tsx`
- Modify: `src/db/schema/sports.ts` (`markets.eventId` becomes `NOT NULL`, `game_id` dropped)
- Modify tests: `src/server/__tests__/end-to-end.test.ts`, `src/server/bets/__tests__/settle.test.ts`, `src/server/bets/__tests__/settle-void.test.ts`, `src/server/odds/__tests__/sync.test.ts`
- Create: `drizzle/0007_*.sql` (generated)

**Interfaces:**

- Consumes: `markets.eventId` from Task 5.
- Produces: `markets.gameId` no longer exists. Every join from a market to a game goes `markets.eventId → games.eventId`.

- [ ] **Step 1: Find every reference**

Run: `grep -rn "markets.gameId\|markets\.game_id" src`

Expect hits in exactly these files: `place.ts`, `settle.ts`, `resettle.ts`, `sync.ts`, `board.ts`, `bets/page.tsx`, and four test files. Work through them in that order.

- [ ] **Step 2: Switch the joins**

The mechanical change is always the same. Wherever a query reads

```ts
    .innerJoin(games, eq(markets.gameId, games.id))
```

it becomes

```ts
    .innerJoin(games, eq(markets.eventId, games.eventId))
```

`games.eventId` is unique, so this is the same one-row join it was before.

The three non-mechanical spots:

**`settle.ts:76`** — the pending-legs query filters `eq(markets.gameId, gameId)`. It becomes a join through the game's event:

```ts
const pending = await tx
  .select({
    legId: betLegs.id,
    betId: betLegs.betId,
    line: betLegs.lineAtPlacement,
    marketType: markets.type,
    side: selections.side,
  })
  .from(betLegs)
  .innerJoin(selections, eq(betLegs.selectionId, selections.id))
  .innerJoin(markets, eq(selections.marketId, markets.id))
  .where(and(eq(markets.eventId, game.eventId), eq(betLegs.status, 'PENDING')));
```

`game` is already loaded and locked at the top of `settleGame`, so `game.eventId` is in hand.

**`settle.ts:251`** — the market close-out becomes:

```ts
await tx.update(markets).set({ status: 'SETTLED' }).where(eq(markets.eventId, game.eventId));
```

**`settle.ts:302`** — the candidate sweep joins games to markets:

```ts
    .innerJoin(markets, eq(markets.eventId, games.eventId))
```

**`sync.ts:123`** — the market upsert's conflict target changes column:

```ts
        target: [markets.eventId, markets.type],
```

- [ ] **Step 3: Run the tests and fix the fallout**

Run: `npm test`

Test files that insert markets directly with `gameId` need `eventId` instead (or as well — the column still exists until Step 5). Prefer routing them through the `makeMarket` helper you fixed in Task 5.

- [ ] **Step 4: Verify before the schema tightens**

Run: `npm run verify`
Expected: all green. **Do not proceed until it is** — the next step removes the fallback column, and a missed reference becomes a runtime failure instead of a type error.

- [ ] **Step 5: Tighten the schema**

In `src/db/schema/sports.ts`, make `markets.eventId` required and delete `gameId` and the old index:

```ts
export const markets = pgTable(
  'markets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    type: marketType('type').notNull(),
    sourceBook: text('source_book').notNull(),
    status: marketStatus('status').notNull().default('OPEN'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('markets_event_type_idx').on(t.eventId, t.type)],
);
```

Then:

```bash
npm run db:generate
npm run db:migrate:test
```

Confirm the generated SQL drops `game_id` and the old `markets_game_type_idx`, and creates `markets_event_type_idx`.

- [ ] **Step 6: Verify**

Run: `npm run verify`
Expected: 45 files, 322 tests, 0 lint errors — the same counts as Task 5. This task adds no tests; its correctness is that every existing test still passes against a schema that no longer has the column they used to depend on.

- [ ] **Step 7: Commit**

```bash
git add src drizzle
git commit -m "refactor: point markets at events and drop markets.game_id"
```

---

### Task 7: Custom event tables and the outcome market shape

**Files:**

- Modify: `src/db/schema/events.ts` (add `custom_events`, `custom_event_disputes`)
- Modify: `src/db/schema/sports.ts` (`markets.title`, `winning_selection_id`, nullable `source_book`, `CUSTOM_OUTCOME`; `selections.label`, `sort_order`, nullable `side`)
- Modify: `src/db/schema/index.ts`, `src/test/db.ts`, `src/server/odds/sync.ts`
- Create: `drizzle/0008_*.sql` (generated, hand-edited for the partial indexes)
- Test: `src/db/__tests__/custom-events-schema.test.ts`

**Interfaces:**

- Consumes: `events` from Task 5.
- Produces: `customEvents` table with `customEventStatus` pgEnum (`'OPEN' | 'RESOLVED' | 'VOIDED'`); `customEventDisputes` table; `markets.title`, `markets.winningSelectionId`; `selections.label`, `selections.sortOrder`; `marketType` gains `'CUSTOM_OUTCOME'`.

- [ ] **Step 1: Write the failing test**

Create `src/db/__tests__/custom-events-schema.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { customEvents, events, markets, selections } from '@/db/schema';
import { resetDb } from '@/test/db';
import { makeMembership } from '@/server/bets/__tests__/helpers';

async function seedCustomEvent() {
  const { membership } = await makeMembership();

  const [event] = await db
    .insert(events)
    .values({
      kind: 'CUSTOM',
      title: 'Jyxnzi Cup',
      startsAt: new Date(Date.now() + 86_400_000),
    })
    .returning();

  const [custom] = await db
    .insert(customEvents)
    .values({
      eventId: event.id,
      seasonId: membership.seasonId,
      creatorMembershipId: membership.id,
      resolvesBy: new Date(Date.now() + 7 * 86_400_000),
    })
    .returning();

  return { event, custom, membership };
}

describe('custom events schema', () => {
  beforeEach(resetDb);

  it('opens with status OPEN and no resolution', async () => {
    const { custom } = await seedCustomEvent();

    expect(custom.status).toBe('OPEN');
    expect(custom.resolvedAt).toBeNull();
    expect(custom.resolutionAttempts).toBe(0);
  });

  it('holds many CUSTOM_OUTCOME markets on one event', async () => {
    const { event } = await seedCustomEvent();

    await db.insert(markets).values([
      { eventId: event.id, type: 'CUSTOM_OUTCOME', title: 'Who wins the cup?' },
      { eventId: event.id, type: 'CUSTOM_OUTCOME', title: 'Who wins map 3?' },
    ]);

    const rows = await db.select().from(markets).where(eq(markets.eventId, event.id));
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.sourceBook === null)).toBe(true);
  });

  it('stores labelled outcomes with no side and no line', async () => {
    const { event } = await seedCustomEvent();

    const [market] = await db
      .insert(markets)
      .values({ eventId: event.id, type: 'CUSTOM_OUTCOME', title: 'Who wins map 3?' })
      .returning();

    await db.insert(selections).values([
      { marketId: market.id, label: 'Falcons', priceAmerican: -150, sortOrder: 0 },
      { marketId: market.id, label: 'Ravens', priceAmerican: 130, sortOrder: 1 },
    ]);

    const rows = await db
      .select()
      .from(selections)
      .where(eq(selections.marketId, market.id))
      .orderBy(selections.sortOrder);

    expect(rows.map((r) => r.label)).toEqual(['Falcons', 'Ravens']);
    expect(rows.every((r) => r.side === null && r.line === null)).toBe(true);
  });

  it('rejects two outcomes with the same label in one market', async () => {
    const { event } = await seedCustomEvent();
    const [market] = await db
      .insert(markets)
      .values({ eventId: event.id, type: 'CUSTOM_OUTCOME', title: 'Who wins?' })
      .returning();

    await db
      .insert(selections)
      .values({ marketId: market.id, label: 'Falcons', priceAmerican: -150 });

    await expect(
      db.insert(selections).values({ marketId: market.id, label: 'Falcons', priceAmerican: 100 }),
    ).rejects.toThrow();
  });

  it('still rejects two sports selections on the same side of one market', async () => {
    const { event } = await seedCustomEvent();
    const [market] = await db
      .insert(markets)
      .values({ eventId: event.id, type: 'MONEYLINE', sourceBook: 'draftkings' })
      .returning();

    await db.insert(selections).values({ marketId: market.id, side: 'HOME', priceAmerican: -110 });

    await expect(
      db.insert(selections).values({ marketId: market.id, side: 'HOME', priceAmerican: -120 }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/db/__tests__/custom-events-schema.test.ts`
Expected: FAIL — `customEvents` is not exported.

- [ ] **Step 3: Add the tables**

Append to `src/db/schema/events.ts`:

```ts
import {
  integer,
  text as pgText,
  timestamp as pgTimestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { seasonMemberships, seasons, users } from './identity';

export const customEventStatus = pgEnum('custom_event_status', ['OPEN', 'RESOLVED', 'VOIDED']);

export type CustomEventStatus = (typeof customEventStatus.enumValues)[number];

/**
 * The member-created half of the supertype.
 *
 * `resolutionAttempts` is `bets.settlement_attempts` under another name and for the same
 * reason: a disputed re-resolution must write idempotency keys that cannot collide with the
 * original payout's (D35).
 *
 * There is no `overdue` column. Overdue is `status = 'OPEN' AND resolves_by < now()` — a
 * stored flag would be a third state that can disagree with the clock (D37).
 */
export const customEvents = pgTable(
  'custom_events',
  {
    eventId: uuid('event_id')
      .primaryKey()
      .references(() => events.id),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => seasons.id),
    creatorMembershipId: uuid('creator_membership_id')
      .notNull()
      .references(() => seasonMemberships.id),
    description: text('description'),
    resolvesBy: timestamp('resolves_by', { withTimezone: true }).notNull(),
    status: customEventStatus('status').notNull().default('OPEN'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedByUserId: uuid('resolved_by_user_id').references(() => users.id),
    resolutionNote: text('resolution_note'),
    resolutionAttempts: integer('resolution_attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('custom_events_season_status_idx').on(t.seasonId, t.status),
    // The overdue sweep runs every ten minutes forever; the partial index keeps it off the
    // resolved bulk of the table, the same way bet_legs_pending_idx does for settlement.
    index('custom_events_overdue_idx')
      .on(t.resolvesBy)
      .where(sql`${t.status} = 'OPEN'`),
    index('custom_events_creator_idx').on(t.creatorMembershipId),
  ],
);

/**
 * A dispute is state, so it is a table — not a feed row read back out. The feed card is the
 * announcement; this row is what the admin queue queries.
 */
export const customEventDisputes = pgTable(
  'custom_event_disputes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => seasonMemberships.id),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set when an admin re-resolves or voids. Null means still open. */
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('custom_event_disputes_unique_idx').on(t.eventId, t.membershipId),
    index('custom_event_disputes_open_idx')
      .on(t.eventId)
      .where(sql`${t.resolvedAt} IS NULL`),
  ],
);
```

Clean up the imports at the top of the file so `index`, `integer`, `pgEnum`, `pgTable`, `text`, `timestamp`, `uniqueIndex`, `uuid` and `sql` are each imported once — the snippet above lists what it needs, not a second import block to paste verbatim.

- [ ] **Step 4: Widen markets and selections**

In `src/db/schema/sports.ts`:

```ts
export const marketType = pgEnum('market_type', ['MONEYLINE', 'SPREAD', 'TOTAL', 'CUSTOM_OUTCOME']);
```

`markets` gains two columns and loses a `notNull`:

```ts
    /** The question, for CUSTOM_OUTCOME markets. Null for sports markets. */
    title: text('title'),
    /** Null for a hand-priced member market — there is no book behind it. */
    sourceBook: text('source_book'),
    /** Set at resolution. What makes custom grading a pure function of stored values. */
    winningSelectionId: uuid('winning_selection_id'),
```

`winningSelectionId` is deliberately **not** declared with `.references(() => selections.id)` in Drizzle: `selections` is defined below `markets` in this file and references it back, and a declared circular FK makes drizzle-kit emit the two tables in an order Postgres rejects. Add the constraint by hand in the migration instead (Step 5).

`selections` gains:

```ts
    side: selectionSide('side'),
    /** The outcome name for a custom market ("Falcons"). Null for sports selections. */
    label: text('label'),
    sortOrder: smallint('sort_order').notNull().default(0),
```

and its index list becomes:

```ts
  (t) => [
    uniqueIndex('selections_market_side_idx')
      .on(t.marketId, t.side)
      .where(sql`${t.side} IS NOT NULL`),
    uniqueIndex('selections_market_label_idx')
      .on(t.marketId, t.label)
      .where(sql`${t.label} IS NOT NULL`),
  ],
```

Import `sql` from `drizzle-orm` at the top of `sports.ts` if it is not already there.

Finally, the markets unique index becomes partial, because one custom event carries many `CUSTOM_OUTCOME` markets:

```ts
  (t) => [
    uniqueIndex('markets_event_type_idx')
      .on(t.eventId, t.type)
      .where(sql`${t.type} <> 'CUSTOM_OUTCOME'`),
  ],
```

- [ ] **Step 5: Generate the migration and add the by-hand constraint**

```bash
npm run db:generate
```

Read the generated SQL. Confirm it contains the two new tables, the `CUSTOM_OUTCOME` enum value, the three partial unique/regular indexes with their `WHERE` clauses, and `ALTER TABLE "markets" ALTER COLUMN "source_book" DROP NOT NULL`. Then append the foreign key drizzle could not declare:

```sql
--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_winning_selection_id_selections_id_fk"
  FOREIGN KEY ("winning_selection_id") REFERENCES "public"."selections"("id")
  ON DELETE no action ON UPDATE no action;
```

Apply it:

```bash
npm run db:migrate:test
```

- [ ] **Step 6: Fix the odds sync upsert against a partial index**

`src/server/odds/sync.ts` upserts markets with `onConflictDoUpdate({ target: [markets.eventId, markets.type], … })`. Postgres cannot infer a **partial** unique index from a bare column list — it needs the same predicate. Add `targetWhere`:

```ts
      .onConflictDoUpdate({
        target: [markets.eventId, markets.type],
        targetWhere: sql`${markets.type} <> 'CUSTOM_OUTCOME'`,
        set: { /* unchanged */ },
      })
```

Without this the upsert fails at runtime with `there is no unique or exclusion constraint matching the ON CONFLICT specification`, and it fails only when the sync runs — not at typecheck. `src/server/odds/__tests__/sync.test.ts` is what catches it, so run that file specifically after the change.

- [ ] **Step 7: Truncate the new tables**

In `src/test/db.ts`, add `custom_event_disputes, custom_events` to the `TRUNCATE` list, before `events`.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/db/__tests__/custom-events-schema.test.ts src/server/odds/__tests__/sync.test.ts`
Expected: PASS, 5 new tests plus the existing sync tests.

- [ ] **Step 9: Verify**

Run: `npm run verify`
Expected: 46 files, 327 tests, 0 lint errors.

- [ ] **Step 10: Commit**

```bash
git add src drizzle
git commit -m "feat: add custom event tables and the N-way outcome market shape"
```

---

### Task 8: Pure grading and currency derivation

**Files:**

- Create: `src/domain/custom-grading.ts`
- Test: `src/domain/__tests__/custom-grading.test.ts`

**Interfaces:**

- Consumes: nothing — pure functions, no I/O, no database.
- Produces:
  - `gradeCustomLeg(input: { selectionId: string; winningSelectionId: string | null }): 'WON' | 'LOST' | 'PENDING'`
  - `currencyForKinds(kinds: EventKind[]): { ok: true; currency: Currency } | { ok: false; gameIndexes: number[]; customIndexes: number[] }`

- [ ] **Step 1: Write the failing test**

Create `src/domain/__tests__/custom-grading.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { currencyForKinds, gradeCustomLeg } from '@/domain/custom-grading';

describe('gradeCustomLeg', () => {
  it('grades the winning selection WON', () => {
    expect(gradeCustomLeg({ selectionId: 'a', winningSelectionId: 'a' })).toBe('WON');
  });

  it('grades any other selection LOST', () => {
    expect(gradeCustomLeg({ selectionId: 'b', winningSelectionId: 'a' })).toBe('LOST');
  });

  it('grades PENDING while the market is unresolved', () => {
    expect(gradeCustomLeg({ selectionId: 'a', winningSelectionId: null })).toBe('PENDING');
  });
});

describe('currencyForKinds', () => {
  it('is CASH for an all-game slip', () => {
    expect(currencyForKinds(['GAME', 'GAME'])).toEqual({ ok: true, currency: 'CASH' });
  });

  it('is CREDITS for an all-custom slip', () => {
    expect(currencyForKinds(['CUSTOM'])).toEqual({ ok: true, currency: 'CREDITS' });
  });

  it('rejects a mixed slip and reports both index lists', () => {
    expect(currencyForKinds(['GAME', 'CUSTOM', 'GAME'])).toEqual({
      ok: false,
      gameIndexes: [0, 2],
      customIndexes: [1],
    });
  });

  it('throws on an empty leg list', () => {
    expect(() => currencyForKinds([])).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/domain/__tests__/custom-grading.test.ts`
Expected: FAIL — cannot resolve `@/domain/custom-grading`.

- [ ] **Step 3: Write the implementation**

Create `src/domain/custom-grading.ts`:

```ts
import type { Currency, EventKind } from '@/db/schema';

/**
 * Grades one leg of a member-created market.
 *
 * A custom market has exactly one winning outcome, so grading is an identity comparison
 * against a stored value — never a computation over a result. That is the same discipline
 * `line_at_placement` enforces for spreads (D10), and it is what keeps this function pure
 * and exhaustively testable without a database.
 *
 * There is no PUSHED: an N-way market cannot tie. A market that should not have graded at
 * all is VOIDED by the void path, not by this function.
 */
export function gradeCustomLeg(input: {
  selectionId: string;
  winningSelectionId: string | null;
}): 'WON' | 'LOST' | 'PENDING' {
  if (input.winningSelectionId === null) return 'PENDING';
  return input.selectionId === input.winningSelectionId ? 'WON' : 'LOST';
}

export type CurrencyForKindsResult =
  { ok: true; currency: Currency } | { ok: false; gameIndexes: number[]; customIndexes: number[] };

/**
 * Derives the currency a slip must be placed in, from the kinds of its legs.
 *
 * Games are cash, custom events are credits, and a bet carries one stake in one currency —
 * so a mixed slip is not a rule this code enforces so much as a shape the money model
 * cannot represent (D31). Both index lists come back so the UI can point at the offending
 * legs rather than saying "something is wrong".
 */
export function currencyForKinds(kinds: EventKind[]): CurrencyForKindsResult {
  if (kinds.length === 0) throw new Error('a bet needs at least one leg');

  const gameIndexes: number[] = [];
  const customIndexes: number[] = [];

  kinds.forEach((kind, i) => {
    if (kind === 'GAME') gameIndexes.push(i);
    else customIndexes.push(i);
  });

  if (gameIndexes.length > 0 && customIndexes.length > 0) {
    return { ok: false, gameIndexes, customIndexes };
  }

  return { ok: true, currency: gameIndexes.length > 0 ? 'CASH' : 'CREDITS' };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/domain/__tests__/custom-grading.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Verify**

Run: `npm run verify`
Expected: 47 files, 334 tests, 0 lint errors.

- [ ] **Step 6: Commit**

```bash
git add src/domain
git commit -m "feat: add pure custom-market grading and currency derivation"
```

---

### Task 9: Feed vocabulary for custom events

**Files:**

- Modify: `src/db/schema/social.ts` (five new `feed_event_type` values)
- Modify: `src/server/feed/payload.ts`, `src/server/feed/snapshot.ts`
- Create: `drizzle/0009_*.sql` (generated)
- Test: `src/server/feed/__tests__/custom-snapshot.test.ts`

**Interfaces:**

- Consumes: nothing from Tasks 5–8 at runtime; it is the vocabulary the next six tasks emit into.
- Produces: `FeedEventType` gains `'CUSTOM_EVENT_CREATED' | 'CUSTOM_EVENT_RESOLVED' | 'CUSTOM_EVENT_DISPUTED' | 'CUSTOM_EVENT_VOIDED' | 'CUSTOM_EVENT_OVERDUE'`; `FeedLegSnapshot` becomes a discriminated union; `BetPlacedPayload`/`BetSettledPayload` gain `currency`; `buildCustomLegSnapshot(source, frozen)`.

- [ ] **Step 1: Write the failing test**

Create `src/server/feed/__tests__/custom-snapshot.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildCustomLegSnapshot } from '@/server/feed/snapshot';

describe('buildCustomLegSnapshot', () => {
  const startsAt = new Date('2026-09-12T23:00:00Z');

  it('freezes the event and outcome text and the placed price', () => {
    const snapshot = buildCustomLegSnapshot(
      {
        eventTitle: 'Jyxnzi Cup',
        marketTitle: 'Who wins map 3?',
        outcomeLabel: 'Falcons',
        startsAt,
        byCreator: false,
      },
      { priceAmerican: -150 },
    );

    expect(snapshot).toEqual({
      kind: 'CUSTOM',
      eventTitle: 'Jyxnzi Cup',
      marketTitle: 'Who wins map 3?',
      outcomeLabel: 'Falcons',
      priceAmerican: -150,
      startsAt: startsAt.toISOString(),
      byCreator: false,
    });
  });

  it('carries the creator flag through', () => {
    const snapshot = buildCustomLegSnapshot(
      {
        eventTitle: 'Jyxnzi Cup',
        marketTitle: 'Who wins?',
        outcomeLabel: 'Ravens',
        startsAt,
        byCreator: true,
      },
      { priceAmerican: 220 },
    );

    expect(snapshot.byCreator).toBe(true);
  });

  it('takes its price only from the frozen argument', () => {
    const snapshot = buildCustomLegSnapshot(
      {
        eventTitle: 'Cup',
        marketTitle: 'Who wins?',
        outcomeLabel: 'Falcons',
        startsAt,
        byCreator: false,
      },
      { priceAmerican: -110 },
    );

    // The source carries no price at all — its type has no such field — so there is no
    // path by which a creator's later reprice could reach an old card (D10).
    expect(snapshot.priceAmerican).toBe(-110);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/feed/__tests__/custom-snapshot.test.ts`
Expected: FAIL — `buildCustomLegSnapshot` is not exported.

- [ ] **Step 3: Add the enum values**

In `src/db/schema/social.ts`, extend the enum:

```ts
export const feedEventType = pgEnum('feed_event_type', [
  'BET_PLACED',
  'BET_SETTLED',
  'MEMBER_JOINED',
  'ALLOWANCE_PAID',
  'ADMIN_ADJUSTMENT',
  'MILESTONE_LEAD_CHANGE',
  'MILESTONE_BIG_WIN',
  'MILESTONE_PARLAY_HIT',
  'CUSTOM_EVENT_CREATED',
  'CUSTOM_EVENT_RESOLVED',
  'CUSTOM_EVENT_DISPUTED',
  'CUSTOM_EVENT_VOIDED',
  'CUSTOM_EVENT_OVERDUE',
]);
```

Then:

```bash
npm run db:generate
npm run db:migrate:test
```

The generated SQL is five `ALTER TYPE "public"."feed_event_type" ADD VALUE …` statements. Postgres 16 permits these inside the migrator's transaction because the migration only _adds_ the values without using them in the same transaction — if a later migration ever needs to use a value it just added, it must be split into two migrations.

Existing `feed_preferences.muted_types` is an array of this enum and needs no change: adding a value widens what can be muted, and the preferences screen enumerates the enum at render time.

- [ ] **Step 4: Widen the payload types**

In `src/server/feed/payload.ts`, replace `FeedLegSnapshot` with a discriminated union and add the currency and the five new payloads:

```ts
export interface GameLegSnapshot {
  kind: 'GAME';
  sport: 'NFL' | 'NCAAF';
  marketType: 'MONEYLINE' | 'SPREAD' | 'TOTAL';
  side: 'HOME' | 'AWAY' | 'OVER' | 'UNDER';
  /** numeric(5,2) exactly as Drizzle returns it. Null for moneyline. */
  line: string | null;
  priceAmerican: number;
  homeAbbr: string;
  awayAbbr: string;
  startsAt: string;
}

export interface CustomLegSnapshot {
  kind: 'CUSTOM';
  eventTitle: string;
  marketTitle: string;
  outcomeLabel: string;
  priceAmerican: number;
  startsAt: string;
  /** True when the bettor is the member who created and will resolve this event (D32). */
  byCreator: boolean;
}

export type FeedLegSnapshot = GameLegSnapshot | CustomLegSnapshot;

export interface BetPlacedPayload {
  betType: 'SINGLE' | 'PARLAY';
  currency: 'CASH' | 'CREDITS';
  stakeCents: string;
  potentialPayoutCents: string;
  combinedPriceAmerican: number;
  legs: FeedLegSnapshot[];
}

export interface CustomEventCreatedPayload {
  eventId: string;
  title: string;
  marketCount: number;
  startsAt: string;
  resolvesBy: string;
}

export interface CustomEventResolvedPayload {
  eventId: string;
  title: string;
  /** One entry per market, in the creator's market order. */
  outcomes: { marketTitle: string; winningLabel: string }[];
  note: string | null;
  attempt: number;
  /** True from the second resolution onward — an admin correcting a disputed call. */
  correction: boolean;
  resolvedByDisplayName: string;
}

export interface CustomEventDisputedPayload {
  eventId: string;
  title: string;
  reason: string;
}

export interface CustomEventVoidedPayload {
  eventId: string;
  title: string;
  note: string;
  refundedBetCount: number;
  refundedCreditsCents: string;
  adminDisplayName: string;
}

export interface CustomEventOverduePayload {
  eventId: string;
  title: string;
  resolvesBy: string;
  openBetCount: number;
}
```

Add all five to the `FeedEventPayload` union at the bottom of the file.

**`kind` is required on every existing snapshot too.** Adding a discriminant to a union means the sports branch must set `kind: 'GAME'`, which is a compile error everywhere `buildLegSnapshot` is used until Step 5 fixes it. That is the point — the compiler is doing the search for you.

- [ ] **Step 5: Add the builders**

In `src/server/feed/snapshot.ts`, add `kind: 'GAME'` to the object `buildLegSnapshot` returns, and add the custom builder beside it:

```ts
export interface CustomSnapshotSource {
  eventTitle: string;
  marketTitle: string;
  outcomeLabel: string;
  startsAt: Date;
  byCreator: boolean;
}

/**
 * Same split as `buildLegSnapshot`: text comes from the source row, the price comes from
 * `frozen` — the leg's `price_at_placement`. A creator repricing their market later must
 * never rewrite an old card (D10).
 */
export function buildCustomLegSnapshot(
  source: CustomSnapshotSource,
  frozen: { priceAmerican: number },
): CustomLegSnapshot {
  return {
    kind: 'CUSTOM',
    eventTitle: source.eventTitle,
    marketTitle: source.marketTitle,
    outcomeLabel: source.outcomeLabel,
    priceAmerican: frozen.priceAmerican,
    startsAt: source.startsAt.toISOString(),
    byCreator: source.byCreator,
  };
}
```

Import `CustomLegSnapshot` from `./payload`.

- [ ] **Step 6: Fix the compile errors the discriminant caused**

Run: `npm run typecheck`

Every `BetPlacedPayload` / `BetSettledPayload` literal now needs `currency`. In `place.ts`, `settle.ts` and `resettle.ts` add `currency: 'CASH'` for now — Tasks 11 and 12 make it real. In `src/app/(app)/feed/feed-card.tsx`, the leg renderer must switch on `leg.kind`; render the custom branch as `{eventTitle} · {marketTitle} · {outcomeLabel} ({price})` with a "creator" badge when `byCreator`, reusing the existing `Badge` component from `src/components/ui/badge.tsx`.

Any test asserting a whole payload object needs `currency: 'CASH'` and `kind: 'GAME'` added to its expectation. Do not relax those assertions to partial matches.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/server/feed/__tests__/custom-snapshot.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 8: Verify**

Run: `npm run verify`
Expected: 48 files, 337 tests, 0 lint errors.

- [ ] **Step 9: Commit**

```bash
git add src drizzle
git commit -m "feat: add custom-event feed types and the custom leg snapshot"
```

---

### Task 10: Creating an event

**Files:**

- Create: `src/server/events/types.ts`, `src/server/events/create.ts`
- Test: `src/server/events/__tests__/create.test.ts`
- Modify: `src/test/factories.ts` (add `makeCustomEvent`)

**Interfaces:**

- Consumes: `customEvents`, `events`, `markets`, `selections` (Tasks 5–7); `emitFeedEvent`; `CustomEventCreatedPayload` (Task 9).
- Produces:
  - `createCustomEvent(input: CreateCustomEventInput): Promise<CreateCustomEventResult>`
  - `CreateCustomEventInput = { creatorMembershipId: string; title: string; description?: string; startsAt: Date; resolvesBy: Date; markets: { title: string; outcomes: { label: string; priceAmerican: number }[] }[]; now?: Date }`
  - `CreateCustomEventResult = { ok: true; eventId: string } | { ok: false; error: CreateEventError }`
  - `CreateEventError` codes: `INVALID_TITLE`, `INVALID_DESCRIPTION`, `INVALID_SCHEDULE`, `INVALID_MARKET_COUNT`, `INVALID_MARKET`, `INVALID_PRICE`, `NOT_A_MEMBER`
  - `makeCustomEvent(overrides?)` test factory returning `{ eventId, custom, membership, marketIds, selectionIds }`

- [ ] **Step 1: Write the failing test**

Create `src/server/events/__tests__/create.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { customEvents, events, feedEvents, markets, selections } from '@/db/schema';
import { createCustomEvent } from '@/server/events/create';
import { resetDb } from '@/test/db';
import { makeMembership } from '@/server/bets/__tests__/helpers';

const IN_A_DAY = new Date(Date.now() + 86_400_000);
const IN_A_WEEK = new Date(Date.now() + 7 * 86_400_000);

function validInput(creatorMembershipId: string) {
  return {
    creatorMembershipId,
    title: 'Jyxnzi Cup',
    description: 'Rainbow Six, best of five',
    startsAt: IN_A_DAY,
    resolvesBy: IN_A_WEEK,
    markets: [
      {
        title: 'Who wins the cup?',
        outcomes: [
          { label: 'Falcons', priceAmerican: -150 },
          { label: 'Ravens', priceAmerican: 130 },
          { label: 'Field', priceAmerican: 900 },
        ],
      },
      {
        title: 'Who wins map 1?',
        outcomes: [
          { label: 'Falcons', priceAmerican: -110 },
          { label: 'Ravens', priceAmerican: -110 },
        ],
      },
    ],
  };
}

describe('createCustomEvent', () => {
  beforeEach(resetDb);

  it('writes the event, its markets and its outcomes in one go', async () => {
    const { membership } = await makeMembership();

    const result = await createCustomEvent(validInput(membership.id));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [event] = await db.select().from(events).where(eq(events.id, result.eventId));
    expect(event.kind).toBe('CUSTOM');
    expect(event.title).toBe('Jyxnzi Cup');

    const [custom] = await db
      .select()
      .from(customEvents)
      .where(eq(customEvents.eventId, result.eventId));
    expect(custom.status).toBe('OPEN');
    expect(custom.creatorMembershipId).toBe(membership.id);

    const marketRows = await db.select().from(markets).where(eq(markets.eventId, result.eventId));
    expect(marketRows).toHaveLength(2);
    expect(marketRows.every((m) => m.type === 'CUSTOM_OUTCOME' && m.sourceBook === null)).toBe(
      true,
    );

    const first = marketRows.find((m) => m.title === 'Who wins the cup?')!;
    const outcomes = await db
      .select()
      .from(selections)
      .where(eq(selections.marketId, first.id))
      .orderBy(selections.sortOrder);
    expect(outcomes.map((o) => o.label)).toEqual(['Falcons', 'Ravens', 'Field']);
    expect(outcomes.map((o) => o.sortOrder)).toEqual([0, 1, 2]);
  });

  it('posts one CUSTOM_EVENT_CREATED card', async () => {
    const { membership } = await makeMembership();
    const result = await createCustomEvent(validInput(membership.id));
    if (!result.ok) throw new Error('expected ok');

    const cards = await db
      .select()
      .from(feedEvents)
      .where(eq(feedEvents.type, 'CUSTOM_EVENT_CREATED'));

    expect(cards).toHaveLength(1);
    expect(cards[0].dedupeKey).toBe(`customevent:${result.eventId}:created`);
    expect(cards[0].subjectMembershipId).toBe(membership.id);
    expect(cards[0].payload).toMatchObject({ title: 'Jyxnzi Cup', marketCount: 2 });
  });

  it.each([
    ['blank title', { title: '   ' }, 'INVALID_TITLE'],
    ['title over 120 chars', { title: 'x'.repeat(121) }, 'INVALID_TITLE'],
    ['description over 1000 chars', { description: 'x'.repeat(1001) }, 'INVALID_DESCRIPTION'],
    ['start in the past', { startsAt: new Date(Date.now() - 1000) }, 'INVALID_SCHEDULE'],
    ['resolves before it starts', { resolvesBy: new Date(Date.now() + 1000) }, 'INVALID_SCHEDULE'],
    ['no markets', { markets: [] }, 'INVALID_MARKET_COUNT'],
  ])('rejects %s', async (_label, override, code) => {
    const { membership } = await makeMembership();
    const result = await createCustomEvent({ ...validInput(membership.id), ...override });

    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code }) });
  });

  it('rejects a market with one outcome', async () => {
    const { membership } = await makeMembership();
    const result = await createCustomEvent({
      ...validInput(membership.id),
      markets: [{ title: 'Who wins?', outcomes: [{ label: 'Falcons', priceAmerican: -110 }] }],
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'INVALID_MARKET', marketIndex: 0, reason: 'OUTCOME_COUNT' },
    });
  });

  it('rejects duplicate outcome labels within one market', async () => {
    const { membership } = await makeMembership();
    const result = await createCustomEvent({
      ...validInput(membership.id),
      markets: [
        {
          title: 'Who wins?',
          outcomes: [
            { label: 'Falcons', priceAmerican: -110 },
            { label: ' falcons ', priceAmerican: 120 },
          ],
        },
      ],
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'INVALID_MARKET', marketIndex: 0, reason: 'DUPLICATE_LABEL' },
    });
  });

  it('rejects an unparseable price', async () => {
    const { membership } = await makeMembership();
    const result = await createCustomEvent({
      ...validInput(membership.id),
      markets: [
        {
          title: 'Who wins?',
          outcomes: [
            { label: 'Falcons', priceAmerican: 0 },
            { label: 'Ravens', priceAmerican: -110 },
          ],
        },
      ],
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'INVALID_PRICE', marketIndex: 0, outcomeIndex: 0 },
    });
  });

  it('writes nothing at all when validation fails', async () => {
    const { membership } = await makeMembership();
    await createCustomEvent({ ...validInput(membership.id), markets: [] });

    expect(await db.select().from(events)).toHaveLength(0);
  });

  it('rejects a membership that does not exist', async () => {
    const result = await createCustomEvent(validInput('00000000-0000-4000-8000-000000000000'));
    expect(result).toEqual({ ok: false, error: { code: 'NOT_A_MEMBER' } });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/events/__tests__/create.test.ts`
Expected: FAIL — cannot resolve `@/server/events/create`.

- [ ] **Step 3: Define the shared types**

Create `src/server/events/types.ts`:

```ts
export interface CreateCustomEventMarketInput {
  title: string;
  outcomes: { label: string; priceAmerican: number }[];
}

export interface CreateCustomEventInput {
  creatorMembershipId: string;
  title: string;
  description?: string;
  startsAt: Date;
  resolvesBy: Date;
  markets: CreateCustomEventMarketInput[];
  /** Injectable clock so schedule validation is testable without sleeping. */
  now?: Date;
}

export type CreateEventError =
  | { code: 'NOT_A_MEMBER' }
  | { code: 'INVALID_TITLE' }
  | { code: 'INVALID_DESCRIPTION' }
  | { code: 'INVALID_SCHEDULE' }
  | { code: 'INVALID_MARKET_COUNT'; count: number; min: number; max: number }
  | {
      code: 'INVALID_MARKET';
      marketIndex: number;
      reason: 'TITLE' | 'OUTCOME_COUNT' | 'DUPLICATE_LABEL' | 'LABEL';
    }
  | { code: 'INVALID_PRICE'; marketIndex: number; outcomeIndex: number };

export type CreateCustomEventResult =
  { ok: true; eventId: string } | { ok: false; error: CreateEventError };

export const MAX_MARKETS_PER_EVENT = 20;
export const MIN_OUTCOMES_PER_MARKET = 2;
export const MAX_OUTCOMES_PER_MARKET = 20;
export const MAX_TITLE_LENGTH = 120;
export const MAX_DESCRIPTION_LENGTH = 1000;
```

- [ ] **Step 4: Write the service**

Create `src/server/events/create.ts`:

```ts
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { customEvents, events, markets, seasonMemberships, selections } from '@/db/schema';
import { americanToRational } from '@/domain/odds';
import { emitFeedEvent } from '@/server/feed/emit';
import type { CustomEventCreatedPayload } from '@/server/feed/payload';
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_MARKETS_PER_EVENT,
  MAX_OUTCOMES_PER_MARKET,
  MAX_TITLE_LENGTH,
  MIN_OUTCOMES_PER_MARKET,
  type CreateCustomEventInput,
  type CreateCustomEventResult,
  type CreateEventError,
} from './types';

/**
 * Validation is a pure pass over the input, run before any transaction opens.
 *
 * Prices are checked for *parseability*, never for sanity: a creator may offer +50000 on a
 * coin flip, and those are their credits to give away (D38).
 */
function validate(input: CreateCustomEventInput, now: Date): CreateEventError | null {
  const title = input.title.trim();
  if (title.length === 0 || title.length > MAX_TITLE_LENGTH) return { code: 'INVALID_TITLE' };

  if ((input.description ?? '').length > MAX_DESCRIPTION_LENGTH) {
    return { code: 'INVALID_DESCRIPTION' };
  }

  if (input.startsAt <= now || input.resolvesBy < input.startsAt) {
    return { code: 'INVALID_SCHEDULE' };
  }

  if (input.markets.length < 1 || input.markets.length > MAX_MARKETS_PER_EVENT) {
    return {
      code: 'INVALID_MARKET_COUNT',
      count: input.markets.length,
      min: 1,
      max: MAX_MARKETS_PER_EVENT,
    };
  }

  for (let m = 0; m < input.markets.length; m++) {
    const market = input.markets[m];
    const marketTitle = market.title.trim();
    if (marketTitle.length === 0 || marketTitle.length > MAX_TITLE_LENGTH) {
      return { code: 'INVALID_MARKET', marketIndex: m, reason: 'TITLE' };
    }

    if (
      market.outcomes.length < MIN_OUTCOMES_PER_MARKET ||
      market.outcomes.length > MAX_OUTCOMES_PER_MARKET
    ) {
      return { code: 'INVALID_MARKET', marketIndex: m, reason: 'OUTCOME_COUNT' };
    }

    const seen = new Set<string>();
    for (let o = 0; o < market.outcomes.length; o++) {
      const label = market.outcomes[o].label.trim();
      if (label.length === 0 || label.length > MAX_TITLE_LENGTH) {
        return { code: 'INVALID_MARKET', marketIndex: m, reason: 'LABEL' };
      }
      // Case- and whitespace-insensitive, because "Falcons" and " falcons " are the same
      // outcome to a reader and the unique index would not catch it.
      const key = label.toLowerCase();
      if (seen.has(key)) {
        return { code: 'INVALID_MARKET', marketIndex: m, reason: 'DUPLICATE_LABEL' };
      }
      seen.add(key);

      try {
        americanToRational(market.outcomes[o].priceAmerican);
      } catch {
        return { code: 'INVALID_PRICE', marketIndex: m, outcomeIndex: o };
      }
    }
  }

  return null;
}

export async function createCustomEvent(
  input: CreateCustomEventInput,
): Promise<CreateCustomEventResult> {
  const now = input.now ?? new Date();

  const error = validate(input, now);
  if (error) return { ok: false, error };

  const [membership] = await db
    .select({ id: seasonMemberships.id, seasonId: seasonMemberships.seasonId })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, input.creatorMembershipId));

  if (!membership) return { ok: false, error: { code: 'NOT_A_MEMBER' } };

  const eventId = await db.transaction(async (tx) => {
    const [event] = await tx
      .insert(events)
      .values({ kind: 'CUSTOM', title: input.title.trim(), startsAt: input.startsAt })
      .returning({ id: events.id });

    await tx.insert(customEvents).values({
      eventId: event.id,
      seasonId: membership.seasonId,
      creatorMembershipId: membership.id,
      description: input.description?.trim() || null,
      resolvesBy: input.resolvesBy,
    });

    for (const market of input.markets) {
      const [row] = await tx
        .insert(markets)
        .values({
          eventId: event.id,
          type: 'CUSTOM_OUTCOME',
          title: market.title.trim(),
          // Null, not a sentinel: there is no book behind a hand-priced market.
          sourceBook: null,
          status: 'OPEN',
        })
        .returning({ id: markets.id });

      await tx.insert(selections).values(
        market.outcomes.map((outcome, i) => ({
          marketId: row.id,
          side: null,
          line: null,
          label: outcome.label.trim(),
          priceAmerican: outcome.priceAmerican,
          sortOrder: i,
        })),
      );
    }

    const payload: CustomEventCreatedPayload = {
      eventId: event.id,
      title: input.title.trim(),
      marketCount: input.markets.length,
      startsAt: input.startsAt.toISOString(),
      resolvesBy: input.resolvesBy.toISOString(),
    };

    await emitFeedEvent(tx, {
      seasonId: membership.seasonId,
      type: 'CUSTOM_EVENT_CREATED',
      subjectMembershipId: membership.id,
      dedupeKey: `customevent:${event.id}:created`,
      payload,
      occurredAt: now,
    });

    return event.id;
  });

  return { ok: true, eventId };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/server/events/__tests__/create.test.ts`
Expected: PASS, 14 tests (the `it.each` block counts as 6).

- [ ] **Step 6: Add the shared test factory**

Later tasks all need a bettable custom event. Add to `src/test/factories.ts`:

```ts
import { customEvents, events, markets, selections } from '@/db/schema';

export interface MadeCustomEvent {
  eventId: string;
  seasonId: string;
  creatorMembershipId: string;
  /** marketId -> ordered selection ids */
  marketSelections: { marketId: string; marketTitle: string; selectionIds: string[] }[];
}

/**
 * A two-market custom event, open for betting, priced at even money so payouts are easy to
 * assert by hand.
 */
export async function makeCustomEvent(opts: {
  creatorMembershipId: string;
  seasonId: string;
  startsAt?: Date;
  resolvesBy?: Date;
}): Promise<MadeCustomEvent> {
  const startsAt = opts.startsAt ?? new Date(Date.now() + 86_400_000);
  const resolvesBy = opts.resolvesBy ?? new Date(Date.now() + 7 * 86_400_000);

  const [event] = await db
    .insert(events)
    .values({ kind: 'CUSTOM', title: 'Test Cup', startsAt })
    .returning();

  await db.insert(customEvents).values({
    eventId: event.id,
    seasonId: opts.seasonId,
    creatorMembershipId: opts.creatorMembershipId,
    resolvesBy,
  });

  const marketSelections = [];
  for (const [title, labels] of [
    ['Who wins the cup?', ['Falcons', 'Ravens']],
    ['Who wins map 1?', ['Falcons', 'Ravens']],
  ] as const) {
    const [market] = await db
      .insert(markets)
      .values({ eventId: event.id, type: 'CUSTOM_OUTCOME', title, sourceBook: null })
      .returning();

    const rows = await db
      .insert(selections)
      .values(
        labels.map((label, i) => ({
          marketId: market.id,
          label,
          priceAmerican: 100,
          sortOrder: i,
        })),
      )
      .returning();

    marketSelections.push({
      marketId: market.id,
      marketTitle: title,
      selectionIds: rows.map((r) => r.id),
    });
  }

  return {
    eventId: event.id,
    seasonId: opts.seasonId,
    creatorMembershipId: opts.creatorMembershipId,
    marketSelections,
  };
}
```

- [ ] **Step 7: Verify**

Run: `npm run verify`
Expected: 49 files, 351 tests, 0 lint errors.

- [ ] **Step 8: Commit**

```bash
git add src/server/events src/test
git commit -m "feat: create custom events with hand-priced outcome markets"
```

---

### Task 11: Placement understands both kinds

**Files:**

- Modify: `src/server/bets/validate.ts`, `src/server/bets/place.ts`, `src/server/bets/types.ts`
- Test: `src/server/bets/__tests__/place-custom.test.ts`
- Modify tests: `src/server/bets/__tests__/validate.test.ts`, `src/server/bets/__tests__/place.test.ts`

**Interfaces:**

- Consumes: `currencyForKinds` (Task 8), `buildCustomLegSnapshot` (Task 9), `makeCustomEvent` (Task 10).
- Produces: `LoadedSelection` is a discriminated union on `kind`; `PlaceBetError` gains `MIXED_CURRENCY_PARLAY`, renames `DUPLICATE_GAME` → `DUPLICATE_EVENT` and `GAME_NOT_BETTABLE` → `EVENT_NOT_BETTABLE`; `bets.currency` is written at placement.

Two error codes are renamed because they no longer describe only games. `DUPLICATE_EVENT` carries `eventId` where it carried `gameId`; `EVENT_NOT_BETTABLE` carries `eventStatus` where it carried `gameStatus`. Update every existing assertion on those codes rather than adding aliases.

- [ ] **Step 1: Write the failing test**

Create `src/server/bets/__tests__/place-custom.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/db/client';
import { bets, customEvents, feedEvents, ledgerEntries, seasonMemberships } from '@/db/schema';
import { placeBet } from '@/server/bets/place';
import { postEntry } from '@/server/money/ledger';
import { resetDb } from '@/test/db';
import { makeCustomEvent } from '@/test/factories';
import { makeMembership, seedBettableGame } from '@/server/bets/__tests__/helpers';

async function grantCredits(membershipId: string, cents: bigint) {
  await db.transaction((tx) =>
    postEntry(tx, {
      membershipId,
      amountCents: cents,
      type: 'SEASON_STARTING_GRANT',
      currency: 'CREDITS',
      idempotencyKey: `credits:${membershipId}`,
    }),
  );
}

describe('placing a bet on a custom event', () => {
  beforeEach(resetDb);

  it('debits credits, not cash, and stores the currency on the bet', async () => {
    const { membership, user, seasonId } = await makeMembership(1_000_000n);
    await grantCredits(membership.id, 50_000n);
    const event = await makeCustomEvent({
      creatorMembershipId: membership.id,
      seasonId,
    });

    const result = await placeBet({
      userId: user.id,
      type: 'SINGLE',
      stakeCents: 10_000n,
      clientRequestId: randomUUID(),
      legs: [
        {
          selectionId: event.marketSelections[0].selectionIds[0],
          line: null,
          priceAmerican: 100,
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [row] = await db
      .select({
        cash: seasonMemberships.balanceCents,
        credits: seasonMemberships.creditsBalanceCents,
      })
      .from(seasonMemberships)
      .where(eq(seasonMemberships.id, membership.id));

    expect(row).toEqual({ cash: 1_000_000n, credits: 40_000n });

    const [bet] = await db.select().from(bets).where(eq(bets.id, result.bet.id));
    expect(bet.currency).toBe('CREDITS');

    const [entry] = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.betId, result.bet.id));
    expect(entry.currency).toBe('CREDITS');
  });

  it('rejects a stake the credits balance cannot cover, however much cash there is', async () => {
    const { membership, user, seasonId } = await makeMembership(1_000_000n);
    await grantCredits(membership.id, 500n);
    const event = await makeCustomEvent({ creatorMembershipId: membership.id, seasonId });

    const result = await placeBet({
      userId: user.id,
      type: 'SINGLE',
      stakeCents: 10_000n,
      clientRequestId: randomUUID(),
      legs: [
        { selectionId: event.marketSelections[0].selectionIds[0], line: null, priceAmerican: 100 },
      ],
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'INSUFFICIENT_FUNDS', stakeCents: 10_000n, balanceCents: 500n },
    });
  });

  it('rejects a slip mixing a game leg with a custom leg', async () => {
    const { membership, user, seasonId } = await makeMembership(1_000_000n);
    await grantCredits(membership.id, 50_000n);
    const game = await seedBettableGame();
    const event = await makeCustomEvent({ creatorMembershipId: membership.id, seasonId });

    const result = await placeBet({
      userId: user.id,
      type: 'PARLAY',
      stakeCents: 1_000n,
      clientRequestId: randomUUID(),
      legs: [
        { selectionId: game.moneyline.home, line: null, priceAmerican: -110 },
        { selectionId: event.marketSelections[0].selectionIds[0], line: null, priceAmerican: 100 },
      ],
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'MIXED_CURRENCY_PARLAY', gameLegIndexes: [0], customLegIndexes: [1] },
    });

    expect(await db.select().from(bets)).toHaveLength(0);
  });

  it('rejects two legs on the same custom event', async () => {
    const { membership, user, seasonId } = await makeMembership(1_000_000n);
    await grantCredits(membership.id, 50_000n);
    const event = await makeCustomEvent({ creatorMembershipId: membership.id, seasonId });

    const result = await placeBet({
      userId: user.id,
      type: 'PARLAY',
      stakeCents: 1_000n,
      clientRequestId: randomUUID(),
      legs: [
        { selectionId: event.marketSelections[0].selectionIds[0], line: null, priceAmerican: 100 },
        { selectionId: event.marketSelections[1].selectionIds[0], line: null, priceAmerican: 100 },
      ],
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'DUPLICATE_EVENT', eventId: event.eventId, legIndexes: [0, 1] },
    });
  });

  it('rejects a leg on a closed event', async () => {
    const { membership, user, seasonId } = await makeMembership(1_000_000n);
    await grantCredits(membership.id, 50_000n);
    const event = await makeCustomEvent({ creatorMembershipId: membership.id, seasonId });

    await db
      .update(customEvents)
      .set({ status: 'VOIDED' })
      .where(eq(customEvents.eventId, event.eventId));

    const result = await placeBet({
      userId: user.id,
      type: 'SINGLE',
      stakeCents: 1_000n,
      clientRequestId: randomUUID(),
      legs: [
        { selectionId: event.marketSelections[0].selectionIds[0], line: null, priceAmerican: 100 },
      ],
    });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'EVENT_NOT_BETTABLE', eventStatus: 'VOIDED' }),
    });
  });

  it('labels the creator on their own bet card', async () => {
    const { membership, user, seasonId } = await makeMembership(1_000_000n);
    await grantCredits(membership.id, 50_000n);
    const event = await makeCustomEvent({ creatorMembershipId: membership.id, seasonId });

    const result = await placeBet({
      userId: user.id,
      type: 'SINGLE',
      stakeCents: 1_000n,
      clientRequestId: randomUUID(),
      legs: [
        { selectionId: event.marketSelections[0].selectionIds[0], line: null, priceAmerican: 100 },
      ],
    });
    if (!result.ok) throw new Error('expected ok');

    const [card] = await db.select().from(feedEvents).where(eq(feedEvents.betId, result.bet.id));

    expect(card.payload).toMatchObject({
      currency: 'CREDITS',
      legs: [
        {
          kind: 'CUSTOM',
          eventTitle: 'Test Cup',
          marketTitle: 'Who wins the cup?',
          outcomeLabel: 'Falcons',
          byCreator: true,
        },
      ],
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/bets/__tests__/place-custom.test.ts`
Expected: FAIL — the custom selection is not found, because `loadSelections` still inner-joins `games`.

- [ ] **Step 3: Make `LoadedSelection` a union**

In `src/server/bets/validate.ts`, replace the interface:

```ts
interface LoadedSelectionBase {
  selectionId: string;
  marketId: string;
  marketStatus: 'OPEN' | 'SUSPENDED' | 'SETTLED';
  line: string | null;
  priceAmerican: number;
  eventId: string;
  eventStartsAt: Date;
  /** The subtype's own lifecycle value — `games.status` or `custom_events.status`. */
  eventStatus: string;
}

export interface LoadedGameSelection extends LoadedSelectionBase {
  kind: 'GAME';
  marketType: MarketType;
  side: Side;
  // Carried for the feed card's frozen snapshot, not for validation.
  sport: Sport;
  homeAbbr: string;
  awayAbbr: string;
}

export interface LoadedCustomSelection extends LoadedSelectionBase {
  kind: 'CUSTOM';
  marketType: 'CUSTOM_OUTCOME';
  eventTitle: string;
  marketTitle: string;
  outcomeLabel: string;
  creatorMembershipId: string;
}

export type LoadedSelection = LoadedGameSelection | LoadedCustomSelection;
```

- [ ] **Step 4: Rewrite the validation rules that referenced games**

Still in `validate.ts`:

```ts
function isBettable(selection: LoadedSelection, now: Date): boolean {
  const open =
    selection.kind === 'GAME'
      ? selection.eventStatus === 'SCHEDULED'
      : selection.eventStatus === 'OPEN';
  return open && selection.eventStartsAt > now;
}
```

Replace the duplicate-game scan with a duplicate-event scan (the whole block from `const firstIndexByGameId` through the `DUPLICATE_GAME` return):

```ts
// Same-event legs are correlated for exactly the reason same-game legs are: "who wins the
// cup" and "who wins the final" are not independent, and paying them at independent odds
// is free money (D13, extended to events).
const firstIndexByEventId = new Map<string, number>();
let duplicateEventId: string | null = null;
for (let i = 0; i < selections.length; i++) {
  const eventId = selections[i].eventId;
  if (firstIndexByEventId.has(eventId)) {
    duplicateEventId = eventId;
    break;
  }
  firstIndexByEventId.set(eventId, i);
}
if (duplicateEventId !== null) {
  const legIndexes = selections
    .map((selection, i) => (selection.eventId === duplicateEventId ? i : -1))
    .filter((i) => i !== -1);
  return { code: 'DUPLICATE_EVENT', eventId: duplicateEventId, legIndexes };
}

// Currency is derived from the legs, and a mixed slip is a shape one stake cannot
// represent (D31). Checked before bettability so the clearest error wins.
const derived = currencyForKinds(selections.map((s) => s.kind));
if (!derived.ok) {
  return {
    code: 'MIXED_CURRENCY_PARLAY',
    gameLegIndexes: derived.gameIndexes,
    customLegIndexes: derived.customIndexes,
  };
}
```

and the bettability loop:

```ts
for (let i = 0; i < selections.length; i++) {
  const selection = selections[i];
  if (!isBettable(selection, ctx.now)) {
    return {
      code: 'EVENT_NOT_BETTABLE',
      legIndex: i,
      eventStatus: selection.eventStatus,
      startsAt: selection.eventStartsAt.toISOString(),
    };
  }
  if (selection.marketStatus !== 'OPEN') {
    return { code: 'MARKET_CLOSED', legIndex: i, marketStatus: selection.marketStatus };
  }
}
```

The balance check reads whichever balance the derived currency names, so `PlacementContext.membership` gains a second field (Step 6) and the check becomes:

```ts
const available =
  derived.currency === 'CASH' ? ctx.membership.balanceCents : ctx.membership.creditsBalanceCents;

if (input.stakeCents > available) {
  return { code: 'INSUFFICIENT_FUNDS', stakeCents: input.stakeCents, balanceCents: available };
}
```

Export the derived currency so `placeBet` does not re-derive it:

```ts
export function currencyForSelections(selections: LoadedSelection[]): Currency {
  const derived = currencyForKinds(selections.map((s) => s.kind));
  if (!derived.ok) throw new Error('mixed-currency slip reached currencyForSelections');
  return derived.currency;
}
```

- [ ] **Step 5: Update the error union**

In `src/server/bets/types.ts`:

```ts
  | { code: 'DUPLICATE_EVENT'; eventId: string; legIndexes: number[] }
  | { code: 'EVENT_NOT_BETTABLE'; legIndex: number; eventStatus: string; startsAt: string }
  | { code: 'MIXED_CURRENCY_PARLAY'; gameLegIndexes: number[]; customLegIndexes: number[] }
```

Delete the `DUPLICATE_GAME` and `GAME_NOT_BETTABLE` members.

- [ ] **Step 6: Rewrite `loadSelections`**

In `src/server/bets/place.ts`, the query becomes a left-join fan-out over both subtypes:

```ts
const rows = await reader
  .select({
    selectionId: selections.id,
    marketId: markets.id,
    marketType: markets.type,
    marketStatus: markets.status,
    marketTitle: markets.title,
    side: selections.side,
    label: selections.label,
    line: selections.line,
    priceAmerican: selections.priceAmerican,
    eventId: events.id,
    eventKind: events.kind,
    eventTitle: events.title,
    eventStartsAt: events.startsAt,
    gameStatus: games.status,
    sport: games.sport,
    homeAbbr: homeTeams.abbreviation,
    awayAbbr: awayTeams.abbreviation,
    customStatus: customEvents.status,
    creatorMembershipId: customEvents.creatorMembershipId,
  })
  .from(selections)
  .innerJoin(markets, eq(selections.marketId, markets.id))
  .innerJoin(events, eq(markets.eventId, events.id))
  .leftJoin(games, eq(games.eventId, events.id))
  .leftJoin(homeTeams, eq(games.homeTeamId, homeTeams.id))
  .leftJoin(awayTeams, eq(games.awayTeamId, awayTeams.id))
  .leftJoin(customEvents, eq(customEvents.eventId, events.id))
  .where(inArray(selections.id, ids));
```

and each row is narrowed into the union by kind:

```ts
function toLoadedSelection(row: (typeof rows)[number]): LoadedSelection {
  if (row.eventKind === 'GAME') {
    return {
      kind: 'GAME',
      selectionId: row.selectionId,
      marketId: row.marketId,
      marketType: row.marketType as MarketType,
      marketStatus: row.marketStatus,
      side: row.side as Side,
      line: row.line,
      priceAmerican: row.priceAmerican,
      eventId: row.eventId,
      eventStartsAt: row.eventStartsAt,
      eventStatus: row.gameStatus!,
      sport: row.sport!,
      homeAbbr: row.homeAbbr!,
      awayAbbr: row.awayAbbr!,
    };
  }

  return {
    kind: 'CUSTOM',
    selectionId: row.selectionId,
    marketId: row.marketId,
    marketType: 'CUSTOM_OUTCOME',
    marketStatus: row.marketStatus,
    line: null,
    priceAmerican: row.priceAmerican,
    eventId: row.eventId,
    eventStartsAt: row.eventStartsAt,
    eventStatus: row.customStatus!,
    eventTitle: row.eventTitle,
    marketTitle: row.marketTitle!,
    outcomeLabel: row.label!,
    creatorMembershipId: row.creatorMembershipId!,
  };
}
```

The non-null assertions are load-bearing and safe: a `GAME` event always has a `games` row (the unique FK from Task 5) and a `CUSTOM` event always has a `custom_events` row (the PK FK from Task 7). If either is ever null, the schema is broken and a crash is the correct outcome — do not silently default them.

- [ ] **Step 7: Load both balances into the placement context**

In `loadPlacementContext`, select `creditsBalanceCents` alongside `balanceCents`, and widen `PlacementContext['membership']` to `{ id: string; balanceCents: bigint; creditsBalanceCents: bigint } | null`.

- [ ] **Step 8: Write the currency and the right leg snapshots in `placeBet`**

Inside the transaction, after `freshSelections` is available:

```ts
const currency = currencyForSelections(freshSelections);

const inserted = await tx.insert(bets).values({
  membershipId: context.membership!.id,
  type: input.type,
  currency,
  stakeCents: input.stakeCents,
  /* …unchanged… */
});
```

Note the ordering problem this creates: the bet row is inserted **before** `fresh` is loaded in the existing code, so `currency` is not known yet at insert time. Derive it from the _early_ `context.selections` instead — validation has already proven the early context is well-formed by that point, and the re-validation under lock re-derives and would reject any slip whose kinds somehow changed:

```ts
const currency = currencyForSelections(context.selections as LoadedSelection[]);
```

Place that line immediately before the insert, and keep using it for the ledger call:

```ts
const posted = await postEntry(tx, {
  membershipId: fresh.membership!.id,
  amountCents: -input.stakeCents,
  type: 'BET_PLACED',
  currency,
  idempotencyKey: `bet:${betId}:placed`,
  betId,
});
```

The payload's legs branch on kind:

```ts
const payload: BetPlacedPayload = {
  betType: input.type,
  currency,
  stakeCents: input.stakeCents.toString(),
  potentialPayoutCents: freshQuote.potentialPayoutCents.toString(),
  combinedPriceAmerican: freshQuote.combinedPriceAmerican,
  legs: freshSelections.map((selection) =>
    selection.kind === 'GAME'
      ? buildLegSnapshot(
          { ...selection, startsAt: selection.eventStartsAt },
          { line: selection.line, priceAmerican: selection.priceAmerican },
        )
      : buildCustomLegSnapshot(
          {
            eventTitle: selection.eventTitle,
            marketTitle: selection.marketTitle,
            outcomeLabel: selection.outcomeLabel,
            startsAt: selection.eventStartsAt,
            byCreator: selection.creatorMembershipId === fresh.membership!.id,
          },
          { priceAmerican: selection.priceAmerican },
        ),
  ),
};
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run src/server/bets/__tests__/place-custom.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 10: Update the existing placement tests**

`validate.test.ts` and `place.test.ts` assert on `DUPLICATE_GAME` / `GAME_NOT_BETTABLE` and build `LoadedSelection` fixtures by hand. Rename the codes and their fields (`gameId` → `eventId`, `gameStatus` → `eventStatus`), and add `kind: 'GAME'` plus `eventId` / `eventStartsAt` / `eventStatus` to every hand-built fixture. The `gameId`/`gameStatus`/`gameStartsAt` names are gone — do not leave a compatibility alias.

- [ ] **Step 11: Verify**

Run: `npm run verify`
Expected: 50 files, 357 tests, 0 lint errors.

- [ ] **Step 12: Commit**

```bash
git add src/server/bets
git commit -m "feat: place credit bets on custom events and reject mixed slips"
```

---

### Task 12: Resolving an event and paying the winners

**Files:**

- Create: `src/server/bets/grade-legs.ts`, `src/server/events/resolve.ts`
- Test: `src/server/events/__tests__/resolve.test.ts`

**Interfaces:**

- Consumes: `gradeCustomLeg` (Task 8), `gradeParlay` / `settledPayoutCents` (existing), `postEntry` currency (Task 2), the resolved payload types (Task 9).
- Produces:
  - `resolveCustomEvent(input: ResolveCustomEventInput): Promise<ResolveCustomEventResult>`
  - `ResolveCustomEventInput = { eventId: string; actorUserId: string; actorMembershipId: string; isAdmin: boolean; winners: { marketId: string; winningSelectionId: string }[]; note?: string; now?: Date }`
  - `ResolveCustomEventResult = { ok: true; attempt: number; betsSettled: number; creditsPaid: bigint } | { ok: false; error: ResolveError }`
  - `ResolveError` codes: `EVENT_NOT_FOUND`, `NOT_CUSTOM_EVENT`, `NOT_AUTHORIZED`, `ALREADY_VOIDED`, `INCOMPLETE_RESOLUTION`, `UNKNOWN_MARKET`, `SELECTION_NOT_IN_MARKET`, `NOTE_REQUIRED`, `RE_RESOLUTION_IS_ADMIN_ONLY`
  - `settleBetsForLegs(tx, { betIds, currency, settledAt })` in `grade-legs.ts` — shared by resolve and void

- [ ] **Step 1: Write the failing test**

Create `src/server/events/__tests__/resolve.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/db/client';
import {
  bets,
  customEvents,
  feedEvents,
  ledgerEntries,
  markets,
  seasonMemberships,
} from '@/db/schema';
import { placeBet } from '@/server/bets/place';
import { resolveCustomEvent } from '@/server/events/resolve';
import { postEntry } from '@/server/money/ledger';
import { resetDb } from '@/test/db';
import { makeCustomEvent } from '@/test/factories';
import { makeMembership } from '@/server/bets/__tests__/helpers';

async function seed() {
  const creator = await makeMembership(1_000_000n);
  const bettor = await makeMembership(1_000_000n, creator.seasonId);

  for (const m of [creator.membership.id, bettor.membership.id]) {
    await db.transaction((tx) =>
      postEntry(tx, {
        membershipId: m,
        amountCents: 100_000n,
        type: 'SEASON_STARTING_GRANT',
        currency: 'CREDITS',
        idempotencyKey: `credits:${m}`,
      }),
    );
  }

  const event = await makeCustomEvent({
    creatorMembershipId: creator.membership.id,
    seasonId: creator.seasonId,
  });

  return { creator, bettor, event };
}

async function credits(membershipId: string) {
  const [row] = await db
    .select({ credits: seasonMemberships.creditsBalanceCents })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, membershipId));
  return row.credits;
}

function allWinners(event: Awaited<ReturnType<typeof makeCustomEvent>>, index = 0) {
  return event.marketSelections.map((m) => ({
    marketId: m.marketId,
    winningSelectionId: m.selectionIds[index],
  }));
}

describe('resolveCustomEvent', () => {
  beforeEach(resetDb);

  it('pays the winner in credits and marks the event resolved', async () => {
    const { creator, bettor, event } = await seed();

    const placed = await placeBet({
      userId: bettor.user.id,
      type: 'SINGLE',
      stakeCents: 10_000n,
      clientRequestId: randomUUID(),
      legs: [
        { selectionId: event.marketSelections[0].selectionIds[0], line: null, priceAmerican: 100 },
      ],
    });
    if (!placed.ok) throw new Error('expected placement to succeed');

    const result = await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: creator.user.id,
      actorMembershipId: creator.membership.id,
      isAdmin: false,
      winners: allWinners(event, 0),
    });

    expect(result).toMatchObject({ ok: true, attempt: 1, betsSettled: 1 });

    // Even money: 10,000 staked comes back as 20,000. Started 100,000, staked 10,000.
    expect(await credits(bettor.membership.id)).toBe(110_000n);

    const [bet] = await db.select().from(bets).where(eq(bets.id, placed.bet.id));
    expect(bet.status).toBe('WON');

    const [custom] = await db
      .select()
      .from(customEvents)
      .where(eq(customEvents.eventId, event.eventId));
    expect(custom.status).toBe('RESOLVED');
    expect(custom.resolutionAttempts).toBe(1);

    const [entry] = await db
      .select()
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.betId, placed.bet.id), eq(ledgerEntries.type, 'BET_WON')));
    expect(entry.currency).toBe('CREDITS');
    expect(entry.idempotencyKey).toBe(`bet:${placed.bet.id}:settled:1`);
  });

  it('grades a loser LOST and pays nothing', async () => {
    const { creator, bettor, event } = await seed();

    const placed = await placeBet({
      userId: bettor.user.id,
      type: 'SINGLE',
      stakeCents: 10_000n,
      clientRequestId: randomUUID(),
      legs: [
        { selectionId: event.marketSelections[0].selectionIds[1], line: null, priceAmerican: 100 },
      ],
    });
    if (!placed.ok) throw new Error('expected placement to succeed');

    await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: creator.user.id,
      actorMembershipId: creator.membership.id,
      isAdmin: false,
      winners: allWinners(event, 0),
    });

    expect(await credits(bettor.membership.id)).toBe(90_000n);
    const [bet] = await db.select().from(bets).where(eq(bets.id, placed.bet.id));
    expect(bet.status).toBe('LOST');
  });

  it('records the winning selection on every market', async () => {
    const { creator, event } = await seed();

    await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: creator.user.id,
      actorMembershipId: creator.membership.id,
      isAdmin: false,
      winners: allWinners(event, 1),
    });

    const rows = await db.select().from(markets).where(eq(markets.eventId, event.eventId));
    expect(rows.every((m) => m.status === 'SETTLED')).toBe(true);
    for (const m of event.marketSelections) {
      const row = rows.find((r) => r.id === m.marketId)!;
      expect(row.winningSelectionId).toBe(m.selectionIds[1]);
    }
  });

  it('is idempotent: replaying the same resolution writes nothing new', async () => {
    const { creator, bettor, event } = await seed();

    await placeBet({
      userId: bettor.user.id,
      type: 'SINGLE',
      stakeCents: 10_000n,
      clientRequestId: randomUUID(),
      legs: [
        { selectionId: event.marketSelections[0].selectionIds[0], line: null, priceAmerican: 100 },
      ],
    });

    await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: creator.user.id,
      actorMembershipId: creator.membership.id,
      isAdmin: false,
      winners: allWinners(event, 0),
    });

    const ledgerBefore = await db.select().from(ledgerEntries);
    const feedBefore = await db.select().from(feedEvents);

    const second = await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: creator.user.id,
      actorMembershipId: creator.membership.id,
      isAdmin: false,
      winners: allWinners(event, 0),
    });

    expect(second).toEqual({ ok: false, error: { code: 'RE_RESOLUTION_IS_ADMIN_ONLY' } });
    expect(await db.select().from(ledgerEntries)).toHaveLength(ledgerBefore.length);
    expect(await db.select().from(feedEvents)).toHaveLength(feedBefore.length);
  });

  it('rejects a resolution that misses a market', async () => {
    const { creator, event } = await seed();

    const result = await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: creator.user.id,
      actorMembershipId: creator.membership.id,
      isAdmin: false,
      winners: [allWinners(event, 0)[0]],
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'INCOMPLETE_RESOLUTION' } });

    const [custom] = await db
      .select()
      .from(customEvents)
      .where(eq(customEvents.eventId, event.eventId));
    expect(custom.status).toBe('OPEN');
  });

  it('rejects a winning selection that belongs to another market', async () => {
    const { creator, event } = await seed();

    const result = await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: creator.user.id,
      actorMembershipId: creator.membership.id,
      isAdmin: false,
      winners: [
        {
          marketId: event.marketSelections[0].marketId,
          winningSelectionId: event.marketSelections[1].selectionIds[0],
        },
        {
          marketId: event.marketSelections[1].marketId,
          winningSelectionId: event.marketSelections[1].selectionIds[0],
        },
      ],
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'SELECTION_NOT_IN_MARKET' } });
  });

  it('rejects a member who is neither the creator nor an admin', async () => {
    const { bettor, event } = await seed();

    const result = await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: bettor.user.id,
      actorMembershipId: bettor.membership.id,
      isAdmin: false,
      winners: allWinners(event, 0),
    });

    expect(result).toEqual({ ok: false, error: { code: 'NOT_AUTHORIZED' } });
  });

  it('posts one CUSTOM_EVENT_RESOLVED card naming each winner', async () => {
    const { creator, event } = await seed();

    await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: creator.user.id,
      actorMembershipId: creator.membership.id,
      isAdmin: false,
      winners: allWinners(event, 0),
    });

    const [card] = await db
      .select()
      .from(feedEvents)
      .where(eq(feedEvents.type, 'CUSTOM_EVENT_RESOLVED'));

    expect(card.dedupeKey).toBe(`customevent:${event.eventId}:resolved:1`);
    expect(card.payload).toMatchObject({
      title: 'Test Cup',
      correction: false,
      attempt: 1,
      outcomes: [
        { marketTitle: 'Who wins the cup?', winningLabel: 'Falcons' },
        { marketTitle: 'Who wins map 1?', winningLabel: 'Falcons' },
      ],
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/events/__tests__/resolve.test.ts`
Expected: FAIL — cannot resolve `@/server/events/resolve`.

- [ ] **Step 3: Extract the bet-settling loop**

`settleGame` and `resolveCustomEvent` do the same thing once their legs are graded: find the bets those legs belong to, grade each with `gradeParlay`, pay, update, and emit. Create `src/server/bets/grade-legs.ts` holding that shared half:

```ts
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import {
  betLegs,
  bets,
  seasonMemberships,
  type BetStatus,
  type Currency,
  type LedgerEntryType,
} from '@/db/schema';
import { gradeParlay, settledPayoutCents } from '@/domain/grading';
import type { LegStatus } from '@/domain/grading';
import { isBigWin, isParlayHit, multipleBasisPoints, survivingLegCount } from '@/domain/milestones';
import { emitFeedEvent } from '@/server/feed/emit';
import { postEntry } from '@/server/money/ledger';
import type {
  BetSettledPayload,
  BigWinPayload,
  FeedLegSnapshot,
  LegOutcome,
  ParlayHitPayload,
} from '@/server/feed/payload';

const ENTRY_TYPE_FOR_STATUS: Partial<Record<BetStatus, LedgerEntryType>> = {
  WON: 'BET_WON',
  PUSHED: 'BET_PUSHED',
  VOIDED: 'BET_VOIDED',
};

export interface SettleBetsSummary {
  betsSettled: number;
  centsPaid: bigint;
}

/**
 * Grades and pays every still-pending bet among `betIds`, using leg statuses already
 * written by the caller.
 *
 * `snapshotLegs` is injected rather than queried here because a game leg and a custom leg
 * build their card from entirely different joins. Everything else — the parlay rule, the
 * payout arithmetic, the idempotency key, the milestone thresholds — is identical for both
 * kinds, and identical to what subsystem 1 already did.
 */
export async function settleBetsForLegs(
  tx: Tx,
  input: {
    betIds: string[];
    settledAt: Date;
    snapshotLegs: (betId: string) => Promise<{
      statuses: LegStatus[];
      prices: number[];
      snapshots: FeedLegSnapshot[];
    }>;
  },
): Promise<SettleBetsSummary> {
  const summary: SettleBetsSummary = { betsSettled: 0, centsPaid: 0n };
  if (input.betIds.length === 0) return summary;

  const candidates = await tx
    .select({
      id: bets.id,
      membershipId: bets.membershipId,
      seasonId: seasonMemberships.seasonId,
      type: bets.type,
      currency: bets.currency,
      stakeCents: bets.stakeCents,
      potentialPayoutCents: bets.potentialPayoutCents,
      combinedPriceAmerican: bets.combinedPriceAmerican,
      settlementAttempts: bets.settlementAttempts,
    })
    .from(bets)
    .innerJoin(seasonMemberships, eq(bets.membershipId, seasonMemberships.id))
    .where(and(inArray(bets.id, input.betIds), eq(bets.status, 'PENDING')))
    .orderBy(asc(bets.membershipId));

  for (const bet of candidates) {
    const { statuses, prices, snapshots } = await input.snapshotLegs(bet.id);

    const parlayOutcome = gradeParlay(statuses);
    if (parlayOutcome === 'PENDING') continue;

    const outcome: BetStatus =
      parlayOutcome === 'PUSHED' && bet.type === 'SINGLE' && statuses.every((s) => s === 'VOIDED')
        ? 'VOIDED'
        : (parlayOutcome as BetStatus);

    const attempts = bet.settlementAttempts + 1;
    const payout = settledPayoutCents(
      bet.stakeCents,
      statuses.map((status, i) => ({ status, priceAmerican: prices[i] })),
    );

    const entryType = ENTRY_TYPE_FOR_STATUS[outcome];
    if (entryType && payout > 0n) {
      await postEntry(tx, {
        membershipId: bet.membershipId,
        amountCents: payout,
        type: entryType,
        currency: bet.currency as Currency,
        idempotencyKey: `bet:${bet.id}:settled:${attempts}`,
        betId: bet.id,
      });
      summary.centsPaid += payout;
    }

    await tx
      .update(bets)
      .set({ status: outcome, settledAt: input.settledAt, settlementAttempts: attempts })
      .where(eq(bets.id, bet.id));

    const legOutcomes = statuses as LegOutcome[];

    const settledPayload: BetSettledPayload = {
      betType: bet.type,
      currency: bet.currency as Currency,
      stakeCents: bet.stakeCents.toString(),
      potentialPayoutCents: bet.potentialPayoutCents.toString(),
      combinedPriceAmerican: bet.combinedPriceAmerican,
      legs: snapshots,
      outcome: outcome as BetSettledPayload['outcome'],
      payoutCents: payout.toString(),
      netCents: (payout - bet.stakeCents).toString(),
      legOutcomes,
      settlementAttempt: attempts,
      correction: attempts > 1,
    };

    await emitFeedEvent(tx, {
      seasonId: bet.seasonId,
      type: 'BET_SETTLED',
      subjectMembershipId: bet.membershipId,
      betId: bet.id,
      dedupeKey: `bet:${bet.id}:settled:${attempts}`,
      payload: settledPayload,
      occurredAt: input.settledAt,
    });

    if (outcome === 'WON' && isBigWin(bet.stakeCents, payout)) {
      const bigWin: BigWinPayload = {
        stakeCents: bet.stakeCents.toString(),
        payoutCents: payout.toString(),
        multipleBasisPoints: multipleBasisPoints(bet.stakeCents, payout),
      };
      await emitFeedEvent(tx, {
        seasonId: bet.seasonId,
        type: 'MILESTONE_BIG_WIN',
        subjectMembershipId: bet.membershipId,
        betId: bet.id,
        dedupeKey: `bet:${bet.id}:bigwin:${attempts}`,
        payload: bigWin,
        occurredAt: input.settledAt,
      });
    }

    if (isParlayHit(bet.type, outcome, legOutcomes)) {
      const parlayHit: ParlayHitPayload = {
        legCount: survivingLegCount(legOutcomes),
        payoutCents: payout.toString(),
        combinedPriceAmerican: bet.combinedPriceAmerican,
      };
      await emitFeedEvent(tx, {
        seasonId: bet.seasonId,
        type: 'MILESTONE_PARLAY_HIT',
        subjectMembershipId: bet.membershipId,
        betId: bet.id,
        dedupeKey: `bet:${bet.id}:parlayhit:${attempts}`,
        payload: parlayHit,
        occurredAt: input.settledAt,
      });
    }

    summary.betsSettled += 1;
  }

  return summary;
}
```

Then rewrite the second half of `settleGame` in `src/server/bets/settle.ts` to call it, passing a `snapshotLegs` that runs the existing game-leg query. `settleGame`'s behavior must not change — its tests are the proof, and they must pass unmodified.

- [ ] **Step 4: Write the resolver**

Create `src/server/events/resolve.ts`:

```ts
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  betLegs,
  customEventDisputes,
  customEvents,
  events,
  markets,
  selections,
  users,
} from '@/db/schema';
import type { LegStatus } from '@/domain/grading';
import { gradeCustomLeg } from '@/domain/custom-grading';
import { settleBetsForLegs } from '@/server/bets/grade-legs';
import { buildCustomLegSnapshot } from '@/server/feed/snapshot';
import { emitFeedEvent } from '@/server/feed/emit';
import type { CustomEventResolvedPayload } from '@/server/feed/payload';

export type ResolveError =
  | { code: 'EVENT_NOT_FOUND' }
  | { code: 'NOT_CUSTOM_EVENT' }
  | { code: 'NOT_AUTHORIZED' }
  | { code: 'ALREADY_VOIDED' }
  | { code: 'RE_RESOLUTION_IS_ADMIN_ONLY' }
  | { code: 'NOTE_REQUIRED' }
  | { code: 'INCOMPLETE_RESOLUTION'; missingMarketIds: string[] }
  | { code: 'UNKNOWN_MARKET'; marketId: string }
  | { code: 'SELECTION_NOT_IN_MARKET'; marketId: string; winningSelectionId: string };

export interface ResolveCustomEventInput {
  eventId: string;
  actorUserId: string;
  actorMembershipId: string;
  isAdmin: boolean;
  winners: { marketId: string; winningSelectionId: string }[];
  /** Required from the second attempt onward — D15's audit trail. */
  note?: string;
  now?: Date;
}

export type ResolveCustomEventResult =
  | { ok: true; attempt: number; betsSettled: number; creditsPaid: bigint }
  | { ok: false; error: ResolveError };

export async function resolveCustomEvent(
  input: ResolveCustomEventInput,
): Promise<ResolveCustomEventResult> {
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    // The lock is what serializes two people hitting Resolve at the same moment.
    const [custom] = await tx
      .select()
      .from(customEvents)
      .where(eq(customEvents.eventId, input.eventId))
      .for('update');

    if (!custom) return { ok: false as const, error: { code: 'EVENT_NOT_FOUND' as const } };
    if (custom.status === 'VOIDED') {
      return { ok: false as const, error: { code: 'ALREADY_VOIDED' as const } };
    }

    const isCreator = custom.creatorMembershipId === input.actorMembershipId;
    if (!isCreator && !input.isAdmin) {
      return { ok: false as const, error: { code: 'NOT_AUTHORIZED' as const } };
    }

    // A creator gets one shot. After that the league's referee is the referee (D35).
    if (custom.status === 'RESOLVED' && !input.isAdmin) {
      return { ok: false as const, error: { code: 'RE_RESOLUTION_IS_ADMIN_ONLY' as const } };
    }
    if (custom.status === 'RESOLVED' && !input.note?.trim()) {
      return { ok: false as const, error: { code: 'NOTE_REQUIRED' as const } };
    }

    const eventMarkets = await tx
      .select({ id: markets.id, title: markets.title })
      .from(markets)
      .where(eq(markets.eventId, input.eventId))
      .orderBy(asc(markets.createdAt));

    const byMarketId = new Map(eventMarkets.map((m) => [m.id, m]));
    const chosen = new Map<string, string>();

    for (const winner of input.winners) {
      if (!byMarketId.has(winner.marketId)) {
        return {
          ok: false as const,
          error: { code: 'UNKNOWN_MARKET' as const, marketId: winner.marketId },
        };
      }
      chosen.set(winner.marketId, winner.winningSelectionId);
    }

    const missingMarketIds = eventMarkets.filter((m) => !chosen.has(m.id)).map((m) => m.id);
    if (missingMarketIds.length > 0) {
      // Partial resolution is not a state this design has: a parlay leg on the missing
      // market could never grade.
      return {
        ok: false as const,
        error: { code: 'INCOMPLETE_RESOLUTION' as const, missingMarketIds },
      };
    }

    const outcomeRows = await tx
      .select({ id: selections.id, marketId: selections.marketId, label: selections.label })
      .from(selections)
      .where(
        inArray(
          selections.marketId,
          eventMarkets.map((m) => m.id),
        ),
      );

    for (const [marketId, winningSelectionId] of chosen) {
      const belongs = outcomeRows.some(
        (row) => row.id === winningSelectionId && row.marketId === marketId,
      );
      if (!belongs) {
        return {
          ok: false as const,
          error: { code: 'SELECTION_NOT_IN_MARKET' as const, marketId, winningSelectionId },
        };
      }
    }

    const attempt = custom.resolutionAttempts + 1;

    for (const [marketId, winningSelectionId] of chosen) {
      await tx
        .update(markets)
        .set({ winningSelectionId, status: 'SETTLED' })
        .where(eq(markets.id, marketId));
    }

    // Grade every pending leg on this event's markets from the stored winner.
    const pending = await tx
      .select({
        legId: betLegs.id,
        betId: betLegs.betId,
        selectionId: betLegs.selectionId,
        marketId: selections.marketId,
      })
      .from(betLegs)
      .innerJoin(selections, eq(betLegs.selectionId, selections.id))
      .where(
        and(
          inArray(
            selections.marketId,
            eventMarkets.map((m) => m.id),
          ),
          eq(betLegs.status, 'PENDING'),
        ),
      );

    for (const leg of pending) {
      const status = gradeCustomLeg({
        selectionId: leg.selectionId,
        winningSelectionId: chosen.get(leg.marketId) ?? null,
      });
      await tx.update(betLegs).set({ status, settledAt: now }).where(eq(betLegs.id, leg.legId));
    }

    const [event] = await tx.select().from(events).where(eq(events.id, input.eventId));

    const summary = await settleBetsForLegs(tx, {
      betIds: [...new Set(pending.map((leg) => leg.betId))],
      settledAt: now,
      snapshotLegs: async (betId) => {
        const legs = await tx
          .select({
            status: betLegs.status,
            priceAtPlacement: betLegs.priceAtPlacement,
            label: selections.label,
            marketTitle: markets.title,
            eventTitle: events.title,
            eventStartsAt: events.startsAt,
            creatorMembershipId: customEvents.creatorMembershipId,
            membershipId: betLegs.betId,
          })
          .from(betLegs)
          .innerJoin(selections, eq(betLegs.selectionId, selections.id))
          .innerJoin(markets, eq(selections.marketId, markets.id))
          .innerJoin(events, eq(markets.eventId, events.id))
          .innerJoin(customEvents, eq(customEvents.eventId, events.id))
          .where(eq(betLegs.betId, betId))
          .orderBy(asc(betLegs.createdAt));

        return {
          statuses: legs.map((leg) => leg.status as LegStatus),
          prices: legs.map((leg) => leg.priceAtPlacement),
          snapshots: legs.map((leg) =>
            buildCustomLegSnapshot(
              {
                eventTitle: leg.eventTitle,
                marketTitle: leg.marketTitle ?? '',
                outcomeLabel: leg.label ?? '',
                startsAt: leg.eventStartsAt,
                // Recomputed rather than copied from the placement card: the card is a
                // frozen render snapshot, and this is a fresh one for a fresh event.
                byCreator: false,
              },
              { priceAmerican: leg.priceAtPlacement },
            ),
          ),
        };
      },
    });

    await tx
      .update(customEvents)
      .set({
        status: 'RESOLVED',
        resolvedAt: now,
        resolvedByUserId: input.actorUserId,
        resolutionNote: input.note?.trim() ?? null,
        resolutionAttempts: attempt,
      })
      .where(eq(customEvents.eventId, input.eventId));

    // Any dispute that prompted this correction is now answered.
    await tx
      .update(customEventDisputes)
      .set({ resolvedAt: now })
      .where(eq(customEventDisputes.eventId, input.eventId));

    const [actor] = await tx
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, input.actorUserId));

    const payload: CustomEventResolvedPayload = {
      eventId: input.eventId,
      title: event.title,
      outcomes: eventMarkets.map((market) => ({
        marketTitle: market.title ?? '',
        winningLabel: outcomeRows.find((row) => row.id === chosen.get(market.id))?.label ?? '',
      })),
      note: input.note?.trim() ?? null,
      attempt,
      correction: attempt > 1,
      resolvedByDisplayName: actor?.displayName ?? 'a member',
    };

    await emitFeedEvent(tx, {
      seasonId: custom.seasonId,
      type: 'CUSTOM_EVENT_RESOLVED',
      subjectMembershipId: input.actorMembershipId,
      dedupeKey: `customevent:${input.eventId}:resolved:${attempt}`,
      payload,
      occurredAt: now,
    });

    return {
      ok: true as const,
      attempt,
      betsSettled: summary.betsSettled,
      creditsPaid: summary.centsPaid,
    };
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/server/events/__tests__/resolve.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Verify the existing settlement suite is unchanged**

Run: `npm run verify`
Expected: 51 files, 365 tests. `settle.test.ts`, `settle-batch.test.ts` and `settle-void.test.ts` must pass **unmodified** — Step 3 refactored `settleGame`'s internals, and those tests are what prove the refactor preserved behavior. If any needed editing, the refactor changed behavior it should not have.

- [ ] **Step 7: Commit**

```bash
git add src/server
git commit -m "feat: resolve custom events and pay winners in credits"
```

---

### Task 13: Disputes and admin re-resolution

**Files:**

- Create: `src/server/events/dispute.ts`
- Modify: `src/server/bets/resettle.ts` (extract `resettleBetInTx`, regrade by kind)
- Modify: `src/server/events/resolve.ts` (attempt > 1 goes through the reversal path)
- Test: `src/server/events/__tests__/dispute.test.ts`

**Interfaces:**

- Consumes: `resolveCustomEvent` (Task 12), `customEventDisputes` (Task 7).
- Produces:
  - `disputeResolution(input: { eventId: string; membershipId: string; reason: string; now?: Date }): Promise<{ ok: true; disputeId: string; created: boolean } | { ok: false; error: DisputeError }>`
  - `DisputeError` codes: `EVENT_NOT_FOUND`, `NOT_RESOLVED`, `WRONG_SEASON`, `REASON_REQUIRED`
  - `resettleBetInTx(tx, input): Promise<ResettleBetResult>` — the body of `resettleBet`, callable from an open transaction

**Task 12 left a hole this task closes.** `resolveCustomEvent` grades only `PENDING` legs, so a second (admin) resolution currently updates the markets and the status but moves no money. The bets are already settled by then, so correcting them means reversing what the first attempt paid — which is exactly what `resettleBet` already does for a corrected score. This task routes attempt > 1 through it instead of writing a second correction path.

- [ ] **Step 1: Write the failing test**

Create `src/server/events/__tests__/dispute.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/db/client';
import {
  bets,
  customEventDisputes,
  customEvents,
  feedEvents,
  ledgerEntries,
  seasonMemberships,
} from '@/db/schema';
import { placeBet } from '@/server/bets/place';
import { disputeResolution } from '@/server/events/dispute';
import { resolveCustomEvent } from '@/server/events/resolve';
import { postEntry } from '@/server/money/ledger';
import { resetDb } from '@/test/db';
import { makeCustomEvent } from '@/test/factories';
import { makeMembership, makeUser } from '@/server/bets/__tests__/helpers';

async function seedResolvedWrong() {
  const creator = await makeMembership(1_000_000n);
  const bettor = await makeMembership(1_000_000n, creator.seasonId);
  const adminUser = await makeUser({ role: 'ADMIN' });

  for (const m of [creator.membership.id, bettor.membership.id]) {
    await db.transaction((tx) =>
      postEntry(tx, {
        membershipId: m,
        amountCents: 100_000n,
        type: 'SEASON_STARTING_GRANT',
        currency: 'CREDITS',
        idempotencyKey: `credits:${m}`,
      }),
    );
  }

  const event = await makeCustomEvent({
    creatorMembershipId: creator.membership.id,
    seasonId: creator.seasonId,
  });

  // The bettor takes Ravens (index 1) in the first market.
  const placed = await placeBet({
    userId: bettor.user.id,
    type: 'SINGLE',
    stakeCents: 10_000n,
    clientRequestId: randomUUID(),
    legs: [
      { selectionId: event.marketSelections[0].selectionIds[1], line: null, priceAmerican: 100 },
    ],
  });
  if (!placed.ok) throw new Error('expected placement to succeed');

  // The creator wrongly declares Falcons (index 0) everywhere.
  await resolveCustomEvent({
    eventId: event.eventId,
    actorUserId: creator.user.id,
    actorMembershipId: creator.membership.id,
    isAdmin: false,
    winners: event.marketSelections.map((m) => ({
      marketId: m.marketId,
      winningSelectionId: m.selectionIds[0],
    })),
  });

  return { creator, bettor, adminUser, event, betId: placed.bet.id };
}

async function credits(membershipId: string) {
  const [row] = await db
    .select({ credits: seasonMemberships.creditsBalanceCents })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, membershipId));
  return row.credits;
}

describe('disputes and re-resolution', () => {
  beforeEach(resetDb);

  it('records a dispute and posts a card', async () => {
    const { bettor, event } = await seedResolvedWrong();

    const result = await disputeResolution({
      eventId: event.eventId,
      membershipId: bettor.membership.id,
      reason: 'map 3 was forfeited, Ravens took the series',
    });

    expect(result).toMatchObject({ ok: true, created: true });

    const rows = await db
      .select()
      .from(customEventDisputes)
      .where(eq(customEventDisputes.eventId, event.eventId));
    expect(rows).toHaveLength(1);
    expect(rows[0].resolvedAt).toBeNull();

    const [card] = await db
      .select()
      .from(feedEvents)
      .where(eq(feedEvents.type, 'CUSTOM_EVENT_DISPUTED'));
    expect(card.dedupeKey).toBe(`customevent:${event.eventId}:disputed:${bettor.membership.id}`);
  });

  it('a second dispute from the same member is a no-op', async () => {
    const { bettor, event } = await seedResolvedWrong();

    await disputeResolution({
      eventId: event.eventId,
      membershipId: bettor.membership.id,
      reason: 'first',
    });
    const second = await disputeResolution({
      eventId: event.eventId,
      membershipId: bettor.membership.id,
      reason: 'second',
    });

    expect(second).toMatchObject({ ok: true, created: false });
    expect(
      await db
        .select()
        .from(customEventDisputes)
        .where(eq(customEventDisputes.eventId, event.eventId)),
    ).toHaveLength(1);
  });

  it('rejects a dispute on an event that is not resolved', async () => {
    const creator = await makeMembership(1_000_000n);
    const event = await makeCustomEvent({
      creatorMembershipId: creator.membership.id,
      seasonId: creator.seasonId,
    });

    const result = await disputeResolution({
      eventId: event.eventId,
      membershipId: creator.membership.id,
      reason: 'too early',
    });

    expect(result).toEqual({ ok: false, error: { code: 'NOT_RESOLVED' } });
  });

  it('rejects an empty reason', async () => {
    const { bettor, event } = await seedResolvedWrong();

    const result = await disputeResolution({
      eventId: event.eventId,
      membershipId: bettor.membership.id,
      reason: '   ',
    });

    expect(result).toEqual({ ok: false, error: { code: 'REASON_REQUIRED' } });
  });

  it('an admin re-resolution reverses the wrong payout and pays the right one', async () => {
    const { bettor, adminUser, creator, event, betId } = await seedResolvedWrong();

    // After the wrong call the bettor lost: 100,000 - 10,000 staked.
    expect(await credits(bettor.membership.id)).toBe(90_000n);

    await disputeResolution({
      eventId: event.eventId,
      membershipId: bettor.membership.id,
      reason: 'map 3 was forfeited',
    });

    const result = await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: adminUser.id,
      actorMembershipId: creator.membership.id,
      isAdmin: true,
      note: 'confirmed the forfeit on the tournament page',
      winners: event.marketSelections.map((m) => ({
        marketId: m.marketId,
        winningSelectionId: m.selectionIds[1],
      })),
    });

    expect(result).toMatchObject({ ok: true, attempt: 2 });

    // Even money on a 10,000 stake: the bettor is made whole and paid 20,000 back.
    expect(await credits(bettor.membership.id)).toBe(110_000n);

    const [bet] = await db.select().from(bets).where(eq(bets.id, betId));
    expect(bet.status).toBe('WON');
    expect(bet.settlementAttempts).toBe(2);

    const keys = (
      await db
        .select({ key: ledgerEntries.idempotencyKey, currency: ledgerEntries.currency })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.betId, betId))
    ).map((r) => `${r.key}|${r.currency}`);

    expect(keys).toContain(`bet:${betId}:placed|CREDITS`);
    expect(keys).toContain(`bet:${betId}:settled:2|CREDITS`);
    // The first attempt paid nothing (the bet lost), so there is no reversal to write.
    expect(keys).not.toContain(`bet:${betId}:reversal:2|CREDITS`);
  });

  it('reverses a payout that was made in error', async () => {
    const { bettor, adminUser, creator, event } = await seedResolvedWrong();

    // Correct the call so the bettor is paid, then correct it back. The second correction
    // is the one under test: it must reverse a payout that has already landed.
    await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: adminUser.id,
      actorMembershipId: creator.membership.id,
      isAdmin: true,
      note: 'first correction',
      winners: event.marketSelections.map((m) => ({
        marketId: m.marketId,
        winningSelectionId: m.selectionIds[1],
      })),
    });
    expect(await credits(bettor.membership.id)).toBe(110_000n);

    await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: adminUser.id,
      actorMembershipId: creator.membership.id,
      isAdmin: true,
      note: 'second correction, the forfeit was overturned',
      winners: event.marketSelections.map((m) => ({
        marketId: m.marketId,
        winningSelectionId: m.selectionIds[0],
      })),
    });

    // Back to the losing state: the 20,000 paid on attempt 2 is reversed and nothing is paid.
    expect(await credits(bettor.membership.id)).toBe(90_000n);
  });

  it('stamps open disputes resolved when the admin re-resolves', async () => {
    const { bettor, adminUser, creator, event } = await seedResolvedWrong();

    await disputeResolution({
      eventId: event.eventId,
      membershipId: bettor.membership.id,
      reason: 'wrong',
    });

    await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: adminUser.id,
      actorMembershipId: creator.membership.id,
      isAdmin: true,
      note: 'corrected',
      winners: event.marketSelections.map((m) => ({
        marketId: m.marketId,
        winningSelectionId: m.selectionIds[1],
      })),
    });

    const [row] = await db
      .select()
      .from(customEventDisputes)
      .where(eq(customEventDisputes.eventId, event.eventId));
    expect(row.resolvedAt).not.toBeNull();
  });

  it('posts the correction card flagged as one', async () => {
    const { adminUser, creator, event } = await seedResolvedWrong();

    await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: adminUser.id,
      actorMembershipId: creator.membership.id,
      isAdmin: true,
      note: 'corrected',
      winners: event.marketSelections.map((m) => ({
        marketId: m.marketId,
        winningSelectionId: m.selectionIds[1],
      })),
    });

    const cards = await db
      .select()
      .from(feedEvents)
      .where(eq(feedEvents.type, 'CUSTOM_EVENT_RESOLVED'));

    expect(cards).toHaveLength(2);
    const correction = cards.find((c) => c.dedupeKey.endsWith(':resolved:2'))!;
    expect(correction.payload).toMatchObject({ correction: true, attempt: 2 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/events/__tests__/dispute.test.ts`
Expected: FAIL — cannot resolve `@/server/events/dispute`.

- [ ] **Step 3: Write the dispute service**

Create `src/server/events/dispute.ts`:

```ts
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { customEventDisputes, customEvents, events, seasonMemberships } from '@/db/schema';
import { emitFeedEvent } from '@/server/feed/emit';
import type { CustomEventDisputedPayload } from '@/server/feed/payload';

export const MAX_DISPUTE_REASON_LENGTH = 500;

export type DisputeError =
  | { code: 'EVENT_NOT_FOUND' }
  | { code: 'NOT_RESOLVED' }
  | { code: 'WRONG_SEASON' }
  | { code: 'REASON_REQUIRED' };

export interface DisputeResolutionInput {
  eventId: string;
  membershipId: string;
  reason: string;
  now?: Date;
}

export type DisputeResolutionResult =
  { ok: true; disputeId: string; created: boolean } | { ok: false; error: DisputeError };

/**
 * A dispute is state, not just an announcement: the admin queue queries this table rather
 * than reading the feed back, because the feed is a publication and not a system of record.
 *
 * It moves no money and changes no status. The correction is an admin re-resolution (D35).
 */
export async function disputeResolution(
  input: DisputeResolutionInput,
): Promise<DisputeResolutionResult> {
  const reason = input.reason.trim();
  if (reason.length === 0 || reason.length > MAX_DISPUTE_REASON_LENGTH) {
    return { ok: false, error: { code: 'REASON_REQUIRED' } };
  }

  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const [custom] = await tx
      .select()
      .from(customEvents)
      .where(eq(customEvents.eventId, input.eventId));

    if (!custom) return { ok: false as const, error: { code: 'EVENT_NOT_FOUND' as const } };
    if (custom.status !== 'RESOLVED') {
      return { ok: false as const, error: { code: 'NOT_RESOLVED' as const } };
    }

    const [membership] = await tx
      .select({ seasonId: seasonMemberships.seasonId })
      .from(seasonMemberships)
      .where(eq(seasonMemberships.id, input.membershipId));

    if (!membership || membership.seasonId !== custom.seasonId) {
      return { ok: false as const, error: { code: 'WRONG_SEASON' as const } };
    }

    const inserted = await tx
      .insert(customEventDisputes)
      .values({ eventId: input.eventId, membershipId: input.membershipId, reason })
      .onConflictDoNothing({
        target: [customEventDisputes.eventId, customEventDisputes.membershipId],
      })
      .returning({ id: customEventDisputes.id });

    if (inserted.length === 0) {
      // A second click is not an error; it is the same dispute.
      const [existing] = await tx
        .select({ id: customEventDisputes.id })
        .from(customEventDisputes)
        .where(eq(customEventDisputes.eventId, input.eventId));
      return { ok: true as const, disputeId: existing.id, created: false };
    }

    const [event] = await tx.select().from(events).where(eq(events.id, input.eventId));

    const payload: CustomEventDisputedPayload = {
      eventId: input.eventId,
      title: event.title,
      reason,
    };

    await emitFeedEvent(tx, {
      seasonId: custom.seasonId,
      type: 'CUSTOM_EVENT_DISPUTED',
      subjectMembershipId: input.membershipId,
      dedupeKey: `customevent:${input.eventId}:disputed:${input.membershipId}`,
      payload,
      occurredAt: now,
    });

    return { ok: true as const, disputeId: inserted[0].id, created: true };
  });
}
```

- [ ] **Step 4: Make `resettleBet` callable from an open transaction and kind-aware**

In `src/server/bets/resettle.ts`, split the function in two. `resettleBet` keeps its signature and becomes a one-line wrapper; everything currently inside `db.transaction(async (tx) => { … })` moves into an exported `resettleBetInTx(tx, input)`.

This matters beyond tidiness: calling `resettleBet` from inside `resolveCustomEvent`'s transaction would open a **second connection**, which then blocks forever on the rows the outer transaction has locked. A nested `db.transaction` is not a savepoint here.

```ts
export async function resettleBet(input: ResettleBetInput): Promise<ResettleBetResult> {
  if (!input.note.trim()) return { ok: false, error: { code: 'NOTE_REQUIRED' } };
  return db.transaction((tx) => resettleBetInTx(tx, input));
}

export async function resettleBetInTx(tx: Tx, input: ResettleBetInput): Promise<ResettleBetResult> {
  // …the existing body, unchanged apart from the two changes below…
}
```

**Change one — the reversal and the payout carry the bet's currency:**

```ts
await postEntry(tx, {
  membershipId: bet.membershipId,
  amountCents: -reversedCents,
  type: 'SETTLEMENT_REVERSAL',
  currency: bet.currency,
  idempotencyKey: `bet:${bet.id}:reversal:${attempt}`,
  actorUserId: input.actorUserId,
  betId: bet.id,
  note: input.note,
});
```

and the same `currency: bet.currency` on the corrected `BET_WON` / `BET_PUSHED` / `BET_VOIDED` entry. Note the reversal sums `ledger_entries` for the bet — filter that sum by currency too, so a bet can never reverse against the wrong denomination:

```ts
      .where(
        and(
          eq(ledgerEntries.betId, bet.id),
          eq(ledgerEntries.currency, bet.currency),
          ne(ledgerEntries.type, 'BET_PLACED'),
        ),
      );
```

**Change two — the leg regrade routes by kind.** Replace the single games-joined query with a branch on the bet's currency (which is exactly the kind of its legs, by Task 11's derivation):

```ts
const settledAt = new Date();
const regraded: { status: LegStatus; priceAmerican: number }[] = [];
let snapshots: FeedLegSnapshot[] = [];

if (bet.currency === 'CASH') {
  // …the existing games-joined query and grading loop, unchanged except that the join
  // is now `.innerJoin(games, eq(markets.eventId, games.eventId))` from Task 6…
  snapshots = legs.map((leg) =>
    buildLegSnapshot(leg, { line: leg.line, priceAmerican: leg.priceAtPlacement }),
  );
} else {
  const legs = await tx
    .select({
      legId: betLegs.id,
      selectionId: betLegs.selectionId,
      priceAtPlacement: betLegs.priceAtPlacement,
      label: selections.label,
      marketTitle: markets.title,
      winningSelectionId: markets.winningSelectionId,
      eventTitle: events.title,
      eventStartsAt: events.startsAt,
      customStatus: customEvents.status,
    })
    .from(betLegs)
    .innerJoin(selections, eq(betLegs.selectionId, selections.id))
    .innerJoin(markets, eq(selections.marketId, markets.id))
    .innerJoin(events, eq(markets.eventId, events.id))
    .innerJoin(customEvents, eq(customEvents.eventId, events.id))
    .where(eq(betLegs.betId, bet.id))
    .orderBy(asc(betLegs.createdAt));

  for (const leg of legs) {
    // A voided event voids its legs; otherwise grade against the stored winner.
    const status: LegStatus =
      leg.customStatus === 'VOIDED'
        ? 'VOIDED'
        : gradeCustomLeg({
            selectionId: leg.selectionId,
            winningSelectionId: leg.winningSelectionId,
          });

    await tx.update(betLegs).set({ status, settledAt }).where(eq(betLegs.id, leg.legId));
    regraded.push({ status, priceAmerican: leg.priceAtPlacement });
  }

  snapshots = legs.map((leg) =>
    buildCustomLegSnapshot(
      {
        eventTitle: leg.eventTitle,
        marketTitle: leg.marketTitle ?? '',
        outcomeLabel: leg.label ?? '',
        startsAt: leg.eventStartsAt,
        byCreator: false,
      },
      { priceAmerican: leg.priceAtPlacement },
    ),
  );
}
```

and the payload uses `legs: snapshots` plus `currency: bet.currency`.

- [ ] **Step 5: Route a re-resolution through it**

In `src/server/events/resolve.ts`, after the leg-grading loop, branch on `attempt`:

```ts
let betsSettled = 0;
let creditsPaid = 0n;

const touchedBetIds = [...new Set(pending.map((leg) => leg.betId))];

if (attempt === 1) {
  const summary = await settleBetsForLegs(tx, {/* …as written in Task 12… */});
  betsSettled = summary.betsSettled;
  creditsPaid = summary.centsPaid;
} else {
  // Every bet on this event was already settled by the previous attempt, so correcting
  // it means reversing what that attempt paid — which is precisely resettleBet's job
  // (D15). resettleBetInTx re-grades from the markets' new winning_selection_id.
  const affected = await tx
    .selectDistinct({ betId: betLegs.betId })
    .from(betLegs)
    .innerJoin(selections, eq(betLegs.selectionId, selections.id))
    .where(
      inArray(
        selections.marketId,
        eventMarkets.map((m) => m.id),
      ),
    );

  for (const { betId } of affected) {
    const result = await resettleBetInTx(tx, {
      betId,
      actorUserId: input.actorUserId,
      note: input.note!.trim(),
    });
    if (result.ok) {
      betsSettled += 1;
      creditsPaid += result.paidCents;
    }
  }
}
```

The `pending` query stays as it is: on attempt 1 it finds the pending legs, and on attempt 2+ it correctly finds none, because `resettleBetInTx` re-grades every leg of each affected bet itself.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/server/events/__tests__/dispute.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 7: Verify**

Run: `npm run verify`
Expected: 52 files, 373 tests, 0 lint errors. `resettle.test.ts` must pass unmodified — the cash path through `resettleBetInTx` is byte-for-byte the behavior it had.

- [ ] **Step 8: Commit**

```bash
git add src/server
git commit -m "feat: dispute a resolution and correct it by admin re-resolution"
```

---

### Task 14: Voiding an event

**Files:**

- Modify: `src/server/events/resolve.ts` (add `voidCustomEvent`)
- Test: `src/server/events/__tests__/void.test.ts`

**Interfaces:**

- Consumes: `resettleBetInTx` (Task 13), `settleBetsForLegs` (Task 12).
- Produces: `voidCustomEvent(input: { eventId: string; actorUserId: string; note: string; now?: Date }): Promise<{ ok: true; refundedBets: number; refundedCents: bigint } | { ok: false; error: VoidError }>` with `VoidError` codes `EVENT_NOT_FOUND`, `ALREADY_VOIDED`, `NOTE_REQUIRED`.

Admin-only — the caller (Task 20's server action) is what enforces that, the same way `adjustBalance` trusts its caller's `requireAdmin()`.

- [ ] **Step 1: Write the failing test**

Create `src/server/events/__tests__/void.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/db/client';
import { betLegs, bets, customEvents, feedEvents, seasonMemberships } from '@/db/schema';
import { placeBet } from '@/server/bets/place';
import { resolveCustomEvent, voidCustomEvent } from '@/server/events/resolve';
import { postEntry } from '@/server/money/ledger';
import { resetDb } from '@/test/db';
import { makeCustomEvent } from '@/test/factories';
import { makeMembership, makeUser } from '@/server/bets/__tests__/helpers';

async function seedWithBets() {
  const creator = await makeMembership(1_000_000n);
  const bettor = await makeMembership(1_000_000n, creator.seasonId);
  const adminUser = await makeUser({ role: 'ADMIN' });

  for (const m of [creator.membership.id, bettor.membership.id]) {
    await db.transaction((tx) =>
      postEntry(tx, {
        membershipId: m,
        amountCents: 100_000n,
        type: 'SEASON_STARTING_GRANT',
        currency: 'CREDITS',
        idempotencyKey: `credits:${m}`,
      }),
    );
  }

  const event = await makeCustomEvent({
    creatorMembershipId: creator.membership.id,
    seasonId: creator.seasonId,
  });

  const placed = await placeBet({
    userId: bettor.user.id,
    type: 'SINGLE',
    stakeCents: 25_000n,
    clientRequestId: randomUUID(),
    legs: [
      { selectionId: event.marketSelections[0].selectionIds[0], line: null, priceAmerican: 100 },
    ],
  });
  if (!placed.ok) throw new Error('expected placement to succeed');

  return { creator, bettor, adminUser, event, betId: placed.bet.id };
}

async function credits(membershipId: string) {
  const [row] = await db
    .select({ credits: seasonMemberships.creditsBalanceCents })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, membershipId));
  return row.credits;
}

describe('voidCustomEvent', () => {
  beforeEach(resetDb);

  it('refunds every open stake and voids the bets', async () => {
    const { bettor, adminUser, event, betId } = await seedWithBets();

    expect(await credits(bettor.membership.id)).toBe(75_000n);

    const result = await voidCustomEvent({
      eventId: event.eventId,
      actorUserId: adminUser.id,
      note: 'the tournament was cancelled',
    });

    expect(result).toMatchObject({ ok: true, refundedBets: 1, refundedCents: 25_000n });
    expect(await credits(bettor.membership.id)).toBe(100_000n);

    const [bet] = await db.select().from(bets).where(eq(bets.id, betId));
    expect(bet.status).toBe('VOIDED');

    const legs = await db.select().from(betLegs).where(eq(betLegs.betId, betId));
    expect(legs.every((l) => l.status === 'VOIDED')).toBe(true);

    const [custom] = await db
      .select()
      .from(customEvents)
      .where(eq(customEvents.eventId, event.eventId));
    expect(custom.status).toBe('VOIDED');
  });

  it('unwinds a resolved event through the reversal path', async () => {
    const { creator, bettor, adminUser, event } = await seedWithBets();

    await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: creator.user.id,
      actorMembershipId: creator.membership.id,
      isAdmin: false,
      winners: event.marketSelections.map((m) => ({
        marketId: m.marketId,
        winningSelectionId: m.selectionIds[0],
      })),
    });
    // Won at even money: 75,000 + 50,000.
    expect(await credits(bettor.membership.id)).toBe(125_000n);

    await voidCustomEvent({
      eventId: event.eventId,
      actorUserId: adminUser.id,
      note: 'the result was fabricated',
    });

    // The 50,000 payout reverses and the 25,000 stake refunds.
    expect(await credits(bettor.membership.id)).toBe(100_000n);
  });

  it('requires a note', async () => {
    const { adminUser, event } = await seedWithBets();

    const result = await voidCustomEvent({
      eventId: event.eventId,
      actorUserId: adminUser.id,
      note: '  ',
    });

    expect(result).toEqual({ ok: false, error: { code: 'NOTE_REQUIRED' } });
  });

  it('rejects voiding twice', async () => {
    const { adminUser, event } = await seedWithBets();

    await voidCustomEvent({ eventId: event.eventId, actorUserId: adminUser.id, note: 'once' });
    const second = await voidCustomEvent({
      eventId: event.eventId,
      actorUserId: adminUser.id,
      note: 'twice',
    });

    expect(second).toEqual({ ok: false, error: { code: 'ALREADY_VOIDED' } });
  });

  it('posts one CUSTOM_EVENT_VOIDED card with the refund total', async () => {
    const { adminUser, event } = await seedWithBets();

    await voidCustomEvent({
      eventId: event.eventId,
      actorUserId: adminUser.id,
      note: 'the tournament was cancelled',
    });

    const [card] = await db
      .select()
      .from(feedEvents)
      .where(eq(feedEvents.type, 'CUSTOM_EVENT_VOIDED'));

    expect(card.dedupeKey).toBe(`customevent:${event.eventId}:voided`);
    expect(card.subjectMembershipId).toBeNull();
    expect(card.payload).toMatchObject({
      refundedBetCount: 1,
      refundedCreditsCents: '25000',
      note: 'the tournament was cancelled',
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/events/__tests__/void.test.ts`
Expected: FAIL — `voidCustomEvent` is not exported.

- [ ] **Step 3: Implement it**

Append to `src/server/events/resolve.ts`:

```ts
export type VoidError =
  { code: 'EVENT_NOT_FOUND' } | { code: 'ALREADY_VOIDED' } | { code: 'NOTE_REQUIRED' };

export interface VoidCustomEventInput {
  eventId: string;
  actorUserId: string;
  /** Required. A void moves money, so it says who and why (D15). */
  note: string;
  now?: Date;
}

export type VoidCustomEventResult =
  { ok: true; refundedBets: number; refundedCents: bigint } | { ok: false; error: VoidError };

/**
 * Admin-only. Voids every bet on the event and refunds every stake — the same path a
 * postponed game already runs (D12), reached from a different trigger.
 *
 * A resolved event unwinds through `resettleBetInTx`, which reverses whatever the
 * resolution paid before writing the refund. An open event has nothing to reverse, so its
 * legs are voided in place and settled normally.
 */
export async function voidCustomEvent(input: VoidCustomEventInput): Promise<VoidCustomEventResult> {
  const note = input.note.trim();
  if (note.length === 0) return { ok: false, error: { code: 'NOTE_REQUIRED' } };

  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const [custom] = await tx
      .select()
      .from(customEvents)
      .where(eq(customEvents.eventId, input.eventId))
      .for('update');

    if (!custom) return { ok: false as const, error: { code: 'EVENT_NOT_FOUND' as const } };
    if (custom.status === 'VOIDED') {
      return { ok: false as const, error: { code: 'ALREADY_VOIDED' as const } };
    }

    const wasResolved = custom.status === 'RESOLVED';

    const eventMarkets = await tx
      .select({ id: markets.id })
      .from(markets)
      .where(eq(markets.eventId, input.eventId));
    const marketIds = eventMarkets.map((m) => m.id);

    // Flip the status first: resettleBetInTx re-grades from it, and a leg on a VOIDED event
    // grades VOIDED regardless of any winning_selection_id left behind.
    await tx
      .update(customEvents)
      .set({
        status: 'VOIDED',
        resolvedAt: now,
        resolvedByUserId: input.actorUserId,
        resolutionNote: note,
        resolutionAttempts: custom.resolutionAttempts + 1,
      })
      .where(eq(customEvents.eventId, input.eventId));

    await tx
      .update(customEventDisputes)
      .set({ resolvedAt: now })
      .where(eq(customEventDisputes.eventId, input.eventId));

    const affected = await tx
      .selectDistinct({ betId: betLegs.betId })
      .from(betLegs)
      .innerJoin(selections, eq(betLegs.selectionId, selections.id))
      .where(inArray(selections.marketId, marketIds));

    let refundedBets = 0;
    let refundedCents = 0n;

    if (wasResolved) {
      for (const { betId } of affected) {
        const result = await resettleBetInTx(tx, {
          betId,
          actorUserId: input.actorUserId,
          note,
        });
        if (result.ok) {
          refundedBets += 1;
          refundedCents += result.paidCents;
        }
      }
    } else {
      await tx
        .update(betLegs)
        .set({ status: 'VOIDED', settledAt: now })
        .where(
          and(
            inArray(
              betLegs.selectionId,
              tx
                .select({ id: selections.id })
                .from(selections)
                .where(inArray(selections.marketId, marketIds)),
            ),
            eq(betLegs.status, 'PENDING'),
          ),
        );

      const summary = await settleBetsForLegs(tx, {
        betIds: affected.map((a) => a.betId),
        settledAt: now,
        snapshotLegs: customSnapshotLegs(tx),
      });
      refundedBets = summary.betsSettled;
      refundedCents = summary.centsPaid;
    }

    await tx.update(markets).set({ status: 'SETTLED' }).where(eq(markets.eventId, input.eventId));

    const [event] = await tx.select().from(events).where(eq(events.id, input.eventId));
    const [admin] = await tx
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, input.actorUserId));

    const payload: CustomEventVoidedPayload = {
      eventId: input.eventId,
      title: event.title,
      note,
      refundedBetCount: refundedBets,
      refundedCreditsCents: refundedCents.toString(),
      adminDisplayName: admin?.displayName ?? 'an admin',
    };

    await emitFeedEvent(tx, {
      seasonId: custom.seasonId,
      type: 'CUSTOM_EVENT_VOIDED',
      // No subject: a void is about the event, not about any one member.
      dedupeKey: `customevent:${input.eventId}:voided`,
      payload,
      occurredAt: now,
    });

    return { ok: true as const, refundedBets, refundedCents };
  });
}
```

Extract the `snapshotLegs` closure Task 12 wrote inline into a module-level `customSnapshotLegs(tx)` helper so both `resolveCustomEvent` and `voidCustomEvent` use one copy. It is the same query and the same mapping — do not paste a second version.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/server/events/__tests__/void.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Verify**

Run: `npm run verify`
Expected: 53 files, 378 tests, 0 lint errors.

- [ ] **Step 6: Commit**

```bash
git add src/server/events
git commit -m "feat: void a custom event and refund every stake"
```

---

### Task 15: The overdue sweep

**Files:**

- Create: `src/server/events/overdue.ts`
- Modify: `src/app/api/cron/settle/route.ts`
- Test: `src/server/events/__tests__/overdue.test.ts`

**Interfaces:**

- Consumes: `customEvents` (Task 7), `CustomEventOverduePayload` (Task 9).
- Produces: `sweepOverdueEvents(now?: Date): Promise<{ flagged: number }>`; the settle cron route's JSON response gains `overdueFlagged`.

- [ ] **Step 1: Write the failing test**

Create `src/server/events/__tests__/overdue.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { customEvents, feedEvents } from '@/db/schema';
import { sweepOverdueEvents } from '@/server/events/overdue';
import { resetDb } from '@/test/db';
import { makeCustomEvent } from '@/test/factories';
import { makeMembership } from '@/server/bets/__tests__/helpers';

const PAST = new Date(Date.now() - 3 * 86_400_000);
const FUTURE = new Date(Date.now() + 3 * 86_400_000);

describe('sweepOverdueEvents', () => {
  beforeEach(resetDb);

  it('flags an open event past its resolve-by date', async () => {
    const { membership, seasonId } = await makeMembership();
    const event = await makeCustomEvent({
      creatorMembershipId: membership.id,
      seasonId,
      startsAt: new Date(Date.now() - 4 * 86_400_000),
      resolvesBy: PAST,
    });

    expect(await sweepOverdueEvents()).toEqual({ flagged: 1 });

    const [card] = await db
      .select()
      .from(feedEvents)
      .where(eq(feedEvents.type, 'CUSTOM_EVENT_OVERDUE'));
    expect(card.dedupeKey).toBe(`customevent:${event.eventId}:overdue`);
    expect(card.subjectMembershipId).toBe(membership.id);
    expect(card.payload).toMatchObject({ title: 'Test Cup', openBetCount: 0 });
  });

  it('flags nothing that is not yet due', async () => {
    const { membership, seasonId } = await makeMembership();
    await makeCustomEvent({ creatorMembershipId: membership.id, seasonId, resolvesBy: FUTURE });

    expect(await sweepOverdueEvents()).toEqual({ flagged: 0 });
    expect(await db.select().from(feedEvents)).toHaveLength(0);
  });

  it('flags nothing already resolved or voided', async () => {
    const { membership, seasonId } = await makeMembership();
    const event = await makeCustomEvent({
      creatorMembershipId: membership.id,
      seasonId,
      startsAt: new Date(Date.now() - 4 * 86_400_000),
      resolvesBy: PAST,
    });
    await db
      .update(customEvents)
      .set({ status: 'RESOLVED' })
      .where(eq(customEvents.eventId, event.eventId));

    expect(await sweepOverdueEvents()).toEqual({ flagged: 0 });
  });

  it('posts exactly one card however often it runs', async () => {
    const { membership, seasonId } = await makeMembership();
    await makeCustomEvent({
      creatorMembershipId: membership.id,
      seasonId,
      startsAt: new Date(Date.now() - 4 * 86_400_000),
      resolvesBy: PAST,
    });

    await sweepOverdueEvents();
    const second = await sweepOverdueEvents();
    await sweepOverdueEvents();

    // The sweep still *finds* it — nothing about the event changed — but the dedupe key
    // means only the first run posted a card.
    expect(second.flagged).toBe(1);
    expect(
      await db.select().from(feedEvents).where(eq(feedEvents.type, 'CUSTOM_EVENT_OVERDUE')),
    ).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/events/__tests__/overdue.test.ts`
Expected: FAIL — cannot resolve `@/server/events/overdue`.

- [ ] **Step 3: Write the sweep**

Create `src/server/events/overdue.ts`:

```ts
import { and, count, eq, inArray, lt } from 'drizzle-orm';
import { db } from '@/db/client';
import { betLegs, customEvents, events, markets, selections } from '@/db/schema';
import { emitFeedEvent } from '@/server/feed/emit';
import type { CustomEventOverduePayload } from '@/server/feed/payload';

/**
 * Finds open events past their resolve-by date and announces each one, exactly once.
 *
 * It moves no money and changes no status — overdue is derived, not stored (D37). Its whole
 * job is to make a forgotten event impossible to ignore; an admin then resolves or voids it.
 *
 * Called from the settle cron route rather than getting its own schedule, for the same
 * reason lead-change detection is: no new entry to keep in sync, and no cursor to get stuck.
 */
export async function sweepOverdueEvents(now: Date = new Date()): Promise<{ flagged: number }> {
  const overdue = await db
    .select({
      eventId: customEvents.eventId,
      seasonId: customEvents.seasonId,
      creatorMembershipId: customEvents.creatorMembershipId,
      resolvesBy: customEvents.resolvesBy,
      title: events.title,
    })
    .from(customEvents)
    .innerJoin(events, eq(events.id, customEvents.eventId))
    .where(and(eq(customEvents.status, 'OPEN'), lt(customEvents.resolvesBy, now)));

  for (const event of overdue) {
    const [{ openBets }] = await db
      .select({ openBets: count() })
      .from(betLegs)
      .innerJoin(selections, eq(betLegs.selectionId, selections.id))
      .innerJoin(markets, eq(selections.marketId, markets.id))
      .where(and(eq(markets.eventId, event.eventId), eq(betLegs.status, 'PENDING')));

    const payload: CustomEventOverduePayload = {
      eventId: event.eventId,
      title: event.title,
      resolvesBy: event.resolvesBy.toISOString(),
      openBetCount: openBets,
    };

    await db.transaction((tx) =>
      emitFeedEvent(tx, {
        seasonId: event.seasonId,
        type: 'CUSTOM_EVENT_OVERDUE',
        subjectMembershipId: event.creatorMembershipId,
        dedupeKey: `customevent:${event.eventId}:overdue`,
        payload,
        occurredAt: now,
      }),
    );
  }

  return { flagged: overdue.length };
}
```

`flagged` counts events found, not cards written — the dedupe key already makes a repeat run write nothing, and a count that silently drops to zero on the second run would make the cron log look like the problem went away.

- [ ] **Step 4: Wire it into the settle cron**

In `src/app/api/cron/settle/route.ts`, after the lead-change block:

```ts
const overdue = await sweepOverdueEvents();

const status = summary.errors.length > 0 ? 207 : 200;
return Response.json(jsonSafe({ ...summary, leadChanged, overdueFlagged: overdue.flagged }), {
  status,
});
```

Update the route's doc comment to say the sweep rides along here too.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/server/events/__tests__/overdue.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Verify**

Run: `npm run verify`
Expected: 54 files, 382 tests, 0 lint errors.

- [ ] **Step 7: Commit**

```bash
git add src/server/events src/app/api/cron
git commit -m "feat: sweep overdue custom events from the settle cron"
```

---

### Task 16: The events board

**Files:**

- Create: `src/server/events/query.ts`, `src/app/(app)/events/page.tsx`
- Test: `src/server/events/__tests__/query.test.ts`

**Interfaces:**

- Consumes: `customEvents`, `events`, `markets`, `bets` (Tasks 5–7, 11).
- Produces:
  - `listSeasonEvents(seasonId: string, now?: Date): Promise<EventBoardRow[]>`
  - `EventBoardRow = { eventId: string; title: string; startsAt: Date; resolvesBy: Date; status: CustomEventStatus; overdue: boolean; creatorMembershipId: string; creatorDisplayName: string; marketCount: number; stakedCreditsCents: bigint; section: 'OPEN' | 'AWAITING' | 'SETTLED' }`
  - `getCustomEventDetail(eventId, viewerMembershipId)` — used by Task 18; specified there.

Read the Next.js guide in `node_modules/next/dist/docs/` before writing the page.

- [ ] **Step 1: Write the failing test**

Create `src/server/events/__tests__/query.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/db/client';
import { customEvents } from '@/db/schema';
import { placeBet } from '@/server/bets/place';
import { listSeasonEvents } from '@/server/events/query';
import { postEntry } from '@/server/money/ledger';
import { resetDb } from '@/test/db';
import { makeCustomEvent } from '@/test/factories';
import { makeMembership } from '@/server/bets/__tests__/helpers';

describe('listSeasonEvents', () => {
  beforeEach(resetDb);

  it('sections events into open, awaiting resolution, and settled', async () => {
    const { membership, seasonId } = await makeMembership();

    const open = await makeCustomEvent({
      creatorMembershipId: membership.id,
      seasonId,
      startsAt: new Date(Date.now() + 86_400_000),
      resolvesBy: new Date(Date.now() + 7 * 86_400_000),
    });
    const awaiting = await makeCustomEvent({
      creatorMembershipId: membership.id,
      seasonId,
      startsAt: new Date(Date.now() - 86_400_000),
      resolvesBy: new Date(Date.now() + 86_400_000),
    });
    const settled = await makeCustomEvent({ creatorMembershipId: membership.id, seasonId });
    await db
      .update(customEvents)
      .set({ status: 'RESOLVED' })
      .where(eq(customEvents.eventId, settled.eventId));

    const rows = await listSeasonEvents(seasonId);
    const byId = new Map(rows.map((r) => [r.eventId, r]));

    expect(byId.get(open.eventId)!.section).toBe('OPEN');
    expect(byId.get(awaiting.eventId)!.section).toBe('AWAITING');
    expect(byId.get(settled.eventId)!.section).toBe('SETTLED');
  });

  it('marks an event past its resolve-by date as overdue', async () => {
    const { membership, seasonId } = await makeMembership();
    const late = await makeCustomEvent({
      creatorMembershipId: membership.id,
      seasonId,
      startsAt: new Date(Date.now() - 4 * 86_400_000),
      resolvesBy: new Date(Date.now() - 86_400_000),
    });

    const [row] = await listSeasonEvents(seasonId);
    expect(row.eventId).toBe(late.eventId);
    expect(row.overdue).toBe(true);
  });

  it('totals the credits staked on each event', async () => {
    const { membership, user, seasonId } = await makeMembership();
    await db.transaction((tx) =>
      postEntry(tx, {
        membershipId: membership.id,
        amountCents: 100_000n,
        type: 'SEASON_STARTING_GRANT',
        currency: 'CREDITS',
        idempotencyKey: `credits:${membership.id}`,
      }),
    );
    const event = await makeCustomEvent({ creatorMembershipId: membership.id, seasonId });

    await placeBet({
      userId: user.id,
      type: 'SINGLE',
      stakeCents: 7_500n,
      clientRequestId: randomUUID(),
      legs: [
        { selectionId: event.marketSelections[0].selectionIds[0], line: null, priceAmerican: 100 },
      ],
    });

    const [row] = await listSeasonEvents(seasonId);
    expect(row.stakedCreditsCents).toBe(7_500n);
    expect(row.marketCount).toBe(2);
  });

  it('never returns another season’s events', async () => {
    const a = await makeMembership();
    const b = await makeMembership();
    await makeCustomEvent({ creatorMembershipId: a.membership.id, seasonId: a.seasonId });

    expect(await listSeasonEvents(b.seasonId)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/events/__tests__/query.test.ts`
Expected: FAIL — cannot resolve `@/server/events/query`.

- [ ] **Step 3: Write the query**

Create `src/server/events/query.ts`:

```ts
import { asc, eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  customEvents,
  events,
  seasonMemberships,
  users,
  type CustomEventStatus,
} from '@/db/schema';

export type EventSection = 'OPEN' | 'AWAITING' | 'SETTLED';

export interface EventBoardRow {
  eventId: string;
  title: string;
  startsAt: Date;
  resolvesBy: Date;
  status: CustomEventStatus;
  overdue: boolean;
  creatorMembershipId: string;
  creatorDisplayName: string;
  marketCount: number;
  stakedCreditsCents: bigint;
  section: EventSection;
}

const SECTION_ORDER: Record<EventSection, number> = { OPEN: 0, AWAITING: 1, SETTLED: 2 };

/**
 * The events board, sectioned.
 *
 * `overdue` is computed here with exactly the expression `sweepOverdueEvents` uses —
 * `status = 'OPEN' AND resolves_by < now` — because there is only one definition of overdue
 * in the system and it is derived, never stored (D37).
 *
 * The two aggregates are correlated subqueries written with literal, table-qualified
 * identifiers rather than drizzle's `${table.column}` helpers. Interpolating a column helper
 * inside a `sql` fragment resolves it against the subquery's own FROM, which silently
 * produces a comparison that is never true (D30) — the third test below is what catches it.
 */
export async function listSeasonEvents(
  seasonId: string,
  now: Date = new Date(),
): Promise<EventBoardRow[]> {
  const rows = await db
    .select({
      eventId: customEvents.eventId,
      title: events.title,
      startsAt: events.startsAt,
      resolvesBy: customEvents.resolvesBy,
      status: customEvents.status,
      creatorMembershipId: customEvents.creatorMembershipId,
      creatorDisplayName: users.displayName,
      marketCount: sql<string>`(
        SELECT COUNT(*) FROM markets mk WHERE mk.event_id = custom_events.event_id
      )`,
      stakedCreditsCents: sql<string>`COALESCE((
        SELECT SUM(b.stake_cents)
        FROM bets b
        WHERE b.id IN (
          SELECT bl.bet_id
          FROM bet_legs bl
          JOIN selections s ON s.id = bl.selection_id
          JOIN markets mk ON mk.id = s.market_id
          WHERE mk.event_id = custom_events.event_id
        )
      ), 0)`,
    })
    .from(customEvents)
    .innerJoin(events, eq(events.id, customEvents.eventId))
    .innerJoin(seasonMemberships, eq(seasonMemberships.id, customEvents.creatorMembershipId))
    .innerJoin(users, eq(users.id, seasonMemberships.userId))
    .where(eq(customEvents.seasonId, seasonId))
    .orderBy(asc(events.startsAt));

  const mapped = rows.map((row) => {
    const open = row.status === 'OPEN';
    const section: EventSection = !open ? 'SETTLED' : row.startsAt <= now ? 'AWAITING' : 'OPEN';

    return {
      eventId: row.eventId,
      title: row.title,
      startsAt: row.startsAt,
      resolvesBy: row.resolvesBy,
      status: row.status,
      overdue: open && row.resolvesBy < now,
      creatorMembershipId: row.creatorMembershipId,
      creatorDisplayName: row.creatorDisplayName,
      marketCount: Number(row.marketCount),
      // Money is a string out of Postgres and becomes a bigint here. Never Number() (D17).
      stakedCreditsCents: BigInt(row.stakedCreditsCents),
      section,
    };
  });

  // Open events soonest-first; settled events most-recent-first.
  return mapped.sort((a, b) => {
    if (SECTION_ORDER[a.section] !== SECTION_ORDER[b.section]) {
      return SECTION_ORDER[a.section] - SECTION_ORDER[b.section];
    }
    const direction = a.section === 'SETTLED' ? -1 : 1;
    return direction * (a.startsAt.getTime() - b.startsAt.getTime());
  });
}
```

`marketCount` is a count, not money, so `Number()` is right there and wrong one line below it.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/server/events/__tests__/query.test.ts`
Expected: PASS, 4 tests. If `stakedCreditsCents` comes back `0n` on the third test, you have hit D30 — the subquery is resolving `custom_events.event_id` against its own `FROM`. Qualify it literally.

- [ ] **Step 5: Build the page**

Create `src/app/(app)/events/page.tsx` as a server component:

```tsx
export default async function EventsPage() {
  const member = await requireApprovedMember();
  const rows = await listSeasonEvents(member.seasonId);
  // …
}
```

Render three sections with headings — **Open**, **Awaiting resolution**, **Recently settled** — each row linking to `/events/[eventId]` and showing title, creator name, close time, market count, and total credits staked via the existing `<Money />` component. Overdue rows carry a `<Badge>` reading "Overdue". An empty board renders `<EmptyState title="No events yet" />` with a link to `/events/new`.

Add a prominent "Create an event" link at the top. Members with zero credits still see the board; the detail page is what tells them they cannot bet.

- [ ] **Step 6: Compile the route**

Run: `npm run build`
Expected: the build succeeds and lists `/events` among the compiled routes. (Browser verification is local-only — see [Environment setup](#environment-setup).)

- [ ] **Step 7: Verify and commit**

```bash
npm run verify
git add src/server/events src/app
git commit -m "feat: add the custom events board"
```

---

### Task 17: Creating an event from the UI

**Files:**

- Create: `src/app/(app)/events/actions.ts`, `src/app/(app)/events/new/page.tsx`, `src/app/(app)/events/new/event-form.tsx`
- Test: none new — `createCustomEvent` is covered by Task 10; this task is the boundary around it.

**Interfaces:**

- Consumes: `createCustomEvent` (Task 10), `requireApprovedMemberOrThrow` (existing).
- Produces: `createEventAction(form: CreateEventFormValues): Promise<{ ok: true; eventId: string } | { ok: false; error: CreateEventError }>` in `src/app/(app)/events/actions.ts`, where every money-free field is a plain string or number and dates cross as ISO strings.

- [ ] **Step 1: Write the server action**

Create `src/app/(app)/events/actions.ts`:

```ts
'use server';

import { redirect } from 'next/navigation';
import { requireApprovedMemberOrThrow } from '@/server/auth/session';
import { createCustomEvent } from '@/server/events/create';
import type { CreateEventError } from '@/server/events/types';

export interface CreateEventFormValues {
  title: string;
  description: string;
  startsAtIso: string;
  resolvesByIso: string;
  markets: { title: string; outcomes: { label: string; priceAmerican: number }[] }[];
}

export async function createEventAction(
  form: CreateEventFormValues,
): Promise<{ ok: false; error: CreateEventError } | never> {
  // Authorization is server-side, always. The form being reachable proves nothing.
  const member = await requireApprovedMemberOrThrow();

  const result = await createCustomEvent({
    creatorMembershipId: member.membershipId,
    title: form.title,
    description: form.description,
    startsAt: new Date(form.startsAtIso),
    resolvesBy: new Date(form.resolvesByIso),
    markets: form.markets,
  });

  if (!result.ok) return { ok: false, error: result.error };

  redirect(`/events/${result.eventId}`);
}
```

`redirect` throws, which is why the success branch is typed `never` — do not wrap it in a try/catch that would swallow it.

- [ ] **Step 2: Build the form**

Create `src/app/(app)/events/new/event-form.tsx` as a `'use client'` component holding:

- Title, description, close-time and resolve-by inputs (`datetime-local`, converted to ISO on submit).
- A repeatable market block: a question input plus a repeatable outcome row (label + American price). Buttons to add/remove a market and add/remove an outcome, with a minimum of one market and two outcomes enforced in the UI **and** on the server.
- A per-market implied-probability readout: convert each price with the existing `americanToRational` and sum. Display it as e.g. "Book: 112%" — **informational only, never blocking** ([D38](../decisions.md#d38--no-exposure-cap-on-hand-priced-markets)). Label it plainly: over 100% means the creator keeps an edge.
- Error rendering keyed off the returned `CreateEventError`: `INVALID_MARKET` carries `marketIndex` and a `reason`, `INVALID_PRICE` carries `marketIndex` and `outcomeIndex`, so highlight the exact field rather than showing a banner.

Create `src/app/(app)/events/new/page.tsx` as a server component that calls `requireApprovedMember()` and renders the form.

- [ ] **Step 3: Compile the routes**

Run: `npm run build`
Expected: `/events/new` compiles. A "server actions must be async" or "cannot pass a function to a client component" error here means the boundary is wrong — the action file needs `'use server'` at the top and the form needs `'use client'`.

- [ ] **Step 4: Verify and commit**

```bash
npm run verify
git add src/app
git commit -m "feat: add the create-event screen"
```

---

### Task 18: The event page, bettable in credits, with creator controls

**Files:**

- Create: `src/app/(app)/events/[eventId]/page.tsx`, `src/app/(app)/events/[eventId]/market-card.tsx`
- Create: `src/server/events/manage.ts` (`setMarketStatus`, `editCustomEvent`)
- Modify: `src/server/events/query.ts` (add `getCustomEventDetail`), `src/components/bet-slip/slip-context.tsx`, `src/components/bet-slip/bet-slip.tsx`, `src/app/(app)/events/actions.ts`
- Test: `src/server/events/__tests__/detail.test.ts`, `src/server/events/__tests__/manage.test.ts`

**Interfaces:**

- Consumes: `listSeasonEvents` (Task 16), `placeBet` (Task 11).
- Produces: `getCustomEventDetail(eventId: string, viewerMembershipId: string): Promise<CustomEventDetail | null>` where

```ts
interface CustomEventDetail {
  eventId: string;
  title: string;
  description: string | null;
  startsAt: Date;
  resolvesBy: Date;
  status: CustomEventStatus;
  overdue: boolean;
  seasonId: string;
  creator: { membershipId: string; displayName: string };
  viewerIsCreator: boolean;
  resolution: {
    note: string | null;
    resolvedAt: Date | null;
    attempt: number;
    byDisplayName: string | null;
  };
  markets: {
    marketId: string;
    title: string;
    status: 'OPEN' | 'SUSPENDED' | 'SETTLED';
    winningSelectionId: string | null;
    outcomes: {
      selectionId: string;
      label: string;
      priceAmerican: number;
      stakedCreditsCents: bigint;
    }[];
  }[];
  viewerPositions: { marketId: string; selectionId: string; stakeCents: bigint; status: string }[];
  creatorPositions: { marketId: string; selectionId: string; stakeCents: bigint }[];
  openDisputes: { displayName: string; reason: string; createdAt: Date }[];
}
```

`creatorPositions` is not optional and not admin-only. The creator's own stake is disclosed to everyone, on every screen it can appear ([D32](../decisions.md#d32--anyone-can-create-events-and-creators-may-bet-their-own-with-disclosure)).

- [ ] **Step 1: Write the failing test**

Create `src/server/events/__tests__/detail.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '@/db/client';
import { placeBet } from '@/server/bets/place';
import { disputeResolution } from '@/server/events/dispute';
import { getCustomEventDetail } from '@/server/events/query';
import { resolveCustomEvent } from '@/server/events/resolve';
import { postEntry } from '@/server/money/ledger';
import { resetDb } from '@/test/db';
import { makeCustomEvent } from '@/test/factories';
import { makeMembership } from '@/server/bets/__tests__/helpers';

async function grant(membershipId: string) {
  await db.transaction((tx) =>
    postEntry(tx, {
      membershipId,
      amountCents: 100_000n,
      type: 'SEASON_STARTING_GRANT',
      currency: 'CREDITS',
      idempotencyKey: `credits:${membershipId}`,
    }),
  );
}

async function seed() {
  const creator = await makeMembership(1_000_000n);
  const viewer = await makeMembership(1_000_000n, creator.seasonId);
  await grant(creator.membership.id);
  await grant(viewer.membership.id);

  const event = await makeCustomEvent({
    creatorMembershipId: creator.membership.id,
    seasonId: creator.seasonId,
  });

  return { creator, viewer, event };
}

describe('getCustomEventDetail', () => {
  beforeEach(resetDb);

  it('discloses the creator’s own position to a viewer who is not the creator', async () => {
    const { creator, viewer, event } = await seed();

    await placeBet({
      userId: creator.user.id,
      type: 'SINGLE',
      stakeCents: 5_000n,
      clientRequestId: randomUUID(),
      legs: [
        { selectionId: event.marketSelections[0].selectionIds[0], line: null, priceAmerican: 100 },
      ],
    });

    const detail = await getCustomEventDetail(event.eventId, viewer.membership.id);

    expect(detail).not.toBeNull();
    expect(detail!.viewerIsCreator).toBe(false);
    expect(detail!.creatorPositions).toEqual([
      {
        marketId: event.marketSelections[0].marketId,
        selectionId: event.marketSelections[0].selectionIds[0],
        stakeCents: 5_000n,
      },
    ]);
  });

  it('returns null to a member of another season', async () => {
    const { event } = await seed();
    const outsider = await makeMembership();

    expect(await getCustomEventDetail(event.eventId, outsider.membership.id)).toBeNull();
  });

  it('reports the winning selection only after resolution', async () => {
    const { creator, viewer, event } = await seed();

    const before = await getCustomEventDetail(event.eventId, viewer.membership.id);
    expect(before!.markets.every((m) => m.winningSelectionId === null)).toBe(true);

    await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: creator.user.id,
      actorMembershipId: creator.membership.id,
      isAdmin: false,
      winners: event.marketSelections.map((m) => ({
        marketId: m.marketId,
        winningSelectionId: m.selectionIds[0],
      })),
    });

    const after = await getCustomEventDetail(event.eventId, viewer.membership.id);
    expect(after!.status).toBe('RESOLVED');
    for (const m of event.marketSelections) {
      const market = after!.markets.find((x) => x.marketId === m.marketId)!;
      expect(market.winningSelectionId).toBe(m.selectionIds[0]);
    }
  });

  it('lists only unresolved disputes', async () => {
    const { creator, viewer, event } = await seed();

    await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: creator.user.id,
      actorMembershipId: creator.membership.id,
      isAdmin: false,
      winners: event.marketSelections.map((m) => ({
        marketId: m.marketId,
        winningSelectionId: m.selectionIds[0],
      })),
    });

    await disputeResolution({
      eventId: event.eventId,
      membershipId: viewer.membership.id,
      reason: 'the bracket says otherwise',
    });

    const detail = await getCustomEventDetail(event.eventId, viewer.membership.id);
    expect(detail!.openDisputes).toHaveLength(1);
    expect(detail!.openDisputes[0].reason).toBe('the bracket says otherwise');
  });
});
```

- [ ] **Step 2: Run it to verify it fails, then implement `getCustomEventDetail`**

Run: `npx vitest run src/server/events/__tests__/detail.test.ts`
Expected: FAIL — `getCustomEventDetail` is not exported. Implement until PASS.

Authorization is inside the query, not in the page: it takes `viewerMembershipId`, resolves that membership's `seasonId`, and returns `null` when the event's season differs. A page that forgets to check is then safe by construction.

- [ ] **Step 2b: Write the creator-controls test**

Create `src/server/events/__tests__/manage.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/db/client';
import { markets, selections } from '@/db/schema';
import { placeBet } from '@/server/bets/place';
import { editCustomEvent, setMarketStatus } from '@/server/events/manage';
import { postEntry } from '@/server/money/ledger';
import { resetDb } from '@/test/db';
import { makeCustomEvent } from '@/test/factories';
import { makeMembership } from '@/server/bets/__tests__/helpers';

async function seed() {
  const creator = await makeMembership(1_000_000n);
  const other = await makeMembership(1_000_000n, creator.seasonId);
  for (const m of [creator.membership.id, other.membership.id]) {
    await db.transaction((tx) =>
      postEntry(tx, {
        membershipId: m,
        amountCents: 100_000n,
        type: 'SEASON_STARTING_GRANT',
        currency: 'CREDITS',
        idempotencyKey: `credits:${m}`,
      }),
    );
  }
  const event = await makeCustomEvent({
    creatorMembershipId: creator.membership.id,
    seasonId: creator.seasonId,
  });
  return { creator, other, event };
}

describe('setMarketStatus', () => {
  beforeEach(resetDb);

  it('lets the creator suspend and reopen a market', async () => {
    const { creator, event } = await seed();
    const marketId = event.marketSelections[0].marketId;

    expect(
      await setMarketStatus({
        marketId,
        status: 'SUSPENDED',
        actorMembershipId: creator.membership.id,
        isAdmin: false,
      }),
    ).toEqual({ ok: true });

    const [suspended] = await db.select().from(markets).where(eq(markets.id, marketId));
    expect(suspended.status).toBe('SUSPENDED');

    await setMarketStatus({
      marketId,
      status: 'OPEN',
      actorMembershipId: creator.membership.id,
      isAdmin: false,
    });
    const [reopened] = await db.select().from(markets).where(eq(markets.id, marketId));
    expect(reopened.status).toBe('OPEN');
  });

  it('rejects a member who is neither creator nor admin', async () => {
    const { other, event } = await seed();

    expect(
      await setMarketStatus({
        marketId: event.marketSelections[0].marketId,
        status: 'SUSPENDED',
        actorMembershipId: other.membership.id,
        isAdmin: false,
      }),
    ).toEqual({ ok: false, error: { code: 'NOT_AUTHORIZED' } });
  });
});

describe('editCustomEvent', () => {
  beforeEach(resetDb);

  it('reprices an outcome while the event has no bets', async () => {
    const { creator, event } = await seed();

    const result = await editCustomEvent({
      eventId: event.eventId,
      actorMembershipId: creator.membership.id,
      title: 'Test Cup (rescheduled)',
      markets: event.marketSelections.map((m) => ({
        marketId: m.marketId,
        title: m.marketTitle,
        outcomes: m.selectionIds.map((selectionId, i) => ({
          selectionId,
          priceAmerican: i === 0 ? -200 : 160,
        })),
      })),
    });

    expect(result).toEqual({ ok: true });

    const [outcome] = await db
      .select()
      .from(selections)
      .where(eq(selections.id, event.marketSelections[0].selectionIds[0]));
    expect(outcome.priceAmerican).toBe(-200);
  });

  it('refuses once a single credit is at risk', async () => {
    const { creator, other, event } = await seed();

    await placeBet({
      userId: other.user.id,
      type: 'SINGLE',
      stakeCents: 1_000n,
      clientRequestId: randomUUID(),
      legs: [
        { selectionId: event.marketSelections[0].selectionIds[0], line: null, priceAmerican: 100 },
      ],
    });

    const result = await editCustomEvent({
      eventId: event.eventId,
      actorMembershipId: creator.membership.id,
      title: 'Too late',
      markets: [],
    });

    expect(result).toEqual({ ok: false, error: { code: 'EVENT_HAS_BETS' } });
  });
});
```

- [ ] **Step 2c: Implement the creator controls**

Create `src/server/events/manage.ts` with two functions:

```ts
export type ManageError =
  | { code: 'EVENT_NOT_FOUND' }
  | { code: 'MARKET_NOT_FOUND' }
  | { code: 'NOT_AUTHORIZED' }
  | { code: 'EVENT_NOT_OPEN' }
  | { code: 'EVENT_HAS_BETS' };

export async function setMarketStatus(input: {
  marketId: string;
  status: 'OPEN' | 'SUSPENDED';
  actorMembershipId: string;
  isAdmin: boolean;
}): Promise<{ ok: true } | { ok: false; error: ManageError }>;

export async function editCustomEvent(input: {
  eventId: string;
  actorMembershipId: string;
  title?: string;
  description?: string;
  markets: {
    marketId: string;
    title: string;
    outcomes: { selectionId: string; priceAmerican: number }[];
  }[];
}): Promise<{ ok: true } | { ok: false; error: ManageError }>;
```

The rules, straight from the spec:

- **Suspension is the only lever after bets exist.** It stops new bets and touches nothing placed. Allowed for the creator or an admin, while the event is `OPEN`. Reopening is allowed while `OPEN` and `starts_at` has not passed.
- **Editing requires zero bets.** Count `bet_legs` joined through `selections → markets` for the event inside the transaction; any row at all returns `EVENT_HAS_BETS`. Placed bets are immune to repricing anyway ([D10](../decisions.md#d10--legs-freeze-their-line-and-price-at-placement)) — this rule exists so the _displayed_ market cannot change out from under people who have already acted on it.
- Prices go through `americanToRational` for validation, exactly as `createCustomEvent` does. Reuse that check rather than re-deriving it.
- Neither function emits a feed card. Creating, resolving, disputing and voiding are league news; a creator fixing a typo before anyone has bet is not.

Add `suspendMarketAction` and `editEventAction` to `src/app/(app)/events/actions.ts`, both gated on `requireApprovedMemberOrThrow()`.

- [ ] **Step 3: Teach the bet slip about credits**

`src/components/bet-slip/slip-context.tsx` holds the selected legs. Add a `currency: 'CASH' | 'CREDITS'` derived from the first leg added, and **refuse to add a leg of the other kind** — surfacing "clear your slip to bet on an event" rather than letting the server reject it. The server check from Task 11 stays; this is a courtesy, not the enforcement.

`bet-slip.tsx` renders the stake in the slip's currency and reads the matching balance. The `Money` component takes cents; add a `currency` prop that switches the prefix (`$` for cash, `©` or a "cr" suffix for credits — pick one and use it everywhere).

- [ ] **Step 4: Build the page**

`src/app/(app)/events/[eventId]/page.tsx` is a server component using `PageProps<'/events/[eventId]'>`. It renders:

- Header: title, description, creator name, close time, resolve-by, status badge (plus **Overdue** when derived).
- One `<MarketCard>` per market: the question and its outcomes as tappable price buttons that add to the slip. A `SUSPENDED` or `SETTLED` market renders its outcomes as static rows, not buttons. After resolution the winning outcome is marked.
- **The creator's position**, rendered inline under each market where they hold one, labelled "creator".
- The viewer's own positions.
- Resolution note and any open disputes, quoted with the disputer's name.
- The state-appropriate control: **Resolve** (creator or admin, while `OPEN`), **Dispute** (any season member, while `RESOLVED`), nothing while `VOIDED`. These land in Task 19.
- Creator-only controls from Step 2c: a **Suspend / Reopen** toggle per market while the event is `OPEN`, and an **Edit** link shown only while the event has no bets. A suspended market renders its outcomes as static rows with a "Suspended" badge, so the reason betting stopped is visible rather than mysterious.

- [ ] **Step 5: Compile, verify, commit**

```bash
npm run build
npm run verify
git add src
git commit -m "feat: add the event detail page and credit betting in the slip"
```

---

### Task 19: Resolving and disputing from the UI

**Files:**

- Create: `src/app/(app)/events/[eventId]/resolve/page.tsx`, `src/app/(app)/events/[eventId]/resolve/resolve-form.tsx`, `src/app/(app)/events/[eventId]/dispute-form.tsx`
- Modify: `src/app/(app)/events/actions.ts`
- Test: none new — the services are covered by Tasks 12 and 13.

**Interfaces:**

- Consumes: `resolveCustomEvent` (Task 12), `disputeResolution` (Task 13).
- Produces: `resolveEventAction(input: { eventId: string; winners: { marketId: string; winningSelectionId: string }[]; note: string })` and `disputeEventAction(input: { eventId: string; reason: string })`.

- [ ] **Step 1: Add the actions**

Append to `src/app/(app)/events/actions.ts`:

```ts
export async function resolveEventAction(input: {
  eventId: string;
  winners: { marketId: string; winningSelectionId: string }[];
  note: string;
}) {
  const member = await requireApprovedMemberOrThrow();

  const result = await resolveCustomEvent({
    eventId: input.eventId,
    actorUserId: member.userId,
    actorMembershipId: member.membershipId,
    // The service decides what an admin may do; the action only reports who is asking.
    isAdmin: member.role === 'ADMIN',
    winners: input.winners,
    note: input.note,
  });

  if (!result.ok) return result;
  redirect(`/events/${input.eventId}`);
}

export async function disputeEventAction(input: { eventId: string; reason: string }) {
  const member = await requireApprovedMemberOrThrow();
  return disputeResolution({
    eventId: input.eventId,
    membershipId: member.membershipId,
    reason: input.reason,
  });
}
```

Check the exact field names on `ApprovedMember` in `src/server/auth/session.ts` / `identity.ts` before writing this — use whatever `requireApprovedMemberOrThrow()` actually returns rather than assuming `userId` / `role` / `membershipId`.

- [ ] **Step 2: Build the resolve screen**

`resolve/page.tsx` loads `getCustomEventDetail`, and **redirects to the event page unless the viewer is the creator or an admin** — server-side, before rendering anything. It renders `<ResolveForm>` with one radio group per market (options in `sort_order`), a note field, and a confirmation line naming what will be paid.

The note is **required when `resolution.attempt >= 1`** (a re-resolution) and optional otherwise. Mark it accordingly in the UI, and let the server's `NOTE_REQUIRED` be the real gate.

Render the returned error codes plainly: `INCOMPLETE_RESOLUTION` means a market has no selection ("pick a winner for every market"), `RE_RESOLUTION_IS_ADMIN_ONLY` means the creator has already called it and an admin must correct it.

- [ ] **Step 3: Build the dispute form**

`dispute-form.tsx` is a `'use client'` component with a reason textarea (≤ 500 chars) and a submit that calls `disputeEventAction`. Shown on the event page only when the event is `RESOLVED` and the viewer has not already disputed it. After a successful dispute, render the disputer's own reason back rather than the form.

- [ ] **Step 4: Compile, verify, commit**

```bash
npm run build
npm run verify
git add src/app
git commit -m "feat: resolve and dispute custom events from the UI"
```

---

### Task 20: The admin events screen

**Files:**

- Create: `src/app/admin/events/page.tsx`, `src/app/admin/events/actions.ts`
- Modify: `src/server/events/query.ts` (add `listAdminEventQueue`)
- Modify: `src/app/admin/page.tsx` (link to it)
- Test: `src/server/events/__tests__/admin-queue.test.ts`

**Interfaces:**

- Consumes: `voidCustomEvent` (Task 14), `resolveCustomEvent` (Task 12).
- Produces: `listAdminEventQueue(seasonId: string, now?: Date): Promise<{ overdue: EventBoardRow[]; disputed: (EventBoardRow & { disputes: { displayName: string; reason: string }[] })[] }>`; `voidEventAction({ eventId, note })`.

- [ ] **Step 1: Write the failing test**

Create `src/server/events/__tests__/admin-queue.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { disputeResolution } from '@/server/events/dispute';
import { listAdminEventQueue } from '@/server/events/query';
import { resolveCustomEvent } from '@/server/events/resolve';
import { resetDb } from '@/test/db';
import { makeCustomEvent } from '@/test/factories';
import { makeMembership, makeUser } from '@/server/bets/__tests__/helpers';

const LATE = {
  startsAt: new Date(Date.now() - 4 * 86_400_000),
  resolvesBy: new Date(Date.now() - 86_400_000),
};

describe('listAdminEventQueue', () => {
  beforeEach(resetDb);

  it('lists an open, past-due event under overdue only', async () => {
    const { membership, seasonId } = await makeMembership();
    const event = await makeCustomEvent({
      creatorMembershipId: membership.id,
      seasonId,
      ...LATE,
    });

    const queue = await listAdminEventQueue(seasonId);

    expect(queue.overdue.map((r) => r.eventId)).toEqual([event.eventId]);
    expect(queue.disputed).toEqual([]);
  });

  it('lists a disputed event with the disputer and their reason', async () => {
    const creator = await makeMembership();
    const bettor = await makeMembership(1_000_000n, creator.seasonId);
    const event = await makeCustomEvent({
      creatorMembershipId: creator.membership.id,
      seasonId: creator.seasonId,
    });

    await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: creator.user.id,
      actorMembershipId: creator.membership.id,
      isAdmin: false,
      winners: event.marketSelections.map((m) => ({
        marketId: m.marketId,
        winningSelectionId: m.selectionIds[0],
      })),
    });
    await disputeResolution({
      eventId: event.eventId,
      membershipId: bettor.membership.id,
      reason: 'the bracket says otherwise',
    });

    const queue = await listAdminEventQueue(creator.seasonId);

    expect(queue.overdue).toEqual([]);
    expect(queue.disputed).toHaveLength(1);
    expect(queue.disputed[0].eventId).toBe(event.eventId);
    expect(queue.disputed[0].disputes).toEqual([
      { displayName: bettor.user.displayName, reason: 'the bracket says otherwise' },
    ]);
  });

  it('drops an event once its disputes are answered', async () => {
    const creator = await makeMembership();
    const bettor = await makeMembership(1_000_000n, creator.seasonId);
    const adminUser = await makeUser({ role: 'ADMIN' });
    const event = await makeCustomEvent({
      creatorMembershipId: creator.membership.id,
      seasonId: creator.seasonId,
    });

    const winners = (i: number) =>
      event.marketSelections.map((m) => ({
        marketId: m.marketId,
        winningSelectionId: m.selectionIds[i],
      }));

    await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: creator.user.id,
      actorMembershipId: creator.membership.id,
      isAdmin: false,
      winners: winners(0),
    });
    await disputeResolution({
      eventId: event.eventId,
      membershipId: bettor.membership.id,
      reason: 'wrong',
    });
    await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: adminUser.id,
      actorMembershipId: creator.membership.id,
      isAdmin: true,
      note: 'corrected after review',
      winners: winners(1),
    });

    const queue = await listAdminEventQueue(creator.seasonId);
    expect(queue.disputed).toEqual([]);
  });

  it('never shows another season’s events', async () => {
    const a = await makeMembership();
    const b = await makeMembership();
    await makeCustomEvent({ creatorMembershipId: a.membership.id, seasonId: a.seasonId, ...LATE });

    const queue = await listAdminEventQueue(b.seasonId);
    expect(queue).toEqual({ overdue: [], disputed: [] });
  });
});
```

- [ ] **Step 2: Implement `listAdminEventQueue`, then the screen**

`src/app/admin/events/page.tsx` calls `requireAdmin()` first — the gate is server-side, and the screen must not be reachable by URL for a non-admin.

It renders two sections. **Overdue** rows show the creator, how late the event is, and how many bets are open, with a _Void_ control that takes a mandatory note. **Disputed** rows quote each dispute and link to the resolve screen, where an admin can re-resolve.

`voidEventAction` mirrors the other actions: `requireAdmin()`, call `voidCustomEvent`, return the error or redirect.

- [ ] **Step 3: Compile, verify, commit**

```bash
npm run build
npm run verify
git add src
git commit -m "feat: add the admin queue for overdue and disputed events"
```

---

### Task 21: Two currencies across the existing screens

**Files:**

- Modify: `src/components/ui/tab-bar.tsx`, `src/components/ui/money.tsx`, `src/app/(app)/standings/page.tsx`, `src/app/(app)/me/page.tsx`, `src/app/(app)/bets/page.tsx`, `src/app/(app)/feed/feed-card.tsx`
- Test: `src/server/events/__tests__/standings-credits.test.ts` (if a query is extracted) — otherwise none new

**Interfaces:**

- Consumes: `season_memberships.credits_balance_cents` (Task 1), the five feed types (Task 9).
- Produces: no new module-level exports; this is presentation.

- [ ] **Step 1: Six tabs**

`src/components/ui/tab-bar.tsx` gains `{ href: '/events', label: 'Events' }` after Games, and `grid-cols-5` becomes `grid-cols-6`. Update the doc comment: six tabs, Games still the landing route.

If six tabs read as crowded on a real phone, the documented fallback is a segmented control on the Games screen rather than a seventh tab — note it in the comment, do not build it now.

**Visual polish across Tasks 16–21 is explicitly deferred.** The bar for these screens is that they are correct, authorized server-side, and complete enough to exercise every path the services expose — not that they are finished design. Match the existing screens' Tailwind idiom, keep the markup plain, and leave refinement for a later pass. Do not spend task budget on layout experiments.

- [ ] **Step 2: Standings gets a second scoreboard**

`src/app/(app)/standings/page.tsx` keeps its existing cash leaderboard **exactly as it is** — ranking, tie handling, links to member profiles, all unchanged. Below it, add a second table ranking `credits_balance_cents` descending, under a heading that makes the separation obvious ("Credits — custom events"). A short line of copy states the rule: credits are granted, never converted, and do not affect the season standings.

- [ ] **Step 3: Me shows both balances**

`src/app/(app)/me/page.tsx` renders the credits balance beside the cash balance, and the ledger list gains a currency marker on each row. The `LABELS` map is unchanged — the entry types are the same in both denominations, which is the point of [D34](../decisions.md#d34--currency-is-a-dimension-on-the-existing-ledger-not-a-second-ledger).

- [ ] **Step 4: My Bets filters by currency**

`src/app/(app)/bets/page.tsx` gains a two-way filter (Cash / Credits) applied in the query as `eq(bets.currency, …)`, defaulting to cash. Its existing join to `games` becomes kind-aware in the same shape `place.ts` used in Task 11 — a bet on a custom event has no teams to render, so it shows event title, market title and outcome label instead.

- [ ] **Step 5: Feed cards for five new types**

`src/app/(app)/feed/feed-card.tsx` renders each new type. Copy, so the UI has no room for invention:

| Type                    | Reads as                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| `CUSTOM_EVENT_CREATED`  | _Dana_ opened **Jyxnzi Cup** · 3 markets · closes Fri 8pm                                     |
| `CUSTOM_EVENT_RESOLVED` | **Jyxnzi Cup** resolved by _Dana_ · Falcons win (with a "correction" badge when `correction`) |
| `CUSTOM_EVENT_DISPUTED` | _Sam_ disputed **Jyxnzi Cup** — "map 3 was forfeited"                                         |
| `CUSTOM_EVENT_VOIDED`   | **Jyxnzi Cup** voided by admin _Chris_ · 4 bets refunded                                      |
| `CUSTOM_EVENT_OVERDUE`  | **Jyxnzi Cup** is past its resolve-by date · 4 bets open                                      |

Each card title links to `/events/[eventId]`. `BET_PLACED` and `BET_SETTLED` cards render credit amounts in the credits unit and show the "creator" badge when a leg carries `byCreator`.

- [ ] **Step 6: Compile, verify, commit**

```bash
npm run build
npm run verify
git add src
git commit -m "feat: surface credits and custom events across the existing screens"
```

---

### Task 22: End-to-end and documentation

**Files:**

- Modify: `src/server/__tests__/end-to-end.test.ts`
- Modify: `docs/specs/2026-08-17-custom-events-design.md` (status line), `docs/roadmap.md`, `docs/README.md`

**Interfaces:**

- Consumes: everything.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Add a second arc to `src/server/__tests__/end-to-end.test.ts`, following the existing test's structure and reusing whatever season/user helpers it already sets up:

```ts
it('runs a custom event from creation through dispute and correction', async () => {
  // 1. An active season that grants both currencies.
  const season = await createSeason({
    name: 'Custom events season',
    startsAt: new Date('2026-09-01T00:00:00Z'),
    endsAt: new Date('2027-01-31T00:00:00Z'),
    startingBankrollCents: 1_000_000n,
    weeklyAllowanceCents: 50_000n,
    startingCreditsCents: 100_000n,
    weeklyCreditAllowanceCents: 10_000n,
  });
  await db.update(seasons).set({ status: 'ACTIVE' }).where(eq(seasons.id, season.id));

  const creatorUser = await makeUser();
  const bettorUser = await makeUser();
  const adminUser = await makeUser({ role: 'ADMIN' });

  const creator = await joinSeason(creatorUser.id, season.id);
  const bettor = await joinSeason(bettorUser.id, season.id);

  expect(creator.balanceCents).toBe(1_000_000n);
  expect(creator.creditsBalanceCents).toBe(100_000n);

  // 2. The creator opens a two-market event.
  const created = await createCustomEvent({
    creatorMembershipId: creator.membershipId,
    title: 'Jyxnzi Cup',
    startsAt: new Date(Date.now() + 3_600_000),
    resolvesBy: new Date(Date.now() + 7 * 86_400_000),
    markets: [
      {
        title: 'Who wins the cup?',
        outcomes: [
          { label: 'Falcons', priceAmerican: 100 },
          { label: 'Ravens', priceAmerican: 100 },
        ],
      },
      {
        title: 'Who wins map 1?',
        outcomes: [
          { label: 'Falcons', priceAmerican: 100 },
          { label: 'Ravens', priceAmerican: 100 },
        ],
      },
    ],
  });
  if (!created.ok) throw new Error('expected the event to be created');

  const eventMarkets = await db
    .select({ id: markets.id, title: markets.title })
    .from(markets)
    .where(eq(markets.eventId, created.eventId))
    .orderBy(asc(markets.createdAt));

  const outcomesFor = async (marketId: string) =>
    db
      .select({ id: selections.id, label: selections.label })
      .from(selections)
      .where(eq(selections.marketId, marketId))
      .orderBy(asc(selections.sortOrder));

  const cupOutcomes = await outcomesFor(eventMarkets[0].id);
  const mapOutcomes = await outcomesFor(eventMarkets[1].id);

  // 3. The bettor takes Ravens in the cup; the creator takes Falcons on map 1.
  const bettorBet = await placeBet({
    userId: bettorUser.id,
    type: 'SINGLE',
    stakeCents: 20_000n,
    clientRequestId: randomUUID(),
    legs: [{ selectionId: cupOutcomes[1].id, line: null, priceAmerican: 100 }],
  });
  const creatorBet = await placeBet({
    userId: creatorUser.id,
    type: 'SINGLE',
    stakeCents: 10_000n,
    clientRequestId: randomUUID(),
    legs: [{ selectionId: mapOutcomes[0].id, line: null, priceAmerican: 100 }],
  });
  if (!bettorBet.ok || !creatorBet.ok) throw new Error('expected both placements to succeed');

  const balances = async (membershipId: string) => {
    const [row] = await db
      .select({
        cash: seasonMemberships.balanceCents,
        credits: seasonMemberships.creditsBalanceCents,
      })
      .from(seasonMemberships)
      .where(eq(seasonMemberships.id, membershipId));
    return row;
  };

  // Credits moved; cash did not budge for anyone.
  expect(await balances(bettor.membershipId)).toEqual({ cash: 1_000_000n, credits: 80_000n });
  expect(await balances(creator.membershipId)).toEqual({ cash: 1_000_000n, credits: 90_000n });

  // 4. The creator resolves both markets for Falcons — the bettor loses, the creator wins.
  const first = await resolveCustomEvent({
    eventId: created.eventId,
    actorUserId: creatorUser.id,
    actorMembershipId: creator.membershipId,
    isAdmin: false,
    winners: [
      { marketId: eventMarkets[0].id, winningSelectionId: cupOutcomes[0].id },
      { marketId: eventMarkets[1].id, winningSelectionId: mapOutcomes[0].id },
    ],
  });
  expect(first).toMatchObject({ ok: true, attempt: 1, betsSettled: 2 });

  expect(await balances(bettor.membershipId)).toEqual({ cash: 1_000_000n, credits: 80_000n });
  // Even money on 10,000 staked pays 20,000 back: 90,000 + 20,000.
  expect(await balances(creator.membershipId)).toEqual({ cash: 1_000_000n, credits: 110_000n });

  // 5. The bettor disputes.
  const disputed = await disputeResolution({
    eventId: created.eventId,
    membershipId: bettor.membershipId,
    reason: 'the cup final was awarded to Ravens on a forfeit',
  });
  expect(disputed).toMatchObject({ ok: true, created: true });

  // 6. An admin corrects the cup market and leaves map 1 alone.
  const second = await resolveCustomEvent({
    eventId: created.eventId,
    actorUserId: adminUser.id,
    actorMembershipId: creator.membershipId,
    isAdmin: true,
    note: 'confirmed the forfeit on the tournament page',
    winners: [
      { marketId: eventMarkets[0].id, winningSelectionId: cupOutcomes[1].id },
      { marketId: eventMarkets[1].id, winningSelectionId: mapOutcomes[0].id },
    ],
  });
  expect(second).toMatchObject({ ok: true, attempt: 2 });

  // The bettor is paid 40,000 on a 20,000 stake; the creator's win is re-graded and stands,
  // so its payout is reversed and re-paid at the same amount.
  expect(await balances(bettor.membershipId)).toEqual({ cash: 1_000_000n, credits: 120_000n });
  expect(await balances(creator.membershipId)).toEqual({ cash: 1_000_000n, credits: 110_000n });

  const [bettorRow] = await db.select().from(bets).where(eq(bets.id, bettorBet.bet.id));
  expect(bettorRow.status).toBe('WON');
  expect(bettorRow.settlementAttempts).toBe(2);
  expect(bettorRow.currency).toBe('CREDITS');

  const [customRow] = await db
    .select()
    .from(customEvents)
    .where(eq(customEvents.eventId, created.eventId));
  expect(customRow.resolutionAttempts).toBe(2);
  expect(customRow.status).toBe('RESOLVED');

  // The creator's reversal is the proof history was appended to, never edited.
  const creatorEntryTypes = (
    await db
      .select({ type: ledgerEntries.type, key: ledgerEntries.idempotencyKey })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.betId, creatorBet.bet.id))
      .orderBy(asc(ledgerEntries.createdAt))
  ).map((r) => r.type);
  expect(creatorEntryTypes).toEqual(['BET_PLACED', 'BET_WON', 'SETTLEMENT_REVERSAL', 'BET_WON']);

  // 7. The feed tells the same story, in order.
  const feedTypes = (
    await db
      .select({ type: feedEvents.type })
      .from(feedEvents)
      .where(eq(feedEvents.seasonId, season.id))
      .orderBy(asc(feedEvents.occurredAt), asc(feedEvents.id))
  ).map((r) => r.type);

  expect(feedTypes.filter((t) => t.startsWith('CUSTOM_EVENT_'))).toEqual([
    'CUSTOM_EVENT_CREATED',
    'CUSTOM_EVENT_RESOLVED',
    'CUSTOM_EVENT_DISPUTED',
    'CUSTOM_EVENT_RESOLVED',
  ]);
  expect(feedTypes.filter((t) => t === 'BET_PLACED')).toHaveLength(2);
  // Two bets settled on attempt 1, two corrected on attempt 2.
  expect(feedTypes.filter((t) => t === 'BET_SETTLED')).toHaveLength(4);

  // 8. And the ledger is intact, in both denominations, for every membership.
  expect(await reconcileBalances()).toEqual([]);
});
```

Run it and let the real numbers correct you where this sketch is off by a payout — but change an expectation only after you can explain, in one sentence, why the code's number is the right one. The final reconciliation assertion is the most valuable line in the file: it proves the whole subsystem left the ledger intact in both currencies.

- [ ] **Step 2: Run it**

Run: `npx vitest run src/server/__tests__/end-to-end.test.ts`
Expected: PASS. If reconciliation reports drift, stop and find it — do not adjust the assertion.

- [ ] **Step 3: Update the docs**

- `docs/specs/2026-08-17-custom-events-design.md`: change `**Status:** Specified, not built` to `**Status:** Built`.
- `docs/roadmap.md`: subsystem 3's row becomes `[Built](specs/2026-08-17-custom-events-design.md)`, and the intro line becomes "Subsystems 1–3 are built".
- `docs/README.md`: add subsystem 3 to _Where things stand_ with what shipped — the credits currency, the events supertype, creation, resolution, disputes, voids, the overdue sweep, and the five screens — plus the final test-file and test counts from `npm run verify`.

Record any decision you had to make during implementation that the spec did not anticipate as a new entry in `docs/decisions.md` (D39 onward), following the existing format: what was decided, what was rejected, and why. Never edit an old entry.

- [ ] **Step 4: Final verification**

Run: `npm run verify`
Expected: everything green, 0 lint errors. Note the exact file and test counts and put them in `docs/README.md`.

- [ ] **Step 5: Commit**

```bash
git add src docs
git commit -m "test: prove the custom event arc end to end"
```

---

## Definition of done

Every box above is checked, and all seven of the spec's success criteria hold:

1. Any approved member can create an event with hand-priced markets, and others can bet credits on it.
2. Cash and credits are independently correct; `reconcileBalances()` returns `[]` after every operation.
3. A resolution pays immediately, in credits, keyed idempotently.
4. A dispute plus an admin re-resolution reverses and corrects without editing history.
5. An overdue event surfaces on its own and an admin can void it, refunding every stake.
6. A mixed-currency slip is rejected, and a creator's bet on their own event is labelled everywhere.
7. `npm run verify` passes with 0 lint errors.
