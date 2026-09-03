# Hardening — the cloud half — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a mutation storm cost one member one minute rather than the ledger, give a new member
something to read before they join, turn four unrelated gate screens into one sequence, and leave a
written procedure to follow before a deploy.

**Architecture:** Eleven tasks. One new server directory, `src/server/limits/`, holding a pure
policy module and a single-statement Postgres counter consumed at the server-action boundary — so
`src/server/money/`, `src/server/bets/` and `src/server/p2p/` take no diff at all. One new table,
`rate_limits`. One new shared component, `GateScreen`, that the four pre-app screens rebuild on. One
new public route, `/rules`. One new document, `docs/smoke-checklist.md`, drafted here and validated
by a person later.

**Tech Stack:** Next.js 16.3.3 (App Router), TypeScript, Drizzle ORM + Postgres, Vitest, Tailwind v4
with this repo's semantic token layer.

**Spec:** [`docs/specs/2026-09-03-hardening-design.md`](../specs/2026-09-03-hardening-design.md).
Read it before Task 1. Decisions [D63](../decisions.md#d63--rate-limiting-is-a-postgres-fixed-window-counter-enforced-at-the-action-boundary)
through [D67](../decisions.md#d67--the-smoke-checklist-ships-unvalidated-with-a-run-log) are already
recorded.

---

## Global Constraints

These apply to every task. They are not repeated per task.

- **Lane tags are mandatory.** Every task carries `[CLOUD]`, `[LOCAL]`, `[MANUAL]` or `[NOAH]`. Do
  not start a task whose lane you are not in.
- **Do not touch `src/server/odds/` or `src/app/api/cron/sync-odds/route.ts`.** Noah has unpushed
  ESPN adapter work there. If a task seems to need an edit there, you have misread the task. The
  `reconcile` cron route, which Task 3 does edit, is not part of that work.
- **`npm ci` first** if `node_modules` is absent. The `session-start` hook installs it before the
  first turn, so it is usually already there — check rather than assume either way.
- **`npm test` runs in a cloud session now.** The hook brings up a native Postgres with no Docker
  daemon ([repo-health 3.7](../repo-health.md#37-postgres-without-docker-in-a-cloud-session)).
  Confirm with `pg_isready` before starting; the whole suite was measured at 86 files / 925 tests in
  80s on 2026-09-03. If `pg_isready` fails, the DB-marked steps below cannot run and must be left to
  CI — say so rather than reporting them green.
- **`src/server/money/`, `src/server/bets/`, `src/server/p2p/` and `src/db/schema/money.ts` must
  have zero diff when this plan is done.** That is spec success criterion 3 and the reason the
  `money-touch` hook should never fire during this work. Verify with
  `git diff main...HEAD --stat -- src/server/money src/server/bets src/server/p2p src/db/schema/money.ts`
  before the final commit; the correct output is empty.
- **The limiter never takes a `tx` handle and never runs inside `db.transaction`.** It consumes in
  its own transaction, before the money transaction opens
  ([D63](../decisions.md#d63--rate-limiting-is-a-postgres-fixed-window-counter-enforced-at-the-action-boundary),
  money invariant 3).
- **The limiter fails open.** No code path added by this plan may let a limiter failure prevent a
  bet, an offer, a comment or a reaction
  ([D64](../decisions.md#d64--the-rate-limiter-fails-open-and-counts-attempts-not-successes)).
- **Run `npm run format` before every commit.** Prettier is adopted
  ([D55](../decisions.md#d55--prettier-adopted-with-a-config-matched-to-the-existing-code)).
  `format:check` is deliberately **not** in `verify` or CI — do not add it, that is
  [repo-health outstanding 5](../repo-health.md#outstanding) and it is blocked on Noah.
- **No raw colour classes in `.tsx`.** `src/app/__tests__/token-lint.test.ts` fails the build on a
  raw palette class, a hex value, or a `dark:` variant. Use the semantic tokens the existing
  components use (`text-ink-muted`, `bg-surface-raised`, `border-line`, …).
- **Money is `bigint` cents everywhere** ([D17](../decisions.md#d17--all-money-is-integer-cents)).
  Never `Number` an amount. Only Tasks 8 and 9 render one, and both use `formatAmount` from
  `@/domain/money`.
- **Commit after every task.** Imperative subject, a body explaining why, and this repo's
  attribution footer.

---

## File Structure

| File                                                      | New?      | Responsibility                                                 |
| --------------------------------------------------------- | --------- | -------------------------------------------------------------- |
| `src/server/limits/types.ts`                              | new       | `RateLimited`, `isRateLimited` — zero imports                  |
| `src/server/limits/policy.ts`                             | new       | `BUCKETS`, `Bucket`, `windowStartFor`, `decide` — zero imports |
| `src/server/limits/consume.ts`                            | new       | `consume`, `pruneRateLimits` — the only DB-touching module     |
| `src/db/schema/limits.ts`                                 | new       | The `rate_limits` table                                        |
| `src/db/schema/index.ts`                                  | modify    | Re-export `./limits`                                           |
| `src/test/db.ts`                                          | modify    | Add `rate_limits` to the `TRUNCATE` list                       |
| `drizzle/0015_*.sql`                                      | generated | The `rate_limits` migration                                    |
| `src/app/api/cron/reconcile/route.ts`                     | modify    | Call `pruneRateLimits` beside `pruneJobRuns`                   |
| `src/app/(app)/feed/actions.ts`                           | modify    | `COMMENT` and `REACTION` buckets                               |
| `src/app/(app)/feed/feed-list.tsx`                        | modify    | Roll the optimistic reaction back on refusal                   |
| `src/app/(app)/feed/[eventId]/comment-thread.tsx`         | modify    | `RATE_LIMITED` message                                         |
| `src/app/(app)/bets/actions.ts`                           | modify    | `BET_PLACE` bucket                                             |
| `src/components/bet-slip/bet-slip.tsx`                    | modify    | `RATE_LIMITED` message                                         |
| `src/app/(app)/wagers/actions.ts`                         | modify    | `P2P_OFFER` and `P2P_RESPOND` buckets                          |
| `src/app/(app)/wagers/new/wager-form.tsx`                 | modify    | `RATE_LIMITED` message                                         |
| `src/app/(app)/events/actions.ts`                         | modify    | `EVENT_WRITE` bucket                                           |
| `src/app/(app)/events/new/event-form.tsx`                 | modify    | `RATE_LIMITED` message                                         |
| `src/app/(app)/events/[eventId]/dispute-form.tsx`         | modify    | `RATE_LIMITED` message                                         |
| `src/app/(app)/events/[eventId]/resolve/resolve-form.tsx` | modify    | `RATE_LIMITED` message                                         |
| `src/app/(app)/events/[eventId]/market-card.tsx`          | modify    | `RATE_LIMITED` message                                         |
| `src/app/admin/events/actions.ts`                         | modify    | `ADMIN_ACTION` bucket                                          |
| `src/app/admin/wagers/actions.ts`                         | modify    | `ADMIN_ACTION` bucket                                          |
| `src/app/admin/events/void-form.tsx`                      | modify    | `RATE_LIMITED` message                                         |
| `src/app/admin/wagers/arbitration-form.tsx`               | modify    | `RATE_LIMITED` message                                         |
| `src/app/admin/page.tsx`                                  | modify    | Limit `setStatus`; render the refusal                          |
| `src/app/__tests__/mutation-limits.test.ts`               | new       | Every action consumes or is a documented exemption             |
| `src/components/ui/gate-screen.tsx`                       | new       | The shared pre-app screen                                      |
| `src/app/pending/page.tsx`                                | modify    | Rebuild on `GateScreen`; add "check again"                     |
| `src/app/join/page.tsx`                                   | modify    | Rebuild on `GateScreen`                                        |
| `src/app/join/actions.ts`                                 | new       | `joinSeasonAction` — typed error, `DEFAULT` bucket             |
| `src/app/join/join-form.tsx`                              | new       | Client control with a pending state                            |
| `src/app/no-season/page.tsx`                              | modify    | Rebuild on `GateScreen`                                        |
| `src/app/disabled/page.tsx`                               | modify    | Rebuild on `GateScreen`                                        |
| `src/app/__tests__/gate-screens.test.ts`                  | new       | Four routes on one component, four titles                      |
| `src/app/rules/page.tsx`                                  | new       | The house rules                                                |
| `src/app/(app)/me/page.tsx`                               | modify    | A link to `/rules`                                             |
| `src/app/sign-in/page.tsx`                                | modify    | A link to `/rules`                                             |
| `docs/smoke-checklist.md`                                 | new       | The unvalidated draft                                          |
| `docs/README.md`, `docs/roadmap.md`                       | modify    | Rows and references                                            |

`policy.ts` and `types.ts` are split out of `consume.ts` rather than living inside it, for the
reason the spec's §2.1 gives: they are the pieces most likely to be wrong and the pieces provable
with no database in the import graph — the same split `alert-policy.ts` got in phase 6.

---

## Task 1: The pure limit policy — [CLOUD]

**Files:**

- Create: `src/server/limits/types.ts`
- Create: `src/server/limits/policy.ts`
- Test: `src/server/limits/__tests__/policy.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `RateLimited`, `isRateLimited(value)`, `BUCKETS`, `type Bucket`,
  `windowStartFor(bucket: Bucket, now: Date): Date`,
  `decide(bucket: Bucket, count: number, now: Date): RateLimited | null`. Every later task imports
  from these two files.

- [ ] **Step 1: Write the failing test**

Create `src/server/limits/__tests__/policy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BUCKETS, decide, windowStartFor } from '@/server/limits/policy';
import { isRateLimited } from '@/server/limits/types';

const at = (iso: string) => new Date(iso);

describe('windowStartFor', () => {
  it('floors to the start of the containing minute', () => {
    expect(windowStartFor('COMMENT', at('2026-09-03T12:34:56.789Z')).toISOString()).toBe(
      '2026-09-03T12:34:00.000Z',
    );
  });

  it('returns the instant itself when it is already a window boundary', () => {
    expect(windowStartFor('COMMENT', at('2026-09-03T12:34:00.000Z')).toISOString()).toBe(
      '2026-09-03T12:34:00.000Z',
    );
  });
});

describe('decide', () => {
  const now = at('2026-09-03T12:34:00.000Z');

  it('allows the first request in a window', () => {
    expect(decide('COMMENT', 1, now)).toBeNull();
  });

  it('allows the request that exactly reaches the limit', () => {
    expect(decide('COMMENT', BUCKETS.COMMENT.limit, now)).toBeNull();
  });

  it('refuses the request after the limit', () => {
    const refused = decide('COMMENT', BUCKETS.COMMENT.limit + 1, now);
    expect(refused).toEqual({ code: 'RATE_LIMITED', retryAfterSeconds: 60 });
  });

  it('counts the retry from the end of the current window, not from now', () => {
    const refused = decide('COMMENT', 99, at('2026-09-03T12:34:45.000Z'));
    expect(refused?.retryAfterSeconds).toBe(15);
  });

  it('never advises a wait of zero seconds', () => {
    // 999ms into the final millisecond of the window: ceil() would give 1, floor() would
    // give 0, and a countdown that says "try again in 0 seconds" is a bug in the copy.
    const refused = decide('COMMENT', 99, at('2026-09-03T12:34:59.999Z'));
    expect(refused?.retryAfterSeconds).toBe(1);
  });

  it('applies each bucket its own limit', () => {
    expect(decide('REACTION', 30, now)).toBeNull();
    expect(decide('BET_PLACE', 30, now)).not.toBeNull();
  });
});

describe('isRateLimited', () => {
  it('recognises the shape and rejects other error shapes', () => {
    expect(isRateLimited({ code: 'RATE_LIMITED', retryAfterSeconds: 5 })).toBe(true);
    expect(isRateLimited({ code: 'INSUFFICIENT_FUNDS' })).toBe(false);
    expect(isRateLimited(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/server/limits/__tests__/policy.test.ts`
Expected: FAIL — `Failed to resolve import "@/server/limits/policy"`.

- [ ] **Step 3: Write `types.ts`**

Create `src/server/limits/types.ts`:

```ts
/**
 * The one error shape every rate-limited action can return.
 *
 * Deliberately not a member of any domain error union — `PlaceBetError`, `OfferWagerError` and
 * the rest are untouched by rate limiting (D63). Actions widen their own return type with this
 * instead, which is what keeps `src/server/bets`, `src/server/p2p` and `src/server/money` free
 * of any diff from this work.
 */
export interface RateLimited {
  code: 'RATE_LIMITED';
  /** Whole seconds until the current window ends. Never zero. */
  retryAfterSeconds: number;
}

export function isRateLimited(value: unknown): value is RateLimited {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { code?: unknown }).code === 'RATE_LIMITED'
  );
}
```

- [ ] **Step 4: Write `policy.ts`**

Create `src/server/limits/policy.ts`:

```ts
import type { RateLimited } from './types';

/**
 * What each mutation bucket allows, and over what window (D63).
 *
 * One window per bucket, minute-scale, and no hourly tier. What this guards against is a
 * runaway render loop or an impatient double-tap, not an adversary — a member spamming
 * steadily for an hour in a private group of four is a social problem with a social fix, and
 * an hourly tier would double the query count on every mutation to address it.
 *
 * Deliberately a module with no imports but its own types. It is the piece of this subsystem
 * most likely to be wrong, and nothing in its import graph should need a database.
 */
export const BUCKETS = {
  BET_PLACE: { limit: 10, windowMs: 60_000 },
  P2P_OFFER: { limit: 10, windowMs: 60_000 },
  P2P_RESPOND: { limit: 20, windowMs: 60_000 },
  EVENT_WRITE: { limit: 10, windowMs: 60_000 },
  COMMENT: { limit: 10, windowMs: 60_000 },
  REACTION: { limit: 30, windowMs: 60_000 },
  ADMIN_ACTION: { limit: 30, windowMs: 60_000 },
  DEFAULT: { limit: 30, windowMs: 60_000 },
} as const;

export type Bucket = keyof typeof BUCKETS;

/**
 * The start of the fixed window `now` falls in. Computed here rather than in SQL so the
 * arithmetic is testable without a database.
 */
export function windowStartFor(bucket: Bucket, now: Date): Date {
  const { windowMs } = BUCKETS[bucket];
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

/**
 * `count` is the value the counter holds *after* this request was counted, so the request that
 * brings it exactly to the limit is the last allowed one.
 */
export function decide(bucket: Bucket, count: number, now: Date): RateLimited | null {
  const { limit, windowMs } = BUCKETS[bucket];
  if (count <= limit) return null;

  const windowEndMs = windowStartFor(bucket, now).getTime() + windowMs;
  return {
    code: 'RATE_LIMITED',
    // Never zero: a countdown that reads "try again in 0 seconds" is a bug in the copy.
    retryAfterSeconds: Math.max(1, Math.ceil((windowEndMs - now.getTime()) / 1_000)),
  };
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx vitest run src/server/limits/__tests__/policy.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 6: Format, typecheck, commit**

```bash
npm run format
npm run typecheck
git add src/server/limits
git commit -m "feat(limits): add the pure rate-limit policy"
```

---

## Task 2: The `rate_limits` table and `consume` — [CLOUD]

**Files:**

- Create: `src/db/schema/limits.ts`
- Modify: `src/db/schema/index.ts`
- Modify: `src/test/db.ts`
- Create: `src/server/limits/consume.ts`
- Test: `src/server/limits/__tests__/consume.test.ts` (**DB**)
- Generated: `drizzle/0015_*.sql`

**Interfaces:**

- Consumes: `BUCKETS`, `Bucket`, `decide`, `windowStartFor` from Task 1; `RateLimited` from Task 1.
- Produces: `rateLimits` (the Drizzle table) and
  `consume(subjectId: string, bucket: Bucket, now?: Date): Promise<RateLimited | null>` — `null`
  means allowed. Tasks 4 through 7 call exactly this.

- [ ] **Step 1: Write the schema**

Create `src/db/schema/limits.ts`:

```ts
import { integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * The fixed-window mutation counter (D63). One row per subject, bucket and window.
 *
 * `subject_id` is the session's user id — never an IP, and never anything the client sends.
 * Every mutation in this app is behind Google OAuth and an admin approval, so there is no
 * anonymous surface to protect, and an IP key would throttle two members on one home network
 * as though they were one person.
 *
 * `bucket` is text rather than a pgEnum on purpose: unlike `job_name`, which the health page
 * reads and renders, nothing outside `src/server/limits/policy.ts` interprets this column, and
 * an enum would need a migration every time a bucket is added.
 *
 * No foreign key to `users`. A row here is a counter, not a record — cascading a user delete
 * into rate-limit history is noise, and the counter must keep working during any moment the
 * users table is locked.
 */
export const rateLimits = pgTable(
  'rate_limits',
  {
    subjectId: uuid('subject_id').notNull(),
    bucket: text('bucket').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.subjectId, t.bucket, t.windowStart] })],
);
```

- [ ] **Step 2: Re-export it and add it to the test truncate list**

In `src/db/schema/index.ts`, add the line after `export * from './ops';`:

```ts
export * from './limits';
```

In `src/test/db.ts`, add `rate_limits` to the front of the `TRUNCATE` list so the table is
cleared between tests:

```ts
    sql`TRUNCATE TABLE rate_limits, job_runs, feed_reactions, feed_comments, feed_events, feed_preferences, ledger_entries, p2p_wagers, bet_legs, bets, odds_snapshots, selections, markets, games, custom_event_disputes, custom_events, events, teams, season_memberships, seasons, users RESTART IDENTITY CASCADE`,
```

- [ ] **Step 3: Generate and apply the migration**

```bash
npm run db:generate
npm run db:migrate:test
```

Expected: a new `drizzle/0015_*.sql` creating `rate_limits`, and a clean migrate against the test
database. Read the generated SQL before continuing — it must contain `CREATE TABLE "rate_limits"`
and a three-column primary key, and must not `DROP` anything.

- [ ] **Step 4: Write the failing test**

Create `src/server/limits/__tests__/consume.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/client';
import { rateLimits } from '@/db/schema';
import { BUCKETS } from '@/server/limits/policy';
import { consume } from '@/server/limits/consume';
import { resetDb } from '@/test/db';

const SUBJECT = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const at = (iso: string) => new Date(iso);

beforeEach(async () => {
  await resetDb();
});

afterEach(() => vi.restoreAllMocks());

describe('consume', () => {
  it('allows every request up to the limit and refuses the next', async () => {
    const now = at('2026-09-03T12:34:00.000Z');

    for (let i = 0; i < BUCKETS.COMMENT.limit; i++) {
      expect(await consume(SUBJECT, 'COMMENT', now)).toBeNull();
    }

    const refused = await consume(SUBJECT, 'COMMENT', now);
    expect(refused).toEqual({ code: 'RATE_LIMITED', retryAfterSeconds: 60 });
  });

  it('starts a fresh count in the next window', async () => {
    const first = at('2026-09-03T12:34:00.000Z');
    for (let i = 0; i <= BUCKETS.COMMENT.limit; i++) await consume(SUBJECT, 'COMMENT', first);

    expect(await consume(SUBJECT, 'COMMENT', at('2026-09-03T12:35:00.000Z'))).toBeNull();
  });

  it('keeps buckets independent', async () => {
    const now = at('2026-09-03T12:34:00.000Z');
    for (let i = 0; i <= BUCKETS.COMMENT.limit; i++) await consume(SUBJECT, 'COMMENT', now);

    expect(await consume(SUBJECT, 'REACTION', now)).toBeNull();
  });

  it('keeps subjects independent', async () => {
    const now = at('2026-09-03T12:34:00.000Z');
    for (let i = 0; i <= BUCKETS.COMMENT.limit; i++) await consume(SUBJECT, 'COMMENT', now);

    expect(await consume(OTHER, 'COMMENT', now)).toBeNull();
  });

  it('counts the attempt exactly once per call', async () => {
    const now = at('2026-09-03T12:34:00.000Z');
    await consume(SUBJECT, 'BET_PLACE', now);
    await consume(SUBJECT, 'BET_PLACE', now);

    const rows = await db.select().from(rateLimits);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(2);
  });

  it('fails open when the counter query throws', async () => {
    const boom = new Error('connection terminated');
    vi.spyOn(db, 'insert').mockImplementation(() => {
      throw boom;
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await consume(SUBJECT, 'BET_PLACE')).toBeNull();
    expect(logged).toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run the test and confirm it fails**

Run: `npx vitest run src/server/limits/__tests__/consume.test.ts`
Expected: FAIL — `Failed to resolve import "@/server/limits/consume"`.

- [ ] **Step 6: Write `consume.ts`**

Create `src/server/limits/consume.ts`:

```ts
import { lt, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { rateLimits } from '@/db/schema';
import { decide, windowStartFor, type Bucket } from './policy';
import type { RateLimited } from './types';

/**
 * Count one attempt against a bucket. Returns `null` when the request may proceed, and a
 * `RateLimited` when it may not (D63).
 *
 * **Never pass this a transaction handle, and never call it inside `db.transaction`.** It runs
 * in its own transaction, before the caller's, so that a counter conflict can never abort a
 * money write that had already been decided, and a money rollback can never silently refund a
 * token (money invariant 3).
 *
 * The counter increments on the attempt and is never refunded when the service rejects the
 * request (D64). Refunding reads fairer and hands anyone with a rejected-request loop an
 * unlimited retry budget, which is the case the limit exists for.
 *
 * One statement, not a read followed by a write, so two instances racing on the same subject
 * cannot both read the same count.
 */
export async function consume(
  subjectId: string,
  bucket: Bucket,
  now: Date = new Date(),
): Promise<RateLimited | null> {
  try {
    const [row] = await db
      .insert(rateLimits)
      .values({ subjectId, bucket, windowStart: windowStartFor(bucket, now), count: 1 })
      .onConflictDoUpdate({
        target: [rateLimits.subjectId, rateLimits.bucket, rateLimits.windowStart],
        set: { count: sql`${rateLimits.count} + 1` },
      })
      .returning({ count: rateLimits.count });

    return decide(bucket, row.count, now);
  } catch (err) {
    // Fails open (D64). This sits in the request path of every mutation a member makes; a
    // guard against a nuisance must not be able to become the outage. Sentry picks this up
    // through the server-action instrumentation wired in phase 6.
    console.error('[limits] rate-limit counter unavailable, allowing the request', err);
    return null;
  }
}

/**
 * Drop counters for windows that have closed. Called from the daily `reconcile` job beside
 * `pruneJobRuns` — housekeeping, not a requirement: the ceiling is members × buckets × windows
 * per day, which for this group is small enough to ignore if a prune is ever missed.
 */
export async function pruneRateLimits(olderThanMs = 60 * 60 * 1_000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const deleted = await db
    .delete(rateLimits)
    .where(lt(rateLimits.windowStart, cutoff))
    .returning({ bucket: rateLimits.bucket });
  return deleted.length;
}
```

- [ ] **Step 7: Run the test and confirm it passes**

Run: `npx vitest run src/server/limits/__tests__/consume.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 8: Format, typecheck, commit**

```bash
npm run format
npm run typecheck
git add src/db/schema src/test/db.ts src/server/limits drizzle
git commit -m "feat(limits): add the rate_limits counter, consumed in one statement"
```

---

## Task 3: Prune the counters from the daily job — [CLOUD]

**Files:**

- Modify: `src/app/api/cron/reconcile/route.ts`
- Test: `src/server/limits/__tests__/consume.test.ts` (**DB**, extend)

**Interfaces:**

- Consumes: `pruneRateLimits` from Task 2.
- Produces: nothing new. This task only wires an existing function into an existing route.

- [ ] **Step 1: Write the failing test**

Append to `src/server/limits/__tests__/consume.test.ts` — and add `pruneRateLimits` to the import
from `@/server/limits/consume`:

```ts
describe('pruneRateLimits', () => {
  it('deletes closed windows and leaves the current one alone', async () => {
    const old = new Date(Date.now() - 3 * 60 * 60 * 1_000);
    await db
      .insert(rateLimits)
      .values({ subjectId: SUBJECT, bucket: 'COMMENT', windowStart: old, count: 4 });
    await consume(SUBJECT, 'COMMENT');

    expect(await pruneRateLimits()).toBe(1);

    const remaining = await db.select().from(rateLimits);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].windowStart.getTime()).toBeGreaterThan(old.getTime());
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/server/limits/__tests__/consume.test.ts -t pruneRateLimits`
Expected: FAIL — `pruneRateLimits is not defined` (it is not yet imported by the test file).

- [ ] **Step 3: Import it in the test and confirm the test now passes**

Change the test file's import line to:

```ts
import { consume, pruneRateLimits } from '@/server/limits/consume';
```

Run: `npx vitest run src/server/limits/__tests__/consume.test.ts`
Expected: PASS — 7 tests. `pruneRateLimits` already exists from Task 2; this step proves it behaves.

- [ ] **Step 4: Wire it into the reconcile route**

In `src/app/api/cron/reconcile/route.ts`, add the import:

```ts
import { pruneRateLimits } from '@/server/limits/consume';
```

and extend the existing prune block — keep it inside the same try/catch, which already exists for
exactly this reason:

```ts
// Retention rides this job rather than earning a schedule of its own. Its own try/catch:
// a failed prune is housekeeping and must not fail a reconciliation run.
try {
  await pruneJobRuns();
  await pruneRateLimits();
} catch (err) {
  console.error('[reconcile] pruning failed', err);
}
```

- [ ] **Step 5: Confirm the reconcile route's own tests still pass**

Run: `npx vitest run src/app src/server/ops`
Expected: PASS, no new failures.

- [ ] **Step 6: Format, typecheck, commit**

```bash
npm run format
npm run typecheck
git add src/app/api/cron/reconcile/route.ts src/server/limits
git commit -m "feat(limits): prune closed windows from the daily reconcile job"
```

---

## Task 4: Limit the feed — comments and reactions — [CLOUD]

**Files:**

- Modify: `src/app/(app)/feed/actions.ts`
- Modify: `src/app/(app)/feed/feed-list.tsx`
- Modify: `src/app/(app)/feed/[eventId]/comment-thread.tsx`
- Test: `src/app/(app)/feed/__tests__/limits.test.ts` (**DB**, new)

**Interfaces:**

- Consumes: `consume` from Task 2.
- Produces: the call shape every later wiring task repeats —
  `const limited = await consume(member.userId, '<BUCKET>'); if (limited) return …`.

- [ ] **Step 1: Write the failing test**

Create `src/app/(app)/feed/__tests__/limits.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUCKETS } from '@/server/limits/policy';
import { resetDb } from '@/test/db';

const member = {
  ok: true as const,
  userId: '00000000-0000-4000-8000-000000000001',
  membershipId: '00000000-0000-4000-8000-0000000000a1',
  seasonId: '00000000-0000-4000-8000-0000000000b1',
  role: 'MEMBER' as const,
  balanceCents: 0n,
};

vi.mock('@/server/auth/session', () => ({
  requireApprovedMemberOrThrow: vi.fn(async () => member),
}));

vi.mock('@/server/feed/social', async () => {
  const actual =
    await vi.importActual<typeof import('@/server/feed/social')>('@/server/feed/social');
  return { ...actual, addComment: vi.fn(async () => ({ commentId: 'c1' })) };
});

import { addComment } from '@/server/feed/social';
import { addCommentAction } from '@/app/(app)/feed/actions';

beforeEach(async () => {
  await resetDb();
  vi.mocked(addComment).mockClear();
});

describe('addCommentAction', () => {
  it('refuses past the COMMENT limit without calling the service', async () => {
    for (let i = 0; i < BUCKETS.COMMENT.limit; i++) {
      await addCommentAction('e1', 'hello');
    }
    const callsBefore = vi.mocked(addComment).mock.calls.length;

    const result = await addCommentAction('e1', 'hello');

    expect(result).toMatchObject({ error: 'RATE_LIMITED' });
    expect(vi.mocked(addComment).mock.calls.length).toBe(callsBefore);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run "src/app/(app)/feed/__tests__/limits.test.ts"`
Expected: FAIL — the eleventh call still reaches `addComment`, so the assertion on `result` fails.

- [ ] **Step 3: Limit the three mutating feed actions**

In `src/app/(app)/feed/actions.ts`, add the import and one shared error type:

```ts
import { consume } from '@/server/limits/consume';

/**
 * The feed actions have always returned a bare error *code* rather than a typed union. Keeping
 * `retryAfterSeconds` optional on one shared shape is what lets every existing
 * `return { error: err.code }` path stay exactly as it is while a caller can still read the
 * countdown — a second, separate `{ error; retryAfterSeconds }` union member would not narrow
 * under `'error' in result`, and `feed-list.tsx` needs it to.
 */
export type FeedActionError = { error: string; retryAfterSeconds?: number };
```

Then in `toggleReactionAction`, immediately after the `requireApprovedMemberOrThrow()` line:

```ts
const limited = await consume(member.userId, 'REACTION');
if (limited) return { error: limited.code, retryAfterSeconds: limited.retryAfterSeconds };
```

In `addCommentAction` and `deleteCommentAction`, the same two lines with `'COMMENT'`. In
`saveFeedPreferencesAction`, the same with `'DEFAULT'`.

Then replace the error half of all four declared return types with `FeedActionError`, editing the
existing `Promise<…>` annotations in place:

```ts
// toggleReactionAction
): Promise<{ active: boolean } | FeedActionError> {
// addCommentAction
): Promise<{ commentId: string } | FeedActionError> {
// deleteCommentAction
): Promise<{ deleted: boolean } | FeedActionError> {
// saveFeedPreferencesAction
): Promise<{ saved: true } | FeedActionError> {
```

`loadMoreFeedAction` gets **no** limit: it paginates and writes nothing, and Task 7 records it as
the documented exemption.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run "src/app/(app)/feed/__tests__/limits.test.ts"`
Expected: PASS.

- [ ] **Step 5: Roll the optimistic reaction back when the action refuses**

`src/app/(app)/feed/feed-list.tsx` applies an optimistic update and then discards the action's
result entirely, so a refused reaction would leave the card showing something that was never
written. Replace the `startTransition` block in `toggle`:

```tsx
startTransition(async () => {
  const result = await toggleReactionAction(eventId, emoji);
  // The handler previously discarded this result, which meant any refusal — a rate limit,
  // a wrong season, a deleted event — left the optimistic update standing as a lie until
  // something else refreshed the feed. Rate limiting is the first of those that happens in
  // normal use, so the rollback lands with it.
  if (result && 'error' in result) {
    setCards(previous);
    setError(
      result.error === 'RATE_LIMITED'
        ? `You're reacting too quickly. Try again in ${result.retryAfterSeconds} seconds.`
        : 'That reaction did not stick.',
    );
  }
});
```

Capture `previous` at the top of `toggle`, before the optimistic `setCards`, and add the
`error` state plus a `Callout` that renders it above the list:

```tsx
const [error, setError] = useState<string | null>(null);
```

```tsx
{
  error ? (
    <Callout tone="caution" className="mx-4">
      {error}
    </Callout>
  ) : null;
}
```

Import `Callout` from `@/components/ui/callout`.

- [ ] **Step 6: Render the refusal in the comment thread**

In `src/app/(app)/feed/[eventId]/comment-thread.tsx`, the `ERRORS` lookup takes a new entry, and
the two call sites already fall back through `??`. Add to `ERRORS`:

```ts
  RATE_LIMITED: 'You are commenting too quickly. Give it a few seconds.',
```

- [ ] **Step 7: Run the feed tests and the convention tests**

Run: `npx vitest run src/app src/server/feed`
Expected: PASS. `route-conventions.test.ts`'s pending-state assertion covers `feed-list.tsx`, so a
missing `disabled={pending}` would fail here.

- [ ] **Step 8: Format, typecheck, build, commit**

```bash
npm run format
npm run typecheck
npm run lint
git add "src/app/(app)/feed"
git commit -m "feat(limits): limit comments and reactions, and stop swallowing reaction errors"
```

---

## Task 5: Limit bet placement and wagers — [CLOUD]

**Files:**

- Modify: `src/app/(app)/bets/actions.ts`
- Modify: `src/app/(app)/wagers/actions.ts`
- Modify: `src/components/bet-slip/bet-slip.tsx`
- Modify: `src/app/(app)/wagers/new/wager-form.tsx`
- Test: `src/app/(app)/bets/__tests__/limits.test.ts` (**DB**, new)

**Interfaces:**

- Consumes: `consume` from Task 2, `RateLimited` from Task 1.
- Produces: `placeBetAction` returning `PlaceBetResult | { ok: false; error: RateLimited }`, and the
  six wager actions each returning their existing shape widened the same way.

**`src/server/bets/types.ts` and `src/server/p2p/` are not edited in this task.** Widening happens
on the action's return type only. If you find yourself opening a file under `src/server/bets` or
`src/server/p2p`, stop — you have misread the task.

- [ ] **Step 1: Write the failing test**

Create `src/app/(app)/bets/__tests__/limits.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUCKETS } from '@/server/limits/policy';
import { resetDb } from '@/test/db';

const member = {
  ok: true as const,
  userId: '00000000-0000-4000-8000-000000000001',
  membershipId: '00000000-0000-4000-8000-0000000000a1',
  seasonId: '00000000-0000-4000-8000-0000000000b1',
  role: 'MEMBER' as const,
  balanceCents: 0n,
};

vi.mock('@/server/auth/session', () => ({
  requireApprovedMemberOrThrow: vi.fn(async () => member),
}));

vi.mock('@/server/bets/place', () => ({
  placeBet: vi.fn(async () => ({ ok: false, error: { code: 'NOT_A_MEMBER' } })),
}));

import { placeBet } from '@/server/bets/place';
import { placeBetAction } from '@/app/(app)/bets/actions';

const slip = {
  type: 'SINGLE' as const,
  stakeCents: '500',
  legs: [{ selectionId: 's1', line: null, priceAmerican: -110 }],
  clientRequestId: 'r1',
};

beforeEach(async () => {
  await resetDb();
  vi.mocked(placeBet).mockClear();
});

describe('placeBetAction', () => {
  it('refuses past the BET_PLACE limit without touching placeBet', async () => {
    for (let i = 0; i < BUCKETS.BET_PLACE.limit; i++) {
      await placeBetAction({ ...slip, clientRequestId: `r${i}` });
    }
    const callsBefore = vi.mocked(placeBet).mock.calls.length;

    const result = await placeBetAction({ ...slip, clientRequestId: 'last' });

    expect(result).toEqual({ ok: false, error: { code: 'RATE_LIMITED', retryAfterSeconds: 60 } });
    expect(vi.mocked(placeBet).mock.calls.length).toBe(callsBefore);
  });

  it('counts a rejected placement against the limit', async () => {
    // The service is mocked to reject every call, so this proves the counter is spent on the
    // attempt rather than on the outcome (D64).
    for (let i = 0; i <= BUCKETS.BET_PLACE.limit; i++) {
      await placeBetAction({ ...slip, clientRequestId: `x${i}` });
    }
    const result = await placeBetAction({ ...slip, clientRequestId: 'after' });
    expect(result).toMatchObject({ error: { code: 'RATE_LIMITED' } });
  });
});
```

Note the `retryAfterSeconds: 60` assertion holds because every call in one test lands inside one
minute window; if a run straddles a boundary the second test still passes and the first may not.
That is acceptable for a suite that runs in 80 seconds — if it ever flakes, pass an explicit `now`
through the action the way `consume` already allows.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run "src/app/(app)/bets/__tests__/limits.test.ts"`
Expected: FAIL — every call reaches `placeBet`.

- [ ] **Step 3: Limit `placeBetAction`**

In `src/app/(app)/bets/actions.ts`, add the imports and the guard:

```ts
import { consume } from '@/server/limits/consume';
import type { RateLimited } from '@/server/limits/types';
```

```ts
export async function placeBetAction(
  input: PlaceBetActionInput,
): Promise<(PlaceBetResult & { stakeCents?: string }) | { ok: false; error: RateLimited }> {
  const member = await requireApprovedMemberOrThrow();

  // Before the service, in its own transaction, never inside placeBet's (money invariant 3).
  const limited = await consume(member.userId, 'BET_PLACE');
  if (limited) return { ok: false, error: limited };
```

The rest of the function is unchanged.

- [ ] **Step 4: Limit the six wager actions**

In `src/app/(app)/wagers/actions.ts`, add the same two imports. `offerWagerAction` takes
`'P2P_OFFER'`; `acceptWagerAction`, `declineWagerAction`, `cancelOfferAction`, `claimWinnerAction`
and `proposeCancelAction` take `'P2P_RESPOND'`. Each gets, immediately after its
`requireApprovedMemberOrThrow()` line:

```ts
const limited = await consume(member.userId, 'P2P_OFFER');
if (limited) return { ok: false as const, error: limited };
```

(substituting `'P2P_RESPOND'` in the five responders), and each return type widens to include
`{ ok: false; error: RateLimited }`. `offerWagerAction` consumes **before** `offerWager`, which
escrows the offerer's stake at offer time
([D46](../decisions.md#d46--the-offerers-stake-escrows-at-offer-not-at-acceptance)) — so a spent
token with no escrow is possible and an escrow with no token is not, which is the safe direction
(money invariant 4).

- [ ] **Step 5: Render the refusal in both forms**

In `src/components/bet-slip/bet-slip.tsx`, widen `message`'s parameter and add the case:

```ts
function message(error: PlaceBetError | RateLimited, currency: Currency): string {
  switch (error.code) {
    case 'RATE_LIMITED':
      return `You're placing bets too quickly. Try again in ${error.retryAfterSeconds} seconds.`;
```

Import `RateLimited` from `@/server/limits/types`. Add the same first case to `describe` in
`src/app/(app)/wagers/new/wager-form.tsx`:

```ts
    case 'RATE_LIMITED':
      return `You're posting offers too quickly. Try again in ${error.retryAfterSeconds} seconds.`;
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npx vitest run "src/app/(app)/bets" src/app src/server/bets src/server/p2p`
Expected: PASS, with no change in the bets or p2p service test counts.

- [ ] **Step 7: Confirm the money directories are untouched**

```bash
git diff --stat -- src/server/money src/server/bets src/server/p2p src/db/schema/money.ts
```

Expected: empty output. If it is not empty, revert those files — the wiring belongs in
`src/app/`.

- [ ] **Step 8: Format, typecheck, commit**

```bash
npm run format
npm run typecheck
npm run lint
git add "src/app/(app)/bets" "src/app/(app)/wagers" src/components/bet-slip/bet-slip.tsx
git commit -m "feat(limits): limit bet placement and peer-to-peer wagers"
```

---

## Task 6: Limit custom events and the admin surface — [CLOUD]

**Files:**

- Modify: `src/app/(app)/events/actions.ts`
- Modify: `src/app/admin/events/actions.ts`
- Modify: `src/app/admin/wagers/actions.ts`
- Modify: `src/app/admin/page.tsx`
- Modify: `src/app/(app)/events/new/event-form.tsx`
- Modify: `src/app/(app)/events/[eventId]/dispute-form.tsx`
- Modify: `src/app/(app)/events/[eventId]/resolve/resolve-form.tsx`
- Modify: `src/app/(app)/events/[eventId]/market-card.tsx`
- Modify: `src/app/admin/events/void-form.tsx`
- Modify: `src/app/admin/wagers/arbitration-form.tsx`

**Interfaces:**

- Consumes: `consume` from Task 2, `RateLimited` from Task 1.
- Produces: nothing new — this is the last of the wiring, and Task 7 tests the whole of it.

- [ ] **Step 1: Limit the five event actions**

In `src/app/(app)/events/actions.ts`, add:

```ts
import { consume } from '@/server/limits/consume';
import type { RateLimited } from '@/server/limits/types';
```

`createEventAction`, `suspendMarketAction`, `editEventAction`, `resolveEventAction` and
`disputeEventAction` each get, after `requireApprovedMemberOrThrow()`:

```ts
const limited = await consume(member.userId, 'EVENT_WRITE');
if (limited) return { ok: false, error: limited };
```

and each return type gains `| { ok: false; error: RateLimited }`. `createEventAction` and
`resolveEventAction` are declared `… | never` because they redirect on success; the widening goes
on the non-`never` half.

- [ ] **Step 2: Limit the two admin action files**

In `src/app/admin/events/actions.ts` and `src/app/admin/wagers/actions.ts`, the same imports, and
after each action's authorization call:

```ts
const limited = await consume(member.userId, 'ADMIN_ACTION');
if (limited) return { ok: false, error: limited };
```

Admins are limited, not exempt (D63): the failure this guards against — a component re-rendering in
a loop and firing its action each time — does not care what role the session holds.

If `requireAdmin()` is called without binding its result in these files, bind it:
`const member = await requireAdmin();`.

- [ ] **Step 3: Limit `/admin`'s inline `setStatus`**

`src/app/admin/page.tsx` holds an inline `'use server'` action that approves and disables members —
the app's most consequential mutation, and one no `*Action` name search would find. Change the page
signature to accept search params and the action to redirect on refusal:

```tsx
import { redirect } from 'next/navigation';
import { Callout } from '@/components/ui/callout';
import { consume } from '@/server/limits/consume';

export default async function AdminPage({ searchParams }: PageProps<'/admin'>) {
  await requireAdmin();
  const params = await searchParams;
  const limitedFor = typeof params.limited === 'string' ? params.limited : null;

  async function setStatus(formData: FormData) {
    'use server';
    const actor = await requireAdmin();

    const limited = await consume(actor.userId, 'ADMIN_ACTION');
    // A FormData action has no return channel to the form, so the refusal travels as a query
    // parameter and the page renders it. Silently doing nothing would be the worse failure.
    if (limited) redirect(`/admin?limited=${limited.retryAfterSeconds}`);

    const userId = String(formData.get('userId'));
    const status = String(formData.get('status'));
    if (status !== 'APPROVED' && status !== 'DISABLED') return;

    await db.update(users).set({ status }).where(eq(users.id, userId));
    revalidatePath('/admin');
  }
```

and render it above the "Waiting for approval" section:

```tsx
{
  limitedFor ? (
    <Callout tone="caution">
      That went through too quickly and was not applied. Try again in {limitedFor} seconds.
    </Callout>
  ) : null;
}
```

The page's own `requireAdmin()` stays unbound, exactly as it is today. Only the call inside
`setStatus` binds a result, because only that one needs a user id to key the counter on.

- [ ] **Step 4: Render the refusal in the five remaining message maps**

Add a `RATE_LIMITED` case to each of these `switch` statements, widening the parameter type with
`| RateLimited` and importing it from `@/server/limits/types`:

`src/app/(app)/events/new/event-form.tsx`:

```ts
    case 'RATE_LIMITED':
      return `You're creating events too quickly. Try again in ${error.retryAfterSeconds} seconds.`;
```

`src/app/(app)/events/[eventId]/dispute-form.tsx`:

```ts
    case 'RATE_LIMITED':
      return `You're doing that too quickly. Try again in ${error.retryAfterSeconds} seconds.`;
```

`src/app/(app)/events/[eventId]/resolve/resolve-form.tsx`, `src/app/admin/events/void-form.tsx` and
`src/app/admin/wagers/arbitration-form.tsx`: the same case as `dispute-form.tsx`.

`src/app/(app)/events/[eventId]/market-card.tsx` takes a bare `code: string` in `manageMessage`, so
it needs no type widening — only the case, before the `default`:

```ts
    case 'RATE_LIMITED':
      return 'You are doing that too quickly. Give it a few seconds.';
```

The two call sites at lines 115 and 139 pass `result.error.code`, which now includes the new code.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, with the same file count plus the two limit test files added in Tasks 4 and 5.

- [ ] **Step 6: Format, typecheck, lint, build, commit**

```bash
npm run format
npm run typecheck
npm run lint
npm run build
git add "src/app/(app)/events" src/app/admin
git commit -m "feat(limits): limit custom events and every admin mutation"
```

---

## Task 7: The guard test that keeps this true — [CLOUD]

**Files:**

- Create: `src/app/__tests__/mutation-limits.test.ts`

**Interfaces:**

- Consumes: nothing at runtime — it reads source text, like `route-conventions.test.ts`,
  `token-lint.test.ts` and `ledger-funnel.test.ts`.
- Produces: nothing importable.

**Why this comes last rather than first.** Written before Tasks 4 through 6, it would fail with
eighteen identical messages that say nothing about which wiring is wrong. It is a ratchet over
finished work — its job is to fail on the _nineteenth_ action, the one somebody adds next year.

- [ ] **Step 1: Write the test**

Create `src/app/__tests__/mutation-limits.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every mutation carries a rate limit (D63). That could have been a code-review habit, so it is
 * a test instead — repo-health 3.2's layering rule, applied without being asked.
 *
 * Two populations, because one alone is a trap. Searching only for exported `*Action` functions
 * would have missed every inline `'use server'` block in a page file — including `/admin`'s
 * `setStatus`, which approves and disables members. A green test that leaves the app's most
 * consequential mutation unlimited is worse than a red one.
 *
 * Known coarseness: the inline half exempts by FILE, not by action. A page listed in UNLIMITED
 * for its sign-out form would also carry a new mutating inline action past this check. That is
 * the price of matching source text rather than parsing it, and the reason to put new mutations
 * in an actions.ts file where the first assertion sees them.
 */

const APP = join(process.cwd(), 'src', 'app');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/**
 * Deliberately not limited. Each entry names why — an addition here is a decision, and the
 * length assertion below makes it a visible one.
 */
const UNLIMITED = [
  // Paginates the feed. Writes nothing.
  'loadMoreFeedAction',
  // Ends a session. Touches neither the ledger nor the feed.
  'signOut@me',
  'signOut@pending',
  // Runs before there is a session, so there is no subject to key on. Google and NextAuth own
  // the rate of sign-in attempts (spec §2.4).
  'signIn@sign-in',
];

describe('every mutating server action consumes a rate-limit bucket', () => {
  const files = walk(APP)
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .filter((f) => !f.includes('__tests__'))
    .map((f) => ({ path: f, source: readFileSync(f, 'utf8') }))
    .filter((f) => f.source.includes("'use server'"));

  it('finds the action surface it is supposed to be checking', () => {
    // Guards against the whole suite passing because the walk stopped finding files.
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it('limits every exported *Action function', () => {
    const offenders: string[] = [];

    for (const { path, source } of files) {
      const names = [...source.matchAll(/export async function (\w*Action)\b/g)].map((m) => m[1]);
      for (const name of names) {
        if (UNLIMITED.includes(name)) continue;
        const body = source.slice(source.indexOf(`export async function ${name}`));
        const end = body.indexOf('\nexport ', 1);
        const scoped = end === -1 ? body : body.slice(0, end);
        if (!scoped.includes('consume(')) {
          offenders.push(`${path.replace(process.cwd(), '')} → ${name}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('limits every inline use-server block in a page file', () => {
    const offenders: string[] = [];

    for (const { path, source } of files) {
      if (!path.endsWith('page.tsx')) continue;
      const inlineBlocks = source.split("'use server'").length - 1;
      if (inlineBlocks === 0) continue;

      const exempt = UNLIMITED.filter((e) => e.includes('@')).some((e) =>
        path.includes(`/${e.split('@')[1]}/`),
      );
      if (exempt) continue;

      if (!source.includes('consume(')) {
        offenders.push(path.replace(process.cwd(), ''));
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keeps the exemption list a deliberate edit', () => {
    expect(UNLIMITED).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run the test and confirm it passes**

Run: `npx vitest run src/app/__tests__/mutation-limits.test.ts`
Expected: PASS — 4 tests. If any offender is listed, Task 4, 5 or 6 missed an action; fix the action,
not the test.

- [ ] **Step 3: Prove the test can fail**

Temporarily delete the `consume` guard from `deleteCommentAction` in
`src/app/(app)/feed/actions.ts` and re-run.
Expected: FAIL, naming `feed/actions.ts → deleteCommentAction`. **Restore the guard** and confirm the
test passes again. A guard test nobody has watched fail is a guard test nobody knows works — this is
the same step the ledger-funnel guard went through
([repo-health Done 9](../repo-health.md#done)).

- [ ] **Step 4: Format, commit**

```bash
npm run format
git add src/app/__tests__/mutation-limits.test.ts
git commit -m "test(limits): fail the build when a mutation forgets its rate limit"
```

---

## Task 8: `GateScreen` and the four pre-app screens — [CLOUD]

**Files:**

- Create: `src/components/ui/gate-screen.tsx`
- Create: `src/app/join/actions.ts`
- Create: `src/app/join/join-form.tsx`
- Modify: `src/app/pending/page.tsx`
- Modify: `src/app/join/page.tsx`
- Modify: `src/app/no-season/page.tsx`
- Modify: `src/app/disabled/page.tsx`
- Create: `src/app/__tests__/gate-screens.test.ts`

**Interfaces:**

- Consumes: `consume` from Task 2, `Button` from `@/components/ui/button`, `joinSeason` from
  `@/server/seasons/service`.
- Produces: `GateScreen` (props below) and `joinSeasonAction(seasonId: string)` returning
  `{ ok: true } | { ok: false; error: 'NO_SEASON' | 'FAILED' | 'RATE_LIMITED'; retryAfterSeconds?: number }`.

- [ ] **Step 1: Write the failing test**

Create `src/app/__tests__/gate-screens.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The four screens a member meets before the app does (D65). They are a sequence, not three
 * unrelated holding pages — and there are four of them, not the three the roadmap named:
 * `/disabled` is reached by the same `requireApprovedMember` switch as the other three.
 */

const APP = join(process.cwd(), 'src', 'app');
const GATES = ['pending', 'join', 'no-season', 'disabled'];

const sourceFor = (gate: string) => readFileSync(join(APP, gate, 'page.tsx'), 'utf8');

describe('gate screens', () => {
  it.each(GATES)('/%s renders the shared GateScreen', (gate) => {
    expect(sourceFor(gate)).toContain('@/components/ui/gate-screen');
  });

  it.each(GATES)('/%s exports its own title', (gate) => {
    expect(sourceFor(gate)).toMatch(/export const metadata: Metadata = \{\s*title:/);
  });

  it.each(GATES)('/%s links to the house rules', (gate) => {
    expect(sourceFor(gate)).toContain('/rules');
  });

  it('gives the two-step sequence its step numbers', () => {
    expect(sourceFor('pending')).toContain('current: 1');
    expect(sourceFor('join')).toContain('current: 2');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/app/__tests__/gate-screens.test.ts`
Expected: FAIL — all four routes fail the first assertion.

- [ ] **Step 3: Write `GateScreen`**

Create `src/components/ui/gate-screen.tsx`:

```tsx
import type { ReactNode } from 'react';

/**
 * The shared layout for the four screens a member meets before the app: `/pending`, `/join`,
 * `/no-season` and `/disabled` (D65).
 *
 * Not `StatusScreen`, which is sized to render *inside* the app shell where a header and a tab
 * bar are already taking space. These have no shell, fill the viewport, and need a footer —
 * one component answering to both contracts would falsify StatusScreen's own comment.
 *
 * `step` is the thing that makes these a sequence rather than four dead ends. `/no-season` and
 * `/disabled` pass none, because neither is a stage anyone progresses through.
 */
export function GateScreen({
  title,
  body,
  step,
  children,
  footer,
}: {
  title: string;
  body: ReactNode;
  step?: { current: number; total: number };
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6 text-center">
      <div>
        {step ? (
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-subtle">
            Step {step.current} of {step.total}
          </p>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <div className="mt-3 max-w-sm text-balance text-sm text-ink-muted">{body}</div>
      </div>

      {children ? <div className="flex flex-col items-center gap-3">{children}</div> : null}

      {footer ? (
        <div className="flex items-center gap-4 text-xs text-ink-muted">{footer}</div>
      ) : null}
    </main>
  );
}
```

- [ ] **Step 4: Write `joinSeasonAction` and the join control**

Create `src/app/join/actions.ts`:

```ts
'use server';

import { requireApprovedMemberOrThrow } from '@/server/auth/session';
import { getSessionUser } from '@/server/auth/session';
import { consume } from '@/server/limits/consume';
import { joinSeason } from '@/server/seasons/service';

export type JoinActionResult =
  | { ok: true }
  | { ok: false; error: 'NO_SEASON' | 'FAILED' | 'RATE_LIMITED'; retryAfterSeconds?: number };

/**
 * `/join`'s submit was an inline server action with no try/catch and no pending state. The
 * money side was never at risk — `joinSeason` is idempotent, reusing an existing membership and
 * posting on the deterministic key `grant:<membershipId>` — but a season that ended between
 * render and submit threw into `app/error.tsx` with no way back. This is that path, typed.
 *
 * `requireApprovedMemberOrThrow` is deliberately NOT used: the whole point of this screen is a
 * member who is approved but has not joined, which that helper rejects.
 */
export async function joinSeasonAction(seasonId: string): Promise<JoinActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'FAILED' };

  const limited = await consume(user.id, 'DEFAULT');
  if (limited) {
    return { ok: false, error: 'RATE_LIMITED', retryAfterSeconds: limited.retryAfterSeconds };
  }

  try {
    await joinSeason(user.id, seasonId);
    return { ok: true };
  } catch {
    // joinSeason throws only when the season has gone — which is exactly the race this exists
    // to catch, and reads to the member as "that season is no longer running".
    return { ok: false, error: 'NO_SEASON' };
  }
}
```

Remove the unused `requireApprovedMemberOrThrow` import before committing — it is listed above only
so the reason it is _not_ used is on the record.

Create `src/app/join/join-form.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { joinSeasonAction } from './actions';

function message(error: string, retryAfterSeconds?: number): string {
  if (error === 'RATE_LIMITED') {
    return `That went through too quickly. Try again in ${retryAfterSeconds} seconds.`;
  }
  if (error === 'NO_SEASON') return 'That season is no longer running. Refresh and try again.';
  return 'Could not join the season. Try again.';
}

export function JoinForm({ seasonId }: { seasonId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await joinSeasonAction(seasonId);
      if (result.ok) router.push('/');
      else setError(message(result.error, result.retryAfterSeconds));
    });
  }

  return (
    <>
      <Button type="button" onClick={submit} disabled={pending}>
        {pending ? 'Joining…' : 'Join season'}
      </Button>
      {error ? <Callout tone="caution">{error}</Callout> : null}
    </>
  );
}
```

`disabled={pending}` is required, not stylistic: `route-conventions.test.ts` fails the build on a
`useTransition` form without it.

- [ ] **Step 5: Rebuild the four screens**

`src/app/pending/page.tsx` — keep every redirect exactly as it is, replace only the markup:

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { GateScreen } from '@/components/ui/gate-screen';
import { signOut } from '@/server/auth/config';
import { currentMember, getSessionUser } from '@/server/auth/session';

export const metadata: Metadata = { title: 'Waiting for approval' };

export default async function PendingPage() {
  const user = await getSessionUser();
  if (!user) redirect('/sign-in');

  const member = await currentMember();
  if (!member || member.ok || member.reason !== 'PENDING') redirect('/');

  return (
    <GateScreen
      title="Waiting for approval"
      step={{ current: 1, total: 2 }}
      body={
        <>
          You&rsquo;re signed in as {user.email}. An admin needs to approve your account before you
          can place bets. Nothing else is needed from you.
        </>
      }
      footer={
        <>
          <Link href="/rules" className="underline">
            House rules
          </Link>
          <form
            action={async () => {
              'use server';
              await signOut({ redirectTo: '/sign-in' });
            }}
          >
            <button type="submit" className="underline">
              Sign out
            </button>
          </form>
        </>
      }
    >
      {/* Approval happens elsewhere and this screen has no way to learn about it. The redirect
          at the top of this file does all the work — the control just re-runs it. */}
      <form
        action={async () => {
          'use server';
          redirect('/pending');
        }}
      >
        <Button type="submit" variant="secondary" size="sm">
          Check again
        </Button>
      </form>
    </GateScreen>
  );
}
```

`src/app/join/page.tsx` — same redirects, `JoinForm` instead of the inline action:

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { GateScreen } from '@/components/ui/gate-screen';
import { db } from '@/db/client';
import { seasons } from '@/db/schema';
import { formatAmount } from '@/domain/money';
import { currentMember, getSessionUser } from '@/server/auth/session';
import { JoinForm } from './join-form';

export const metadata: Metadata = { title: 'Join the season' };

export default async function JoinPage() {
  const user = await getSessionUser();
  if (!user) redirect('/sign-in');

  const member = await currentMember();
  if (member?.ok) redirect('/');
  if (member && !member.ok && member.reason === 'PENDING') redirect('/pending');

  const [season] = await db.select().from(seasons).where(eq(seasons.status, 'ACTIVE'));
  if (!season) redirect('/no-season');

  return (
    <GateScreen
      title={season.name}
      step={{ current: 2, total: 2 }}
      body={
        <>
          Join and start with {formatAmount(season.startingBankrollCents)} plus{' '}
          {formatAmount(season.startingCreditsCents, 'CREDITS')}, topped up by{' '}
          {formatAmount(season.weeklyAllowanceCents)} and{' '}
          {formatAmount(season.weeklyCreditAllowanceCents, 'CREDITS')} every week. None of it is
          real money.
        </>
      }
      footer={
        <Link href="/rules" className="underline">
          How this works
        </Link>
      }
    >
      <JoinForm seasonId={season.id} />
    </GateScreen>
  );
}
```

`src/app/no-season/page.tsx`:

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { GateScreen } from '@/components/ui/gate-screen';
import { signOut } from '@/server/auth/config';
import { currentMember } from '@/server/auth/session';

export const metadata: Metadata = { title: 'No season running' };

export default async function NoSeasonPage() {
  // Self-correcting: once an admin starts a season this stops being the right screen.
  const member = await currentMember();
  if (!member || member.ok || member.reason !== 'NO_ACTIVE_SEASON') redirect('/');

  return (
    <GateScreen
      title="No season running"
      body="An admin needs to start a season before there is anything to bet on. Your account is approved — nothing is wrong on your end."
      footer={
        <>
          <Link href="/rules" className="underline">
            House rules
          </Link>
          <form
            action={async () => {
              'use server';
              await signOut({ redirectTo: '/sign-in' });
            }}
          >
            <button type="submit" className="underline">
              Sign out
            </button>
          </form>
        </>
      }
    />
  );
}
```

`src/app/disabled/page.tsx`: identical shape, `title="Account disabled"`, body "This account can no
longer place bets. Talk to an admin if you think that is a mistake.", the same footer.

Both of these had **no control of any kind** before this task — a member landing there could only
close the tab. That is the one real bug in the set.

- [ ] **Step 6: Add the two `signOut` exemptions to the guard test**

`/no-season` and `/disabled` gain an inline `signOut` form in this task, so the `UNLIMITED` list in
`src/app/__tests__/mutation-limits.test.ts` gains two entries and its length assertion becomes six:

```ts
const UNLIMITED = [
  // Paginates the feed. Writes nothing.
  'loadMoreFeedAction',
  // End a session. Touch neither the ledger nor the feed.
  'signOut@me',
  'signOut@pending',
  'signOut@no-season',
  'signOut@disabled',
  // Runs before there is a session, so there is no subject to key on. Google and NextAuth own
  // the rate of sign-in attempts (spec §2.4).
  'signIn@sign-in',
];
```

```ts
it('keeps the exemption list a deliberate edit', () => {
  expect(UNLIMITED).toHaveLength(6);
});
```

`/pending`'s "check again" form needs **no** entry of its own. The inline-block assertion exempts by
_file_, not by action name, and `'signOut@pending'` already exempts `pending/page.tsx` whole — which
is the coarseness the test's own comment records.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/app`
Expected: PASS — `gate-screens.test.ts` (13 assertions), `route-conventions.test.ts`,
`mutation-limits.test.ts` and `token-lint.test.ts` all green. `/rules` does not exist yet, so the
links point at a 404 until Task 9; the tests assert the link text, not the target's existence.

- [ ] **Step 8: Format, typecheck, lint, build, commit**

```bash
npm run format
npm run typecheck
npm run lint
npm run build
git add src/components/ui/gate-screen.tsx src/app/pending src/app/join src/app/no-season src/app/disabled src/app/__tests__
git commit -m "feat(gates): make the four pre-app screens one sequence"
```

---

## Task 9: The house rules page — [CLOUD]

**Files:**

- Create: `src/app/rules/page.tsx`
- Modify: `src/app/sign-in/page.tsx`
- Modify: `src/app/(app)/me/page.tsx`

**Interfaces:**

- Consumes: `db`, `seasons`, `formatAmount`, and the `DEFAULT_*` constants from
  `@/server/seasons/defaults`.
- Produces: the `/rules` route the gate screens already link to.

- [ ] **Step 1: Write the page**

Create `src/app/rules/page.tsx`. Root level, outside `(app)`, **no session required** (D66) — a
person deciding whether to hand over a Google account reads it before signing in, and a member on
`/pending` is not inside the shell. The root layout already sets `index: false`, so readable does
not mean indexed. And because it is outside `(app)`, `route-conventions.test.ts`'s loading-boundary
assertion does not require a `loading.tsx` for it — verify that by running that test, not by
trusting this sentence.

Figures come from the active season and fall back to `defaults.ts`, so this page and `/join` cannot
quote different numbers to the same person on the same day:

```tsx
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { seasons } from '@/db/schema';
import { formatAmount } from '@/domain/money';
import {
  DEFAULT_STARTING_BANKROLL_CENTS,
  DEFAULT_STARTING_CREDITS_CENTS,
  DEFAULT_WEEKLY_ALLOWANCE_CENTS,
  DEFAULT_WEEKLY_CREDIT_ALLOWANCE_CENTS,
} from '@/server/seasons/defaults';

export const metadata: Metadata = { title: 'House rules' };

function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold tracking-tight">{heading}</h2>
      <div className="flex flex-col gap-2 text-sm text-ink-muted">{children}</div>
    </section>
  );
}

export default async function RulesPage() {
  const [season] = await db.select().from(seasons).where(eq(seasons.status, 'ACTIVE'));

  const bankroll = season?.startingBankrollCents ?? DEFAULT_STARTING_BANKROLL_CENTS;
  const weekly = season?.weeklyAllowanceCents ?? DEFAULT_WEEKLY_ALLOWANCE_CENTS;
  const credits = season?.startingCreditsCents ?? DEFAULT_STARTING_CREDITS_CENTS;
  const weeklyCredits = season?.weeklyCreditAllowanceCents ?? DEFAULT_WEEKLY_CREDIT_ALLOWANCE_CENTS;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">House rules</h1>
        <p className="mt-2 text-sm text-ink-muted">
          How this works, in plain language. Nothing here involves real money.
        </p>
      </div>

      <Section heading="This is not real money">
        <p>
          Every balance in this app is simulated. You cannot deposit, you cannot withdraw, and there
          is no way to turn anything here into cash. That is not a missing feature — it is the
          category the project deliberately stays out of.
        </p>
      </Section>

      <Section heading="Two currencies">
        <p>
          <strong>Cash</strong> is what you bet on real games. You start a season with{' '}
          {formatAmount(bankroll)} and receive {formatAmount(weekly)} more every week.
        </p>
        <p>
          <strong>Credits</strong> are for member-made events and wagers between members. You start
          with {formatAmount(credits, 'CREDITS')} and receive{' '}
          {formatAmount(weeklyCredits, 'CREDITS')} a week.
        </p>
        <p>
          The two never mix. No bet, wager or transfer converts one into the other in either
          direction, and a parlay cannot combine a game leg with a member-made one.
        </p>
      </Section>

      <Section heading="The weekly allowance">
        <p>
          The allowance lands once a week, automatically, for everyone in the season. It is not a
          reward and it is not affected by how you are doing — a member who is up and a member who
          is broke get the same amount on the same day.
        </p>
      </Section>

      <Section heading="Betting">
        <p>
          Lines come from real sportsbooks. When you place a bet the price is frozen at that moment,
          so a line that moves afterward cannot change what you were paid or what you owe. If the
          line moves while your slip is open, the slip tells you and asks again.
        </p>
        <p>
          Singles and parlays only. Finished games settle themselves — you do not need to claim a
          win, and a push returns the stake.
        </p>
      </Section>

      <Section heading="Member-made events">
        <p>
          Anyone can post an event with their own outcomes and prices. Whoever created it resolves
          it when it is decided, and everyone who bet it is paid from that resolution.
        </p>
        <p>
          If you think a resolution is wrong, you can dispute it. A dispute goes to an admin, who
          re-resolves the event — the correction is a new set of entries, not an edit of the old
          ones.
        </p>
      </Section>

      <Section heading="Wagers between members">
        <p>
          A wager is two stakes into a pot: yours and your opponent&rsquo;s, each named up front.
          Your stake is held the moment you make the offer, not when it is accepted, so you cannot
          promise the same credits to two people.
        </p>
        <p>Both sides agree on who won and it settles. If you disagree, an admin rules on it.</p>
      </Section>

      <Section heading="Who arbitrates, and how">
        <p>
          Admins do. They rule on disputed events and on wagers where the two sides disagree, and
          their ruling is what settles the money.
        </p>
        <p>
          Voiding a wager — returning both stakes and calling it off — is a verdict an admin can
          reach through arbitration. It is not a button they hold standing over every wager, and it
          cannot be used to undo something an admin simply dislikes.
        </p>
      </Section>

      <Section heading="If a number looks wrong">
        <p>
          Every balance is the sum of an append-only history of entries, checked against that
          history once a day. Nothing is ever edited after the fact — a correction is a new entry
          that reverses the old one, so the record of what happened stays intact.
        </p>
        <p>Tell an admin. The history makes it possible to say exactly what happened and when.</p>
      </Section>

      <Link href="/" className="text-sm text-ink-muted underline">
        Back to the app
      </Link>
    </main>
  );
}
```

- [ ] **Step 2: Link it from `/sign-in`**

In `src/app/sign-in/page.tsx`, add below the Google button's form:

```tsx
<Link href="/rules" className="text-xs text-ink-muted underline">
  What is this? House rules
</Link>
```

Import `Link` from `next/link`.

- [ ] **Step 3: Link it from `/me`**

In `src/app/(app)/me/page.tsx`, add above the existing sign-out form:

```tsx
<Link href="/rules" className="text-sm font-medium text-ink-muted underline">
  House rules
</Link>
```

Import `Link` from `next/link` if it is not already imported.

- [ ] **Step 4: Run the route-convention tests**

Run: `npx vitest run src/app`
Expected: PASS. In particular `route-conventions.test.ts`'s "covers every page in the app"
assertion must still equal the single-entry list it asserts today — `/rules` is outside `(app)`, so
it is filtered out. **If that test fails, do not edit the test**: it means the page landed in the
wrong place.

- [ ] **Step 5: Build and check the page renders**

Run: `npm run build`
Expected: a clean build listing `/rules` as a route.

- [ ] **Step 6: Format, typecheck, lint, commit**

```bash
npm run format
npm run typecheck
npm run lint
git add src/app/rules src/app/sign-in/page.tsx "src/app/(app)/me/page.tsx"
git commit -m "feat(rules): add the house rules page, readable before sign-in"
```

---

## Task 10: The smoke checklist and the documentation rows — [CLOUD]

**Files:**

- Create: `docs/smoke-checklist.md`
- Modify: `docs/README.md`
- Modify: `docs/roadmap.md`

**Interfaces:**

- Consumes: nothing.
- Produces: the document Task 11 runs.

- [ ] **Step 1: Write the checklist**

Create `docs/smoke-checklist.md` with these five sections. The header is not optional and is not
softened:

> **Draft. Written from the code, not from a completed pass.** No person has yet clicked through
> placing a parlay, disputing an event, or arbitrating a wager. Every step below is derived from
> reading the implementation, which means it can be wrong in the two ways reading is always wrong: a
> step that cannot be performed as written, and a step nobody thought to write. **The first
> [MANUAL] run's job is to correct this document**, and its findings are worth more than its
> pass/fail result.

**A — Before you start.** Which environment is being checked and which database it points at. Repeat
the warning from [repo-health 3.7](../repo-health.md#37-postgres-without-docker-in-a-cloud-session):
any script that loads env with plain `dotenv` and no `override: true` is one ambient container
variable away from targeting the production database. Note that two Google accounts are needed for
the parts involving a second member.

**B — The machine half**, as a checkbox list: `npm ci`; `npm run verify`; `npm run build`; each of
the four cron routes returning 200 when dispatched by hand; `/admin/health` reporting every job
fresh; `reconcile` reporting no balance and no escrow drift.

**C — The hands half**, as one continuous numbered path with an expected result on every step:

1. Sign in with an account that has never signed in. Expect `/pending`, "Step 1 of 2".
2. From an admin account, approve it on `/admin`. Expect it to leave the queue.
3. Return to the first account and reload. Expect `/join`, "Step 2 of 2", with the season's real
   figures.
4. Join. Expect `/games` and the header balance matching the starting bankroll.
5. Place a single. Expect the balance to drop by the stake and a feed card to appear.
6. Place a parlay across two games. Expect one bet with combined odds, not two bets.
7. Settle a finished game (or run the settle cron). Expect the bet graded and the balance moved.
8. Open `/me`. Expect the ledger to list every entry and to sum to the header balance.
9. Create a custom event with two outcomes.
10. Bet it from the second account. Expect credits to move, not cash.
11. Resolve it from the creator account.
12. Dispute the resolution from the second account.
13. Correct it as an admin. Expect reversing entries, not edited ones.
14. Offer a wager to the second account. Expect your credits to drop at the offer.
15. Accept it. Claim a winner from one side and the other side from the other.
16. Arbitrate it as an admin.
17. React to a feed card and comment on it.
18. **Submit a comment eleven times quickly. Expect the eleventh to be refused with a countdown,
    and no eleventh comment to appear.**
19. Open `/rules` while signed out. Expect it to render, with the season's figures.
20. Visit `/events/does-not-exist`. Expect a not-found screen inside the app shell, not a white
    page.
21. Run `reconcile` once more. Expect no drift after everything above.

**D — The run log.** A table with columns Date, Who, Commit, Result, What broke. Empty on delivery.

**E — What this document cannot know yet.** Whether every step is performable as written; how long a
pass takes; whether a second Google account is actually available; and everything the pass turns up
that nobody thought to write down. Findings are filed as issues under the existing `from-test-pass`
label ([repo-health 4](../repo-health.md#4-issues-and-milestones)).

- [ ] **Step 2: Add the three documentation rows**

In `docs/README.md`, add to the **Active** table, after the hardening spec row:

```markdown
| [Hardening plan](plans/2026-09-03-hardening-implementation-plan.md) | The task-by-task plan for that work, lane-tagged, with what a cloud session can and cannot verify |
| [Smoke checklist](smoke-checklist.md) | The pre-deploy pass — machine half and hands half. A draft until a person has run it |
```

- [ ] **Step 3: Point the roadmap's phase 9 at the spec and plan**

In `docs/roadmap.md`, change row 9 of the master table's Reference column from `—` to:

```markdown
[spec](specs/2026-09-03-hardening-design.md) · [plan](plans/2026-09-03-hardening-implementation-plan.md)
```

Then in the `## 9 — Hardening` section's task table, change the smoke-checklist row's status to
`🔄 Drafted — awaiting a [MANUAL] pass` and link it to
[`smoke-checklist.md`](../smoke-checklist.md). **Leave the other three rows at 🔲 Backlog until
their tasks actually land** — this plan being written is not the same as the work being done, and
the roadmap records what is in the repository.

- [ ] **Step 4: Check every link resolves**

```bash
npx prettier --check docs/
grep -o '](\./[^)]*' docs/smoke-checklist.md docs/README.md
```

Read each relative path and confirm the file exists. A broken docs link is invisible until somebody
follows it.

- [ ] **Step 5: Format and commit**

```bash
npm run format
git add docs
git commit -m "docs(phase-9): draft the smoke checklist and list it in the index"
```

---

## Task 11: Validate the checklist — **[MANUAL]**

**Files:**

- Modify: `docs/smoke-checklist.md`

**This task cannot be done by a cloud session, a local session, or CI.** It is a person with two
Google accounts and a browser, and it is the reason the checklist exists.

- [ ] **Step 1: Run section B against the deployed app.** Record what each command actually printed,
      not what it was expected to print.
- [ ] **Step 2: Run section C from step 1 to step 21, in order, without skipping.** A step that
      cannot be performed as written is the most valuable output of this pass — write down what
      happened instead.
- [ ] **Step 3: Correct the document.** Fix every step that was wrong, add every step that was
      missing, and delete every step that turned out not to matter.
- [ ] **Step 4: Remove the draft header** and replace it with the date of this pass and the commit it
      ran against.
- [ ] **Step 5: File one issue per finding** under the `from-test-pass` label.
- [ ] **Step 6: Fill in the first row of the run log, and commit.**

---

## What a cloud session can and cannot prove

| Claim                                                           | Provable here                                                                                                                             |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| The policy arithmetic is right                                  | Yes — pure unit tests, no database in the import graph                                                                                    |
| The counter increments, refuses, and resets per window          | Yes — DB tests against the session's native Postgres                                                                                      |
| The limiter fails open                                          | Yes — the counter query is mocked to throw                                                                                                |
| No action can be added without a limit                          | Yes — the guard test, proven able to fail in Task 7 step 3                                                                                |
| Money directories take no diff                                  | Yes — `git diff --stat` on those paths                                                                                                    |
| Four gate screens, one component, four titles                   | Yes — structural test                                                                                                                     |
| `/rules` renders and quotes the right figures                   | Build proves it renders; the figures need a database with a season in it                                                                  |
| **Vercel's multi-instance behaviour matches the local counter** | **No.** The single-statement upsert is designed so it must, but one Node process against one database is the only evidence available here |
| **The rules copy reads correctly to a new member**              | **No.** [MANUAL], and most of the point of the page                                                                                       |
| **Any row of the checklist's hands half**                       | **No.** By construction — that is Task 11                                                                                                 |
