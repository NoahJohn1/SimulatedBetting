# Email notifications — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get six time-sensitive facts to the person they concern by email, individually
switchable with one global off, unsubscribable in one click without signing in — and make a
`settle` re-run send nothing a second time.

**Architecture:** Sixteen tasks. One new server directory, `src/server/notify/`, holding seven
small modules: two pure (`render`, `unsubscribe`), one network-only (`transport`), and four that
touch the database. Two new tables — `notification_preferences` and a `notifications` outbox whose
unique `dedupe_key` is the feed event's key with the recipient appended. Six existing emit points
gain one `enqueueNotification` call each; two events that have no emit point get one. Delivery is a
separate pass, triggered by `after()` for immediates and a new daily cron for the digest.

**Tech Stack:** Next.js 16.3.3 (App Router, `after` from `next/server`), TypeScript, Drizzle ORM +
Postgres, Vitest, Tailwind v4 with this repo's semantic token layer, `node:crypto`. No new npm
dependency.

**Spec:** [`docs/specs/2026-09-03-email-notifications-design.md`](../specs/2026-09-03-email-notifications-design.md).
Read it before Task 1. Decisions [D63](../decisions.md#d63--every-send-is-keyed-but-not-every-send-rides-a-feed-event)
through [D68](../decisions.md#d68--the-email-transport-is-inert-without-an-api-key) are already
recorded — do not re-litigate them, and do not add new ones without the decision-log skill.

---

## Global Constraints

These apply to every task and are not repeated per task.

- **Lane tags are mandatory.** Every task carries `[CLOUD]`, `[LOCAL]`, `[MANUAL]` or `[NOAH]`.
  Do not start a task whose lane you are not in.
- **Do not touch `src/server/odds/` or `src/app/api/cron/sync-odds/route.ts`.** Noah has unpushed
  ESPN adapter work there. If a task seems to need an edit there, you have misread the task.
- **`npm ci` first.** `node_modules` is absent at the start of a cloud session.
- **`npm test` DOES run in a cloud session.** The session-start hook installs and starts a native
  Postgres with no Docker daemon and migrates both databases. Measured 2026-09-03: 86 files, 925
  tests, exit 0, 76s. If a future session's hook fails to bring Postgres up, say so explicitly and
  mark DB tests written-but-not-run rather than claiming they passed.
- **`npm run verify` is the gate** — typecheck, lint, and the full suite. Run it before every
  commit that touches `src/`.
- **Run `npm run format` before every commit.** Prettier is adopted
  ([D55](../decisions.md#d55--prettier-adopted-with-a-config-matched-to-the-existing-code)).
  Do not add `format:check` to `verify` or CI — that is blocked on Noah.
- **Money is `bigint` cents everywhere.** Never `Number` an amount. `JSON.stringify` throws on
  bigint — route anything headed for jsonb or a response through `jsonSafe` in
  `src/server/cron/auth.ts`. In an email body, render cents through the decimal-string helper in
  Task 3, never through a number.
- **No raw colour classes in `.tsx`.** `src/app/__tests__/token-lint.test.ts` fails the build on a
  raw palette class, a hex value, or a `dark:` variant outside a four-entry allowlist. Use
  `text-ink-muted`, `bg-surface-raised`, `border-line`, and the rest of the semantic set.
- **Every form using `useTransition` must disable a control while pending.**
  `src/app/__tests__` asserts this structurally under
  [D51](../decisions.md#d51--ui-conventions-are-tested-structurally-not-with-a-component-test-harness).
- **Nothing about notifications may fail a cron route, an action, or a money transaction.**
  Delivery swallows and logs. The one deliberate exception is `enqueueNotification`, which runs
  inside the caller's transaction on purpose — see the money note below.
- **The money-touch hook fires on five files this plan edits.** `.claude/hooks/money-touch.sh`
  matches `src/server/money/*`, `src/server/bets/*`, `src/server/p2p/*`,
  `src/server/events/resolve.ts` and `src/db/schema/money.ts`. Tasks 8, 9 and 10 touch
  `src/server/p2p/offer.ts`, `src/server/p2p/claim.ts`, `src/server/p2p/sweep.ts`,
  `src/server/bets/grade-legs.ts` and `src/server/bets/resettle.ts`, so the hook prints its
  reminder and **`/money-invariants` must be run before each of those commits.** The task text
  says so again where it applies.
- **This plan adds no `postEntry` call.** If you find yourself writing one, stop — you have gone
  outside the plan. Nothing here writes to the ledger, changes a balance cache, or touches escrow.
- **Commit after every task.** Imperative subject, a body explaining _why_, and this repo's
  attribution footer.

---

## File Structure

| File                                                   | New?      | Responsibility                                                    |
| ------------------------------------------------------ | --------- | ----------------------------------------------------------------- |
| `src/db/schema/notify.ts`                              | new       | Three enums, `notification_preferences`, `notifications`          |
| `src/db/schema/index.ts`                               | modify    | Re-export `./notify`                                              |
| `src/db/schema/ops.ts`                                 | modify    | Add `NOTIFY` to the `job_name` enum                               |
| `src/test/db.ts`                                       | modify    | Add both new tables to the `TRUNCATE` list                        |
| `drizzle/00NN_*.sql`                                   | generated | The migration                                                     |
| `src/server/notify/types.ts`                           | new       | `NotificationRow`, `RenderedEmail`, `CHANNEL_FOR_TYPE`            |
| `src/server/notify/unsubscribe.ts`                     | new       | `signUnsubscribe`, `verifyUnsubscribe` — pure, `node:crypto` only |
| `src/server/notify/render.ts`                          | new       | `renderImmediate`, `renderDigest` — pure                          |
| `src/server/notify/transport.ts`                       | new       | `sendEmail` — Resend over `fetch`, or console                     |
| `src/server/notify/recipients.ts`                      | new       | `userIdForMembership`, `adminUserIds`, `seasonMemberUserIds`      |
| `src/server/notify/enqueue.ts`                         | new       | `enqueueNotification` — the only writer                           |
| `src/server/notify/preferences.ts`                     | new       | Read/write preferences, `isSuppressed`                            |
| `src/server/notify/deliver.ts`                         | new       | `deliverPending`, `flushSoon` — the only sender                   |
| `src/server/admin/approve.ts`                          | new       | `setUserStatus` — moved out of the page                           |
| `src/app/admin/page.tsx`                               | modify    | Call the new module instead of writing inline                     |
| `src/server/p2p/offer.ts`                              | modify    | Enqueue `WAGER_OFFERED`                                           |
| `src/server/p2p/claim.ts`                              | modify    | Enqueue `DISPUTE_NEEDS_RULING`                                    |
| `src/server/p2p/sweep.ts`                              | modify    | Enqueue from `overduePass`; add the fourth `expiringPass`         |
| `src/server/events/dispute.ts`                         | modify    | Enqueue `DISPUTE_NEEDS_RULING`                                    |
| `src/server/bets/grade-legs.ts`                        | modify    | Enqueue `BETS_SETTLED`                                            |
| `src/server/bets/resettle.ts`                          | modify    | Enqueue `BETS_SETTLED`                                            |
| `src/server/seasons/allowance.ts`                      | modify    | Fan `ALLOWANCE_PAID` out per member                               |
| `src/app/api/cron/notify/route.ts`                     | new       | The daily flush, wrapped in `runJob('NOTIFY', …)`                 |
| `src/app/api/cron/settle/route.ts`                     | modify    | Surface the new sweep counter                                     |
| `src/app/api/cron/reconcile/route.ts`                  | modify    | Prune `notifications` beside `pruneJobRuns`                       |
| `vercel.json`                                          | modify    | One cron entry                                                    |
| `src/app/(app)/me/notifications/page.tsx`              | new       | The six toggles and the master switch                             |
| `src/app/(app)/me/notifications/notification-form.tsx` | new       | The client form                                                   |
| `src/app/(app)/me/notifications/actions.ts`            | new       | `saveNotificationPreferencesAction`                               |
| `src/app/(app)/me/page.tsx`                            | modify    | One link                                                          |
| `src/app/unsubscribe/page.tsx`                         | new       | Public GET confirmation page — mutates nothing                    |
| `src/app/api/unsubscribe/route.ts`                     | new       | Public POST — the only unsubscribe writer                         |
| `src/server/ops/health.ts`                             | modify    | Report the live email transport                                   |
| `src/app/admin/health/page.tsx`                        | modify    | One row                                                           |
| `.env.example`, `README.md`                            | modify    | `RESEND_API_KEY`, `EMAIL_FROM`                                    |
| `docs/README.md`, `docs/roadmap.md`                    | modify    | The plan row and the phase-8 statuses                             |

`render.ts` and `unsubscribe.ts` are split out from `deliver.ts` rather than living inside it for
the reason the spec's §2 gives: they are the pieces most likely to be subtly wrong, and a module
with no repository imports can be tested with no database anywhere in its import graph.

---

## Before you start

- [ ] `npm ci`
- [ ] `git switch -c claude/phase-8-email-notifications-<suffix>` (or stay on it if already there)
- [ ] Read the spec: `docs/specs/2026-09-03-email-notifications-design.md`
- [ ] Read [D63–D68](../decisions.md#d63--every-send-is-keyed-but-not-every-send-rides-a-feed-event)
- [ ] Confirm the environment: `node -v` (expect v22.x) and `pg_isready` (expect
      "accepting connections"). If Postgres is **not** up, every task below marked **DB** is
      written-but-unrun and you must say so rather than claiming a pass.
- [ ] `npm test` once, before changing anything, to establish the baseline. Expect 86 files /
      925 tests passing.

---

### Task 1 [CLOUD]: The schema and the migration

**DB.** Requires Postgres.

**Files:**

- Create: `src/db/schema/notify.ts`
- Modify: `src/db/schema/index.ts`
- Modify: `src/db/schema/ops.ts`
- Modify: `src/test/db.ts`
- Test: `src/db/__tests__/notify-schema.test.ts`

**Interfaces:**

- Produces: `notificationType`, `notificationChannel`, `notificationOutcome` (pg enums);
  `notificationPreferences`, `notifications` (tables); and the exported types
  `NotificationType = 'WAGER_OFFERED' | 'OFFER_EXPIRING' | 'DISPUTE_NEEDS_RULING' | 'ACCOUNT_APPROVED' | 'BETS_SETTLED' | 'ALLOWANCE_PAID'`,
  `NotificationChannel = 'IMMEDIATE' | 'DIGEST'`,
  `NotificationOutcome = 'SENT' | 'SUPPRESSED' | 'FAILED'`.

- [ ] **Step 1: Write the failing test**

`src/db/__tests__/notify-schema.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { notifications, notificationPreferences, users } from '@/db/schema';
import { resetDb } from '@/test/db';

async function aUser(email = 'a@example.com') {
  const [row] = await db
    .insert(users)
    .values({ provider: 'GOOGLE', providerAccountId: email, email, displayName: 'A' })
    .returning({ id: users.id });
  return row.id;
}

beforeEach(resetDb);

describe('notifications', () => {
  it('rejects a second row with the same dedupe key', async () => {
    const userId = await aUser();
    const row = {
      userId,
      type: 'BETS_SETTLED' as const,
      channel: 'DIGEST' as const,
      dedupeKey: `bet:abc:settled:1:${userId}`,
      payload: { betId: 'abc' },
    };

    await db.insert(notifications).values(row);
    await db.insert(notifications).values(row).onConflictDoNothing({
      target: notifications.dedupeKey,
    });

    const all = await db.select().from(notifications).where(eq(notifications.userId, userId));
    expect(all).toHaveLength(1);
    expect(all[0].sentAt).toBeNull();
    expect(all[0].attempts).toBe(0);
    expect(all[0].outcome).toBeNull();
  });

  it('defaults a preferences row to everything on', async () => {
    const userId = await aUser('b@example.com');
    await db.insert(notificationPreferences).values({ userId });

    const [row] = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId));

    expect(row.mutedTypes).toEqual([]);
    expect(row.emailsEnabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/db/__tests__/notify-schema.test.ts`
Expected: FAIL — `notifications` is not exported from `@/db/schema`.

- [ ] **Step 3: Write the schema**

`src/db/schema/notify.ts`:

```ts
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './identity';

/**
 * Deliberately NOT `feed_event_type`. The six notification types are not the eighteen feed
 * types, and sharing the enum would let the preferences screen offer a switch for a
 * notification that does not exist (D63).
 */
export const notificationType = pgEnum('notification_type', [
  'WAGER_OFFERED',
  'OFFER_EXPIRING',
  'DISPUTE_NEEDS_RULING',
  'ACCOUNT_APPROVED',
  'BETS_SETTLED',
  'ALLOWANCE_PAID',
]);

export const notificationChannel = pgEnum('notification_channel', ['IMMEDIATE', 'DIGEST']);
export const notificationOutcome = pgEnum('notification_outcome', ['SENT', 'SUPPRESSED', 'FAILED']);

export type NotificationType = (typeof notificationType.enumValues)[number];
export type NotificationChannel = (typeof notificationChannel.enumValues)[number];
export type NotificationOutcome = (typeof notificationOutcome.enumValues)[number];

/**
 * Keyed on the user, not the membership, for the reason `feed_preferences` is: a preference is
 * about a person and should survive into next season rather than resetting when a new
 * membership row is created.
 *
 * No row means everything is on, which is how D50's opt-out default is expressed without
 * backfilling a row for every user who has ever signed in.
 *
 * `emailsEnabled` is separate from an empty `mutedTypes` on purpose: "off entirely" must not
 * depend on all six types being individually present, or a seventh type added later silently
 * turns itself back on for somebody who had opted out.
 */
export const notificationPreferences = pgTable('notification_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id),
  mutedTypes: notificationType('muted_types')
    .array()
    .notNull()
    .default(sql`'{}'::notification_type[]`),
  emailsEnabled: boolean('emails_enabled').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The outbox (D64). One row per fact per recipient, inserted inside the transaction that
 * produced the fact; a separate pass sends it and stamps `sentAt`.
 *
 * `dedupeKey` is the same guarantee `feed_events.dedupe_key` and
 * `ledger_entries.idempotency_key` give: a re-run of `settle` writes no second row, so there is
 * nothing to send twice. It is the feed event's own key with the recipient's user id appended,
 * because a feed event is one row for a season and a notification is one row per person (D63).
 *
 * `error` is `"Name: message"` and never a stack — the same rule `job_runs.error` follows.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    type: notificationType('type').notNull(),
    channel: notificationChannel('channel').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    payload: jsonb('payload').notNull(),
    queuedAt: timestamp('queued_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    outcome: notificationOutcome('outcome'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
  },
  (t) => [
    uniqueIndex('notifications_dedupe_key_idx').on(t.dedupeKey),
    // The delivery pass's only query: unsent rows, oldest first, filtered by channel.
    index('notifications_pending_idx')
      .on(t.channel, t.queuedAt)
      .where(sql`${t.sentAt} is null`),
  ],
);
```

- [ ] **Step 4: Export it, and extend the job enum**

In `src/db/schema/index.ts`, add alongside the existing re-exports:

```ts
export * from './notify';
```

In `src/db/schema/ops.ts`, extend the enum. `NOTIFY` goes **last**, so the existing values keep
their ordinals:

```ts
export const jobName = pgEnum('job_name', ['SETTLE', 'ALLOWANCE', 'RECONCILE', 'NOTIFY']);
```

- [ ] **Step 5: Add both tables to the test reset**

In `src/test/db.ts`, put them at the front of the `TRUNCATE` list — they reference `users`:

```ts
    sql`TRUNCATE TABLE notifications, notification_preferences, job_runs, feed_reactions, feed_comments, feed_events, feed_preferences, ledger_entries, p2p_wagers, bet_legs, bets, odds_snapshots, selections, markets, games, custom_event_disputes, custom_events, events, teams, season_memberships, seasons, users RESTART IDENTITY CASCADE`,
```

- [ ] **Step 6: Generate and apply the migration**

```bash
npm run db:generate
npm run db:migrate:test
```

Expected: a new `drizzle/00NN_*.sql` creating three types and two tables, plus an
`ALTER TYPE job_name ADD VALUE 'NOTIFY'`.

**Read the generated SQL before continuing.** If drizzle-kit emitted a `DROP TYPE`/recreate for
`job_name` rather than an `ALTER TYPE … ADD VALUE`, hand-edit it to the `ALTER TYPE` form —
dropping the type would take `job_runs` with it.

> The migration number depends on your base. `main` ends at `0013`; the phase-6 branch adds
> `0014`. `drizzle-kit generate` picks the next free number — use whatever it picks, do not
> rename it.

- [ ] **Step 7: Run the test and watch it pass**

Run: `npx vitest run src/db/__tests__/notify-schema.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 8: Full verify, then commit**

```bash
npm run format && npm run verify
git add src/db drizzle src/test/db.ts
git commit -m "feat(notify): add the notification outbox and preferences tables"
```

---

### Task 2 [CLOUD]: `unsubscribe.ts` — the signed token

Pure. No database, no network, and no repository imports beyond the enum's values.

**Files:**

- Create: `src/server/notify/unsubscribe.ts`
- Test: `src/server/notify/__tests__/unsubscribe.test.ts`

**Interfaces:**

- Consumes: `notificationType`, `NotificationType` from Task 1.
- Produces:
  - `export type UnsubscribeScope = 'all' | NotificationType`
  - `export function signUnsubscribe(userId: string, scope: UnsubscribeScope): string` — throws
    when `AUTH_SECRET` is unset.
  - `export function verifyUnsubscribe(userId: string, scope: string, token: string): UnsubscribeScope | null`
    — never throws; returns the validated scope, or `null`.
  - `export function unsubscribeUrl(baseUrl: string, userId: string, scope: UnsubscribeScope, path?: string): string`

- [ ] **Step 1: Write the failing test**

`src/server/notify/__tests__/unsubscribe.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signUnsubscribe, unsubscribeUrl, verifyUnsubscribe } from '@/server/notify/unsubscribe';

const USER = '11111111-1111-1111-1111-111111111111';

beforeEach(() => vi.stubEnv('AUTH_SECRET', 'test-secret'));
afterEach(() => vi.unstubAllEnvs());

describe('signUnsubscribe / verifyUnsubscribe', () => {
  it('round-trips a type scope', () => {
    const token = signUnsubscribe(USER, 'BETS_SETTLED');
    expect(verifyUnsubscribe(USER, 'BETS_SETTLED', token)).toBe('BETS_SETTLED');
  });

  it('round-trips the global scope', () => {
    const token = signUnsubscribe(USER, 'all');
    expect(verifyUnsubscribe(USER, 'all', token)).toBe('all');
  });

  it('rejects a tampered token', () => {
    const token = signUnsubscribe(USER, 'BETS_SETTLED');
    expect(verifyUnsubscribe(USER, 'BETS_SETTLED', `${token.slice(0, -1)}x`)).toBeNull();
  });

  it('rejects a token minted for another user', () => {
    const token = signUnsubscribe(USER, 'BETS_SETTLED');
    expect(
      verifyUnsubscribe('22222222-2222-2222-2222-222222222222', 'BETS_SETTLED', token),
    ).toBeNull();
  });

  it('rejects a token minted for a narrower scope — one link cannot widen itself', () => {
    const token = signUnsubscribe(USER, 'BETS_SETTLED');
    expect(verifyUnsubscribe(USER, 'all', token)).toBeNull();
  });

  it('rejects a scope that is not a notification type', () => {
    const token = signUnsubscribe(USER, 'BETS_SETTLED');
    expect(verifyUnsubscribe(USER, 'DROP TABLE users', token)).toBeNull();
  });

  it('rejects a token of the wrong length without throwing', () => {
    expect(verifyUnsubscribe(USER, 'all', 'short')).toBeNull();
  });

  it('rejects everything when AUTH_SECRET is unset, rather than accepting everything', () => {
    const token = signUnsubscribe(USER, 'all');
    vi.stubEnv('AUTH_SECRET', '');
    expect(verifyUnsubscribe(USER, 'all', token)).toBeNull();
  });

  it('builds a URL carrying user, scope and token', () => {
    const url = new URL(unsubscribeUrl('https://bets.example', USER, 'ALLOWANCE_PAID'));
    expect(url.pathname).toBe('/unsubscribe');
    expect(url.searchParams.get('u')).toBe(USER);
    expect(url.searchParams.get('s')).toBe('ALLOWANCE_PAID');
    expect(verifyUnsubscribe(USER, 'ALLOWANCE_PAID', url.searchParams.get('t')!)).toBe(
      'ALLOWANCE_PAID',
    );
  });

  it('points at the POST route when asked, for the RFC 8058 header', () => {
    const url = new URL(
      unsubscribeUrl('https://bets.example', USER, 'BETS_SETTLED', '/api/unsubscribe'),
    );
    expect(url.pathname).toBe('/api/unsubscribe');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/server/notify/__tests__/unsubscribe.test.ts`
Expected: FAIL — cannot resolve `@/server/notify/unsubscribe`.

- [ ] **Step 3: Implement**

`src/server/notify/unsubscribe.ts`:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import { notificationType, type NotificationType } from '@/db/schema';

export type UnsubscribeScope = 'all' | NotificationType;

const SCOPES = new Set<string>(['all', ...notificationType.enumValues]);

/**
 * Derived, never stored (D67). No column, no lookup, no expiry — `AUTH_SECRET` already exists
 * and the token is a function of the user and the scope.
 *
 * The `v1:` prefix means the scheme can be changed later without silently honouring tokens
 * minted under the old one.
 */
function sign(secret: string, userId: string, scope: string): string {
  return createHmac('sha256', secret).update(`unsub:v1:${userId}:${scope}`).digest('base64url');
}

export function signUnsubscribe(userId: string, scope: UnsubscribeScope): string {
  const secret = process.env.AUTH_SECRET;
  // Signing without a secret would mint tokens that verify against nothing. Fail here rather
  // than shipping dead links into somebody's inbox.
  if (!secret) throw new Error('AUTH_SECRET is not set, so unsubscribe links cannot be signed');
  return sign(secret, userId, scope);
}

/** Returns the validated scope, or null. Never throws — this runs on a public route. */
export function verifyUnsubscribe(
  userId: string,
  scope: string,
  token: string,
): UnsubscribeScope | null {
  const secret = process.env.AUTH_SECRET;
  // No secret means no token can be trusted. Fail closed, as `authorizeCronRequest` does.
  if (!secret) return null;
  if (!SCOPES.has(scope)) return null;

  const expected = Buffer.from(sign(secret, userId, scope));
  const given = Buffer.from(token);
  // timingSafeEqual throws on a length mismatch, so lengths are compared first.
  if (expected.length !== given.length) return null;
  if (!timingSafeEqual(expected, given)) return null;

  return scope as UnsubscribeScope;
}

export function unsubscribeUrl(
  baseUrl: string,
  userId: string,
  scope: UnsubscribeScope,
  path = '/unsubscribe',
): string {
  const url = new URL(path, baseUrl);
  url.searchParams.set('u', userId);
  url.searchParams.set('s', scope);
  url.searchParams.set('t', signUnsubscribe(userId, scope));
  return url.toString();
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/server/notify/__tests__/unsubscribe.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
npm run format && npm run verify
git add src/server/notify
git commit -m "feat(notify): sign unsubscribe links with a derived HMAC"
```

---

### Task 3 [CLOUD]: `types.ts` and `render.ts` — the email bodies

Pure. `render.ts` imports `types.ts` and `unsubscribe.ts` and nothing else.

**Files:**

- Create: `src/server/notify/types.ts`
- Create: `src/server/notify/render.ts`
- Test: `src/server/notify/__tests__/render.test.ts`

**Interfaces:**

- Consumes: `unsubscribeUrl` (Task 2); `NotificationType`, `NotificationChannel` (Task 1).
- Produces:
  - `NotificationRow = { id: string; userId: string; type: NotificationType; channel: NotificationChannel; payload: Record<string, unknown>; queuedAt: Date }`
  - `RenderedEmail = { subject: string; text: string; html: string; headers: Record<string, string> }`
  - `CHANNEL_FOR_TYPE: Record<NotificationType, NotificationChannel>`
  - `renderImmediate(row: NotificationRow, baseUrl: string): RenderedEmail`
  - `renderDigest(rows: NotificationRow[], baseUrl: string): RenderedEmail`

- [ ] **Step 1: Write the failing test**

`src/server/notify/__tests__/render.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderDigest, renderImmediate } from '@/server/notify/render';
import type { NotificationRow } from '@/server/notify/types';

const USER = '11111111-1111-1111-1111-111111111111';
const BASE = 'https://bets.example';

beforeEach(() => vi.stubEnv('AUTH_SECRET', 'test-secret'));
afterEach(() => vi.unstubAllEnvs());

function row(over: Partial<NotificationRow>): NotificationRow {
  return {
    id: 'n1',
    userId: USER,
    type: 'WAGER_OFFERED',
    channel: 'IMMEDIATE',
    payload: {},
    queuedAt: new Date('2026-09-03T12:00:00Z'),
    ...over,
  };
}

describe('renderImmediate', () => {
  it('names the offerer, the subject and the stake', () => {
    const email = renderImmediate(
      row({
        type: 'WAGER_OFFERED',
        payload: { fromName: 'Dana', subject: 'Chiefs -3.5', stakeCents: '2500' },
      }),
      BASE,
    );

    expect(email.subject).toBe('Dana offered you a wager');
    expect(email.text).toContain('Chiefs -3.5');
    expect(email.text).toContain('25.00');
  });

  it('sets the one-click headers scoped to this email’s own type, never to all', () => {
    const email = renderImmediate(row({ type: 'WAGER_OFFERED' }), BASE);

    expect(email.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    const header = email.headers['List-Unsubscribe'];
    expect(header.startsWith('<')).toBe(true);
    expect(header.endsWith('>')).toBe(true);

    const url = new URL(header.slice(1, -1));
    expect(url.pathname).toBe('/api/unsubscribe');
    expect(url.searchParams.get('s')).toBe('WAGER_OFFERED');
  });

  it('offers both scopes in the footer', () => {
    const email = renderImmediate(row({ type: 'OFFER_EXPIRING' }), BASE);
    expect(email.text).toContain('s=OFFER_EXPIRING');
    expect(email.text).toContain('s=all');
  });

  it('escapes payload text into the HTML body', () => {
    const email = renderImmediate(
      row({ type: 'WAGER_OFFERED', payload: { fromName: '<script>x</script>' } }),
      BASE,
    );
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });

  it('renders every immediate type without throwing', () => {
    for (const type of [
      'WAGER_OFFERED',
      'OFFER_EXPIRING',
      'DISPUTE_NEEDS_RULING',
      'ACCOUNT_APPROVED',
    ] as const) {
      const email = renderImmediate(row({ type }), BASE);
      expect(email.subject.length).toBeGreaterThan(0);
      expect(email.html).toContain('<p>');
    }
  });
});

describe('renderDigest', () => {
  it('collapses bets and the allowance into one email', () => {
    const email = renderDigest(
      [
        row({ type: 'ALLOWANCE_PAID', channel: 'DIGEST', payload: { amountCents: '50000' } }),
        row({
          id: 'n2',
          type: 'BETS_SETTLED',
          channel: 'DIGEST',
          payload: { outcome: 'WON', netCents: '1500', subject: 'Chiefs -3.5' },
        }),
        row({
          id: 'n3',
          type: 'BETS_SETTLED',
          channel: 'DIGEST',
          payload: { outcome: 'LOST', netCents: '-2000', subject: 'Bills ML' },
        }),
      ],
      BASE,
    );

    expect(email.subject).toBe('2 bets settled, and your allowance landed');
    expect(email.text).toContain('Chiefs -3.5');
    expect(email.text).toContain('Bills ML');
    expect(email.text).toContain('500.00');
    expect(email.text).toContain('-20.00');
  });

  it('says only what happened when there is no allowance', () => {
    const email = renderDigest(
      [
        row({
          type: 'BETS_SETTLED',
          channel: 'DIGEST',
          payload: { outcome: 'WON', netCents: '1500', subject: 'Chiefs -3.5' },
        }),
      ],
      BASE,
    );
    expect(email.subject).toBe('1 bet settled');
  });

  it('renders money from decimal strings, never from a JSON number', () => {
    const email = renderDigest(
      [
        row({
          type: 'ALLOWANCE_PAID',
          channel: 'DIGEST',
          payload: { amountCents: '900719925474099' },
        }),
      ],
      BASE,
    );
    // Past 2^53 a JSON number would have lost digits by now.
    expect(email.text).toContain('9007199254740.99');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/server/notify/__tests__/render.test.ts`
Expected: FAIL — cannot resolve `@/server/notify/render`.

- [ ] **Step 3: Write `types.ts`**

```ts
import type { NotificationChannel, NotificationType } from '@/db/schema';

/**
 * What an email renders from, frozen at the moment the fact happened — the same discipline
 * `FeedEventPayload` follows, and for the same reason: identity is joined live, facts freeze.
 *
 * Money in `payload` is a decimal string, never a JSON number. `JSON.stringify` throws on a
 * bigint and a number silently loses precision past 2^53 (D25).
 */
export interface NotificationRow {
  id: string;
  userId: string;
  type: NotificationType;
  channel: NotificationChannel;
  payload: Record<string, unknown>;
  queuedAt: Date;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
  /** RFC 8058. Gmail and Apple Mail render a native control that POSTs to this. */
  headers: Record<string, string>;
}

/**
 * The channel is a property of the type, and `enqueueNotification` reads it from here rather
 * than taking it from the caller — one place to look, and no call site can queue a settlement
 * as an immediate by mistake.
 */
export const CHANNEL_FOR_TYPE: Record<NotificationType, NotificationChannel> = {
  WAGER_OFFERED: 'IMMEDIATE',
  OFFER_EXPIRING: 'IMMEDIATE',
  DISPUTE_NEEDS_RULING: 'IMMEDIATE',
  ACCOUNT_APPROVED: 'IMMEDIATE',
  BETS_SETTLED: 'DIGEST',
  ALLOWANCE_PAID: 'DIGEST',
};
```

- [ ] **Step 4: Write `render.ts`**

```ts
import type { NotificationType } from '@/db/schema';
import { unsubscribeUrl } from './unsubscribe';
import type { NotificationRow, RenderedEmail } from './types';

/** Cents as a decimal string, in from jsonb and out to a body, never through a number. */
function money(cents: unknown): string {
  const n = BigInt(String(cents ?? '0'));
  const negative = n < 0n;
  const abs = negative ? -n : n;
  return `${negative ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}

function str(payload: Record<string, unknown>, key: string, fallback = ''): string {
  const value = payload[key];
  return typeof value === 'string' ? value : fallback;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function immediateBody(row: NotificationRow): { subject: string; lines: string[] } {
  const p = row.payload;

  switch (row.type) {
    case 'WAGER_OFFERED':
      return {
        subject: `${str(p, 'fromName', 'Someone')} offered you a wager`,
        lines: [
          `${str(p, 'fromName', 'Someone')} has offered you a wager on ${str(p, 'subject')}.`,
          `Their stake: ${money(p.stakeCents)} credits.`,
          'If nobody accepts it, it expires and the credits go back.',
        ],
      };
    case 'OFFER_EXPIRING':
      return {
        subject: `A wager offer expires soon — ${str(p, 'subject')}`,
        lines: [
          `The offer on ${str(p, 'subject')} expires ${str(p, 'expiresAt')}.`,
          'Once it lapses the escrowed credits go back to whoever offered them.',
        ],
      };
    case 'DISPUTE_NEEDS_RULING':
      return {
        subject: `A dispute needs your ruling — ${str(p, 'subject')}`,
        lines: [
          `${str(p, 'subject')} is disputed and waiting on an admin.`,
          'Nothing settles until somebody rules on it.',
        ],
      };
    case 'ACCOUNT_APPROVED':
      return {
        subject: 'Your account was approved',
        lines: ['An admin approved your account. You can join the season and start betting.'],
      };
    // BETS_SETTLED and ALLOWANCE_PAID are DIGEST types and never reach this function. The
    // default keeps that harmless if somebody edits CHANNEL_FOR_TYPE without editing this.
    default:
      return {
        subject: 'An update from the sportsbook',
        lines: ['Something happened that concerns you.'],
      };
  }
}

function footer(userId: string, scope: NotificationType | 'all', baseUrl: string): string[] {
  return [
    '',
    '—',
    `Stop these emails: ${unsubscribeUrl(baseUrl, userId, scope)}`,
    `Stop all email: ${unsubscribeUrl(baseUrl, userId, 'all')}`,
    `Change what you get: ${new URL('/me/notifications', baseUrl).toString()}`,
  ];
}

function oneClickHeaders(
  userId: string,
  scope: NotificationType | 'all',
  baseUrl: string,
): Record<string, string> {
  // RFC 8058. The scope is this email's own type, never `all`: somebody pressing Gmail's native
  // button means "stop sending me this", not "stop sending me everything" (D67).
  return {
    'List-Unsubscribe': `<${unsubscribeUrl(baseUrl, userId, scope, '/api/unsubscribe')}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

function assemble(
  subject: string,
  lines: string[],
  userId: string,
  scope: NotificationType | 'all',
  baseUrl: string,
): RenderedEmail {
  const all = [...lines, ...footer(userId, scope, baseUrl)];
  return {
    subject,
    text: all.join('\n'),
    html: all.map((line) => (line === '' ? '<p></p>' : `<p>${escapeHtml(line)}</p>`)).join('\n'),
    headers: oneClickHeaders(userId, scope, baseUrl),
  };
}

export function renderImmediate(row: NotificationRow, baseUrl: string): RenderedEmail {
  const { subject, lines } = immediateBody(row);
  return assemble(subject, lines, row.userId, row.type, baseUrl);
}

/**
 * One email per recipient, across types (D66). A Tuesday reads "your allowance landed, and here
 * is how four bets settled" rather than arriving as five separate messages.
 */
export function renderDigest(rows: NotificationRow[], baseUrl: string): RenderedEmail {
  const bets = rows.filter((r) => r.type === 'BETS_SETTLED');
  const allowances = rows.filter((r) => r.type === 'ALLOWANCE_PAID');

  const parts: string[] = [];
  if (bets.length > 0) parts.push(`${bets.length} bet${bets.length === 1 ? '' : 's'} settled`);
  if (allowances.length > 0) parts.push('your allowance landed');
  const subject = parts.length > 0 ? parts.join(', and ') : 'Your sportsbook digest';

  const lines: string[] = [];

  if (allowances.length > 0) {
    const total = allowances.reduce(
      (sum, r) => sum + BigInt(String(r.payload.amountCents ?? '0')),
      0n,
    );
    lines.push(`Your weekly allowance landed: ${money(total)}.`, '');
  }

  if (bets.length > 0) {
    lines.push('How your bets settled:');
    for (const bet of bets) {
      lines.push(
        `  ${str(bet.payload, 'outcome')} — ${str(bet.payload, 'subject')} (${money(bet.payload.netCents)})`,
      );
    }
  }

  // The digest's unsubscribe scope is BETS_SETTLED when there are bets, since that is what most
  // of the message is; a recipient who only ever gets the allowance line gets that scope.
  const scope: NotificationType = bets.length > 0 ? 'BETS_SETTLED' : 'ALLOWANCE_PAID';
  return assemble(subject, lines, rows[0].userId, scope, baseUrl);
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run src/server/notify/__tests__/render.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
npm run format && npm run verify
git add src/server/notify
git commit -m "feat(notify): render the six email bodies with RFC 8058 headers"
```

---

### Task 4 [CLOUD]: `transport.ts` — Resend, or the console

**Files:**

- Create: `src/server/notify/transport.ts`
- Test: `src/server/notify/__tests__/transport.test.ts`

**Interfaces:**

- Consumes: `RenderedEmail` (Task 3).
- Produces:
  - `OutgoingEmail = { to: string; email: RenderedEmail }`
  - `SendResult = { ok: true } | { ok: false; error: string }`
  - `sendEmail(message: OutgoingEmail): Promise<SendResult>` — never throws.
  - `activeTransport(): 'resend' | 'console'`

- [ ] **Step 1: Write the failing test**

`src/server/notify/__tests__/transport.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeTransport, sendEmail } from '@/server/notify/transport';
import type { RenderedEmail } from '@/server/notify/types';

const email: RenderedEmail = {
  subject: 'Your account was approved',
  text: 'body',
  html: '<p>body</p>',
  headers: { 'List-Unsubscribe': '<https://x/y>' },
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('activeTransport', () => {
  it('is console when no API key is set', () => {
    vi.stubEnv('RESEND_API_KEY', '');
    expect(activeTransport()).toBe('console');
  });

  it('is resend when a key is set', () => {
    vi.stubEnv('RESEND_API_KEY', 're_abc');
    expect(activeTransport()).toBe('resend');
  });
});

describe('sendEmail', () => {
  it('sends nothing and reports success without a key — dev mode is the absence of one', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});

    const result = await sendEmail({ to: 'a@example.com', email });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  });

  it('POSTs to Resend with the bearer key and the one-click headers', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_abc');
    vi.stubEnv('EMAIL_FROM', 'Bets <bets@example.com>');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendEmail({ to: 'a@example.com', email });

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.authorization).toBe('Bearer re_abc');

    const body = JSON.parse(init.body);
    expect(body.to).toEqual(['a@example.com']);
    expect(body.from).toBe('Bets <bets@example.com>');
    expect(body.subject).toBe('Your account was approved');
    expect(body.headers['List-Unsubscribe']).toBe('<https://x/y>');
  });

  it('reports a non-2xx as a failure rather than throwing', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_abc');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 422 })));

    const result = await sendEmail({ to: 'a@example.com', email });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('422');
  });

  it('reports a thrown fetch as a failure rather than propagating it', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_abc');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')));

    const result = await sendEmail({ to: 'a@example.com', email });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe('TypeError: network down');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/server/notify/__tests__/transport.test.ts`
Expected: FAIL — cannot resolve `@/server/notify/transport`.

- [ ] **Step 3: Implement**

`src/server/notify/transport.ts`:

```ts
import type { RenderedEmail } from './types';

export interface OutgoingEmail {
  to: string;
  email: RenderedEmail;
}

export type SendResult = { ok: true } | { ok: false; error: string };

const SEND_TIMEOUT_MS = 10_000;
const DEFAULT_FROM = 'SimulatedBetting <onboarding@resend.dev>';

/**
 * Dev mode is the absence of a key, not a second flag (D68).
 *
 * This is the idiom the repo already uses twice — `ALERT_WEBHOOK_URL` unset makes `raiseAlert`
 * warn rather than fail, and D62 makes Sentry inert without a DSN. It also means CI and the test
 * suite cannot send mail by construction, since no key is ever set there.
 */
export function activeTransport(): 'resend' | 'console' {
  return process.env.RESEND_API_KEY ? 'resend' : 'console';
}

/** Never throws. A dead provider must not be able to fail the pass that called it. */
export async function sendEmail({ to, email }: OutgoingEmail): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;

  if (!key) {
    console.info(
      `[notify] no RESEND_API_KEY, so this was not sent:\nto: ${to}\nsubject: ${email.subject}\n${email.text}`,
    );
    return { ok: true };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || DEFAULT_FROM,
        to: [to],
        subject: email.subject,
        text: email.text,
        html: email.html,
        headers: email.headers,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return { ok: false, error: `Resend answered ${response.status}: ${detail.slice(0, 200)}` };
    }

    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return { ok: false, error: `${error.name}: ${error.message}` };
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/server/notify/__tests__/transport.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
npm run format && npm run verify
git add src/server/notify
git commit -m "feat(notify): send through Resend, inert without an API key"
```

---

### Task 5 [CLOUD]: `enqueue.ts`, `recipients.ts` and `preferences.ts`

**DB.** Requires Postgres.

**Files:**

- Create: `src/server/notify/enqueue.ts`
- Create: `src/server/notify/recipients.ts`
- Create: `src/server/notify/preferences.ts`
- Test: `src/server/notify/__tests__/enqueue.test.ts`
- Test: `src/server/notify/__tests__/preferences.test.ts`

**Interfaces:**

- Consumes: `CHANNEL_FOR_TYPE` (Task 3), `Tx` from `@/db/client`.
- Produces:
  - `EnqueueInput = { userId: string; type: NotificationType; dedupeKey: string; payload: Record<string, unknown> }`
  - `enqueueNotification(tx: Tx, input: EnqueueInput): Promise<{ applied: boolean }>`
  - `userIdForMembership(tx: Tx, membershipId: string): Promise<string | null>`
  - `adminUserIds(tx: Tx): Promise<string[]>`
  - `seasonMemberUserIds(tx: Tx, seasonId: string): Promise<{ membershipId: string; userId: string }[]>`
  - `NotificationPreferences = { mutedTypes: NotificationType[]; emailsEnabled: boolean }`
  - `getNotificationPreferences(userId: string): Promise<NotificationPreferences>`
  - `getManyNotificationPreferences(userIds: string[]): Promise<Map<string, NotificationPreferences>>`
  - `setNotificationPreferences(userId: string, next: NotificationPreferences): Promise<void>`
  - `muteType(userId: string, type: NotificationType): Promise<void>`
  - `disableAllEmail(userId: string): Promise<void>`
  - `isSuppressed(prefs: NotificationPreferences, type: NotificationType): boolean`

- [ ] **Step 1: Write the failing enqueue test**

`src/server/notify/__tests__/enqueue.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { notifications, users } from '@/db/schema';
import { enqueueNotification } from '@/server/notify/enqueue';
import { resetDb } from '@/test/db';

async function aUser(email = 'a@example.com') {
  const [row] = await db
    .insert(users)
    .values({ provider: 'GOOGLE', providerAccountId: email, email, displayName: 'A' })
    .returning({ id: users.id });
  return row.id;
}

beforeEach(resetDb);

describe('enqueueNotification', () => {
  it('writes one row, and takes the channel from the type rather than the caller', async () => {
    const userId = await aUser();

    const result = await db.transaction((tx) =>
      enqueueNotification(tx, {
        userId,
        type: 'ACCOUNT_APPROVED',
        dedupeKey: `user:${userId}:approved`,
        payload: {},
      }),
    );

    expect(result.applied).toBe(true);
    const rows = await db.select().from(notifications).where(eq(notifications.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0].channel).toBe('IMMEDIATE');
  });

  it('is a no-op on a repeat, which is what makes a settle re-run safe', async () => {
    const userId = await aUser();
    const input = {
      userId,
      type: 'BETS_SETTLED' as const,
      dedupeKey: `bet:abc:settled:1:${userId}`,
      payload: { outcome: 'WON' },
    };

    const first = await db.transaction((tx) => enqueueNotification(tx, input));
    const second = await db.transaction((tx) => enqueueNotification(tx, input));

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(await db.select().from(notifications)).toHaveLength(1);
  });

  it('treats a different attempt as a different fact, so a correction re-notifies', async () => {
    const userId = await aUser();
    const base = { userId, type: 'BETS_SETTLED' as const, payload: {} };

    await db.transaction((tx) =>
      enqueueNotification(tx, { ...base, dedupeKey: `bet:abc:settled:1:${userId}` }),
    );
    await db.transaction((tx) =>
      enqueueNotification(tx, { ...base, dedupeKey: `bet:abc:settled:2:${userId}` }),
    );

    expect(await db.select().from(notifications)).toHaveLength(2);
  });

  it('gives two recipients of the same fact a row each', async () => {
    const a = await aUser('a@example.com');
    const b = await aUser('b@example.com');

    for (const userId of [a, b]) {
      await db.transaction((tx) =>
        enqueueNotification(tx, {
          userId,
          type: 'ALLOWANCE_PAID',
          dedupeKey: `allowance:s1:2026-W36:${userId}`,
          payload: { amountCents: '50000' },
        }),
      );
    }

    const rows = await db.select().from(notifications);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.channel === 'DIGEST')).toBe(true);
  });

  it('rolls back with its transaction — a queued email never outlives a failed settle', async () => {
    const userId = await aUser();

    await expect(
      db.transaction(async (tx) => {
        await enqueueNotification(tx, {
          userId,
          type: 'ACCOUNT_APPROVED',
          dedupeKey: `user:${userId}:approved`,
          payload: {},
        });
        throw new Error('the settlement failed after the enqueue');
      }),
    ).rejects.toThrow('the settlement failed');

    expect(await db.select().from(notifications)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Write the failing preferences test**

`src/server/notify/__tests__/preferences.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import {
  disableAllEmail,
  getManyNotificationPreferences,
  getNotificationPreferences,
  isSuppressed,
  muteType,
  setNotificationPreferences,
} from '@/server/notify/preferences';
import { resetDb } from '@/test/db';

async function aUser(email = 'a@example.com') {
  const [row] = await db
    .insert(users)
    .values({ provider: 'GOOGLE', providerAccountId: email, email, displayName: 'A' })
    .returning({ id: users.id });
  return row.id;
}

beforeEach(resetDb);

describe('getNotificationPreferences', () => {
  it('defaults to everything on when no row exists — opt-out by default (D50)', async () => {
    const userId = await aUser();
    expect(await getNotificationPreferences(userId)).toEqual({
      mutedTypes: [],
      emailsEnabled: true,
    });
  });
});

describe('getManyNotificationPreferences', () => {
  it('returns a default for every id asked about, row or no row', async () => {
    const a = await aUser('a@example.com');
    const b = await aUser('b@example.com');
    await setNotificationPreferences(a, { mutedTypes: ['BETS_SETTLED'], emailsEnabled: true });

    const map = await getManyNotificationPreferences([a, b]);

    expect(map.get(a)).toEqual({ mutedTypes: ['BETS_SETTLED'], emailsEnabled: true });
    expect(map.get(b)).toEqual({ mutedTypes: [], emailsEnabled: true });
  });

  it('is empty for an empty request rather than querying', async () => {
    expect((await getManyNotificationPreferences([])).size).toBe(0);
  });
});

describe('setNotificationPreferences', () => {
  it('upserts, so the first save needs no pre-existing row', async () => {
    const userId = await aUser();

    await setNotificationPreferences(userId, {
      mutedTypes: ['BETS_SETTLED', 'BETS_SETTLED'],
      emailsEnabled: false,
    });

    const prefs = await getNotificationPreferences(userId);
    // De-duplicated, because the read filter treats the array as a set.
    expect(prefs.mutedTypes).toEqual(['BETS_SETTLED']);
    expect(prefs.emailsEnabled).toBe(false);
  });
});

describe('muteType and disableAllEmail', () => {
  it('adds one type without disturbing the others', async () => {
    const userId = await aUser();
    await muteType(userId, 'WAGER_OFFERED');
    await muteType(userId, 'ALLOWANCE_PAID');
    await muteType(userId, 'WAGER_OFFERED');

    const prefs = await getNotificationPreferences(userId);
    expect([...prefs.mutedTypes].sort()).toEqual(['ALLOWANCE_PAID', 'WAGER_OFFERED']);
    expect(prefs.emailsEnabled).toBe(true);
  });

  it('turns everything off without listing the types, so turning it back on restores them', async () => {
    const userId = await aUser();
    await muteType(userId, 'WAGER_OFFERED');
    await disableAllEmail(userId);

    const prefs = await getNotificationPreferences(userId);
    expect(prefs.emailsEnabled).toBe(false);
    expect(prefs.mutedTypes).toEqual(['WAGER_OFFERED']);
  });
});

describe('isSuppressed', () => {
  it('suppresses a muted type', () => {
    expect(
      isSuppressed({ mutedTypes: ['BETS_SETTLED'], emailsEnabled: true }, 'BETS_SETTLED'),
    ).toBe(true);
  });

  it('suppresses every type when email is off entirely', () => {
    expect(isSuppressed({ mutedTypes: [], emailsEnabled: false }, 'ACCOUNT_APPROVED')).toBe(true);
  });

  it('passes an unmuted type', () => {
    expect(
      isSuppressed({ mutedTypes: ['BETS_SETTLED'], emailsEnabled: true }, 'WAGER_OFFERED'),
    ).toBe(false);
  });
});
```

- [ ] **Step 3: Run both and watch them fail**

```bash
npx vitest run src/server/notify/__tests__/enqueue.test.ts src/server/notify/__tests__/preferences.test.ts
```

Expected: FAIL — neither module resolves.

- [ ] **Step 4: Write `enqueue.ts`**

```ts
import type { Tx } from '@/db/client';
import { notifications, type NotificationType } from '@/db/schema';
import { CHANNEL_FOR_TYPE } from './types';

export interface EnqueueInput {
  userId: string;
  type: NotificationType;
  /** Deterministic. The feed event's own dedupe key with the recipient appended (D63). */
  dedupeKey: string;
  payload: Record<string, unknown>;
}

/**
 * The single write path into the outbox.
 *
 * Takes a `tx` rather than opening its own, deliberately, and for the reason `emitFeedEvent`
 * gives: a notification that commits separately from the fact it describes can announce a
 * settlement that rolled back. Inside the transaction this is one INSERT with no joins and no
 * computation, so the only way it fails is a database that is unavailable — in which case the
 * settlement must not commit either.
 *
 * `ON CONFLICT DO NOTHING` on the unique key is what makes a `settle` re-run send nothing a
 * second time. That is the whole point of the table (D64).
 *
 * Preferences are NOT read here. They are applied at delivery, so this stays a pure function of
 * the fact rather than of who happens to be listening (D65).
 */
export async function enqueueNotification(
  tx: Tx,
  input: EnqueueInput,
): Promise<{ applied: boolean }> {
  const inserted = await tx
    .insert(notifications)
    .values({
      userId: input.userId,
      type: input.type,
      channel: CHANNEL_FOR_TYPE[input.type],
      dedupeKey: input.dedupeKey,
      payload: input.payload,
    })
    .onConflictDoNothing({ target: notifications.dedupeKey })
    .returning({ id: notifications.id });

  return { applied: inserted.length > 0 };
}
```

- [ ] **Step 5: Write `recipients.ts`**

```ts
import { and, eq } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { seasonMemberships, users } from '@/db/schema';

/**
 * One primary-key lookup, inside the caller's transaction.
 *
 * The money path pays for this, so it is worth naming what it costs: one indexed read on a
 * table the settle transaction has already touched — strictly less than the `emitFeedEvent`
 * INSERT running beside it.
 */
export async function userIdForMembership(tx: Tx, membershipId: string): Promise<string | null> {
  const [row] = await tx
    .select({ userId: seasonMemberships.userId })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, membershipId));
  return row?.userId ?? null;
}

/** Every admin who could actually rule on something — a disabled admin is not a recipient. */
export async function adminUserIds(tx: Tx): Promise<string[]> {
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'ADMIN'), eq(users.status, 'APPROVED')));
  return rows.map((r) => r.id);
}

export async function seasonMemberUserIds(
  tx: Tx,
  seasonId: string,
): Promise<{ membershipId: string; userId: string }[]> {
  return tx
    .select({ membershipId: seasonMemberships.id, userId: seasonMemberships.userId })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.seasonId, seasonId));
}
```

- [ ] **Step 6: Write `preferences.ts`**

```ts
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { notificationPreferences, type NotificationType } from '@/db/schema';

export interface NotificationPreferences {
  mutedTypes: NotificationType[];
  emailsEnabled: boolean;
}

const EVERYTHING_ON: NotificationPreferences = { mutedTypes: [], emailsEnabled: true };

/** No row means everything on, so the table stays empty until somebody changes something. */
export async function getNotificationPreferences(userId: string): Promise<NotificationPreferences> {
  const [row] = await db
    .select({
      mutedTypes: notificationPreferences.mutedTypes,
      emailsEnabled: notificationPreferences.emailsEnabled,
    })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId));

  return row ?? EVERYTHING_ON;
}

/** The same read for many users at once — the delivery pass needs one query, not N. */
export async function getManyNotificationPreferences(
  userIds: string[],
): Promise<Map<string, NotificationPreferences>> {
  const found = new Map<string, NotificationPreferences>();
  if (userIds.length === 0) return found;

  const rows = await db
    .select({
      userId: notificationPreferences.userId,
      mutedTypes: notificationPreferences.mutedTypes,
      emailsEnabled: notificationPreferences.emailsEnabled,
    })
    .from(notificationPreferences)
    .where(inArray(notificationPreferences.userId, userIds));

  for (const row of rows) {
    found.set(row.userId, { mutedTypes: row.mutedTypes, emailsEnabled: row.emailsEnabled });
  }
  // Everybody asked about gets an answer, so the caller never has to handle a missing key.
  for (const id of userIds) if (!found.has(id)) found.set(id, EVERYTHING_ON);
  return found;
}

export async function setNotificationPreferences(
  userId: string,
  next: NotificationPreferences,
): Promise<void> {
  // De-duplicated so the stored array is a set, which is what isSuppressed assumes.
  const mutedTypes = [...new Set(next.mutedTypes)];
  const values = { mutedTypes, emailsEnabled: next.emailsEnabled, updatedAt: new Date() };

  await db
    .insert(notificationPreferences)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: notificationPreferences.userId, set: values });
}

/** The per-type unsubscribe. Adds one type and leaves everything else alone. */
export async function muteType(userId: string, type: NotificationType): Promise<void> {
  const current = await getNotificationPreferences(userId);
  await setNotificationPreferences(userId, {
    ...current,
    mutedTypes: [...current.mutedTypes, type],
  });
}

/** The global unsubscribe. Does not touch mutedTypes, so turning email back on restores them. */
export async function disableAllEmail(userId: string): Promise<void> {
  const current = await getNotificationPreferences(userId);
  await setNotificationPreferences(userId, { ...current, emailsEnabled: false });
}

export function isSuppressed(prefs: NotificationPreferences, type: NotificationType): boolean {
  if (!prefs.emailsEnabled) return true;
  return prefs.mutedTypes.includes(type);
}
```

- [ ] **Step 7: Run and watch them pass**

```bash
npx vitest run src/server/notify
```

Expected: PASS — 5 enqueue tests, 9 preferences tests, plus Tasks 2–4's.

- [ ] **Step 8: Commit**

```bash
npm run format && npm run verify
git add src/server/notify
git commit -m "feat(notify): add the keyed enqueue, recipient lookups and preferences"
```

---

### Task 6 [CLOUD]: `deliver.ts` — the only sender

**DB.** Requires Postgres.

**Files:**

- Create: `src/server/notify/deliver.ts`
- Test: `src/server/notify/__tests__/deliver.test.ts`

**Interfaces:**

- Consumes: `sendEmail` (Task 4), `renderImmediate`/`renderDigest` (Task 3),
  `getManyNotificationPreferences`/`isSuppressed` (Task 5).
- Produces:
  - `DeliverSummary = { sent: number; suppressed: number; failed: number; errors: string[] }`
  - `deliverPending(options?: { channels?: NotificationChannel[]; now?: Date }): Promise<DeliverSummary>`
  - `flushSoon(): void` — wraps `deliverPending` in `after()`; never throws.
  - `pruneNotifications(olderThanDays?: number): Promise<number>`

- [ ] **Step 1: Write the failing test**

`src/server/notify/__tests__/deliver.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { notifications, users, type NotificationType } from '@/db/schema';
import { setNotificationPreferences } from '@/server/notify/preferences';
import { resetDb } from '@/test/db';

vi.mock('@/server/notify/transport', () => ({
  sendEmail: vi.fn().mockResolvedValue({ ok: true }),
  activeTransport: () => 'console',
}));

import { sendEmail } from '@/server/notify/transport';
import { deliverPending } from '@/server/notify/deliver';

const sends = vi.mocked(sendEmail);

async function aUser(email: string, status: 'APPROVED' | 'DISABLED' = 'APPROVED') {
  const [row] = await db
    .insert(users)
    .values({
      provider: 'GOOGLE',
      providerAccountId: email,
      email,
      displayName: email.split('@')[0],
      status,
    })
    .returning({ id: users.id });
  return row.id;
}

const DIGEST_TYPES: NotificationType[] = ['BETS_SETTLED', 'ALLOWANCE_PAID'];

async function queue(
  userId: string,
  type: NotificationType,
  dedupeKey: string,
  payload: Record<string, unknown> = {},
) {
  await db.insert(notifications).values({
    userId,
    type,
    channel: DIGEST_TYPES.includes(type) ? 'DIGEST' : 'IMMEDIATE',
    dedupeKey,
    payload,
  });
}

beforeEach(async () => {
  await resetDb();
  sends.mockClear();
  sends.mockResolvedValue({ ok: true });
  vi.stubEnv('AUTH_SECRET', 'test-secret');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://bets.example');
});

afterEach(() => vi.unstubAllEnvs());

describe('deliverPending', () => {
  it('sends one immediate per row and stamps it SENT', async () => {
    const userId = await aUser('a@example.com');
    await queue(userId, 'WAGER_OFFERED', 'k1', { fromName: 'Dana', subject: 'Chiefs -3.5' });

    const summary = await deliverPending();

    expect(summary.sent).toBe(1);
    expect(sends).toHaveBeenCalledTimes(1);
    expect(sends.mock.calls[0][0].to).toBe('a@example.com');

    const [row] = await db.select().from(notifications);
    expect(row.outcome).toBe('SENT');
    expect(row.sentAt).not.toBeNull();
  });

  it('collapses one user’s digest rows into a single email', async () => {
    const userId = await aUser('a@example.com');
    await queue(userId, 'BETS_SETTLED', 'b1', { outcome: 'WON', netCents: '1500', subject: 'A' });
    await queue(userId, 'BETS_SETTLED', 'b2', { outcome: 'LOST', netCents: '-500', subject: 'B' });
    await queue(userId, 'ALLOWANCE_PAID', 'a1', { amountCents: '50000' });

    const summary = await deliverPending();

    expect(sends).toHaveBeenCalledTimes(1);
    expect(summary.sent).toBe(3);
    const rows = await db.select().from(notifications);
    expect(rows.every((r) => r.outcome === 'SENT')).toBe(true);
  });

  it('keeps two users’ digests apart', async () => {
    const a = await aUser('a@example.com');
    const b = await aUser('b@example.com');
    await queue(a, 'BETS_SETTLED', 'b1', { outcome: 'WON', netCents: '1', subject: 'A' });
    await queue(b, 'BETS_SETTLED', 'b2', { outcome: 'WON', netCents: '1', subject: 'B' });

    await deliverPending();

    expect(sends).toHaveBeenCalledTimes(2);
    expect(sends.mock.calls.map((c) => c[0].to).sort()).toEqual(['a@example.com', 'b@example.com']);
  });

  it('suppresses a muted type without sending, and says so on the row', async () => {
    const userId = await aUser('a@example.com');
    await setNotificationPreferences(userId, {
      mutedTypes: ['BETS_SETTLED'],
      emailsEnabled: true,
    });
    await queue(userId, 'BETS_SETTLED', 'b1', { outcome: 'WON', netCents: '1', subject: 'A' });

    const summary = await deliverPending();

    expect(summary).toMatchObject({ sent: 0, suppressed: 1 });
    expect(sends).not.toHaveBeenCalled();
    const [row] = await db.select().from(notifications);
    expect(row.outcome).toBe('SUPPRESSED');
    expect(row.sentAt).not.toBeNull();
  });

  it('suppresses every type when email is off entirely', async () => {
    const userId = await aUser('a@example.com');
    await setNotificationPreferences(userId, { mutedTypes: [], emailsEnabled: false });
    await queue(userId, 'WAGER_OFFERED', 'k1');

    const summary = await deliverPending();

    expect(summary.suppressed).toBe(1);
    expect(sends).not.toHaveBeenCalled();
  });

  it('records a failure, leaves the row unsent, and reports it', async () => {
    const userId = await aUser('a@example.com');
    await queue(userId, 'WAGER_OFFERED', 'k1');
    sends.mockResolvedValue({ ok: false, error: 'Resend answered 422: bad from' });

    const summary = await deliverPending();

    expect(summary).toMatchObject({ sent: 0, failed: 1 });
    expect(summary.errors[0]).toContain('422');
    const [row] = await db.select().from(notifications);
    expect(row.sentAt).toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.error).toContain('422');
  });

  it('gives up after five attempts rather than retrying forever', async () => {
    const userId = await aUser('a@example.com');
    await queue(userId, 'WAGER_OFFERED', 'k1');
    sends.mockResolvedValue({ ok: false, error: 'nope' });

    for (let i = 0; i < 5; i++) await deliverPending();

    const [row] = await db.select().from(notifications);
    expect(row.attempts).toBe(5);
    expect(row.outcome).toBe('FAILED');
    expect(row.sentAt).not.toBeNull();

    sends.mockClear();
    await deliverPending();
    expect(sends).not.toHaveBeenCalled();
  });

  it('never sends the same row twice', async () => {
    const userId = await aUser('a@example.com');
    await queue(userId, 'WAGER_OFFERED', 'k1');

    await deliverPending();
    await deliverPending();

    expect(sends).toHaveBeenCalledTimes(1);
  });

  it('sends only the requested channel when one is named', async () => {
    const userId = await aUser('a@example.com');
    await queue(userId, 'WAGER_OFFERED', 'k1');
    await queue(userId, 'BETS_SETTLED', 'b1', { outcome: 'WON', netCents: '1', subject: 'A' });

    await deliverPending({ channels: ['IMMEDIATE'] });

    expect(sends).toHaveBeenCalledTimes(1);
    const rows = await db.select().from(notifications);
    expect(rows.find((r) => r.type === 'BETS_SETTLED')!.sentAt).toBeNull();
  });

  it('suppresses mail to a member who is no longer approved', async () => {
    const userId = await aUser('a@example.com');
    await db.update(users).set({ status: 'DISABLED' }).where(eq(users.id, userId));
    await queue(userId, 'WAGER_OFFERED', 'k1');

    const summary = await deliverPending();

    expect(summary.suppressed).toBe(1);
    expect(sends).not.toHaveBeenCalled();
  });

  it('still delivers ACCOUNT_APPROVED, which is exempt from the status check', async () => {
    const userId = await aUser('p@example.com', 'DISABLED');
    await queue(userId, 'ACCOUNT_APPROVED', `user:${userId}:approved`);

    const summary = await deliverPending();

    expect(summary.sent).toBe(1);
  });

  it('does nothing at all, and makes no query storm, when the queue is empty', async () => {
    const summary = await deliverPending();
    expect(summary).toEqual({ sent: 0, suppressed: 0, failed: 0, errors: [] });
    expect(sends).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/server/notify/__tests__/deliver.test.ts`
Expected: FAIL — cannot resolve `@/server/notify/deliver`.

- [ ] **Step 3: Implement**

`src/server/notify/deliver.ts`:

```ts
import { after } from 'next/server';
import { and, asc, eq, inArray, isNull, lt } from 'drizzle-orm';
import { db } from '@/db/client';
import { notifications, users, type NotificationChannel, type NotificationType } from '@/db/schema';
import { getManyNotificationPreferences, isSuppressed } from './preferences';
import { renderDigest, renderImmediate } from './render';
import { sendEmail } from './transport';
import type { NotificationRow, RenderedEmail } from './types';

const MAX_ATTEMPTS = 5;
const ALL_CHANNELS: NotificationChannel[] = ['IMMEDIATE', 'DIGEST'];

export interface DeliverSummary {
  sent: number;
  suppressed: number;
  failed: number;
  errors: string[];
}

interface PendingRow {
  id: string;
  userId: string;
  type: NotificationType;
  channel: NotificationChannel;
  payload: unknown;
  queuedAt: Date;
  attempts: number;
  email: string;
  status: string;
}

function baseUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
}

function toRow(row: PendingRow): NotificationRow {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    channel: row.channel,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    queuedAt: row.queuedAt,
  };
}

/**
 * The only thing in this system that sends mail.
 *
 * Preferences are read here rather than at enqueue (D65), so the settle transaction pays for no
 * preferences query and a member who mutes a type mid-run leaves no half-keyed hole behind them
 * — the row exists, is not sent, and says SUPPRESSED.
 */
export async function deliverPending(
  options: { channels?: NotificationChannel[]; now?: Date } = {},
): Promise<DeliverSummary> {
  const now = options.now ?? new Date();
  const channels = options.channels ?? ALL_CHANNELS;
  const summary: DeliverSummary = { sent: 0, suppressed: 0, failed: 0, errors: [] };

  const pending: PendingRow[] = await db
    .select({
      id: notifications.id,
      userId: notifications.userId,
      type: notifications.type,
      channel: notifications.channel,
      payload: notifications.payload,
      queuedAt: notifications.queuedAt,
      attempts: notifications.attempts,
      email: users.email,
      status: users.status,
    })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .where(and(isNull(notifications.sentAt), inArray(notifications.channel, channels)))
    .orderBy(asc(notifications.queuedAt));

  if (pending.length === 0) return summary;

  const prefs = await getManyNotificationPreferences([...new Set(pending.map((r) => r.userId))]);
  const sendable: PendingRow[] = [];

  for (const row of pending) {
    // ACCOUNT_APPROVED is exempt from the status check: it IS the transition into APPROVED, and
    // a later disable must not retroactively swallow the one email that said "you are in".
    const statusOk = row.status === 'APPROVED' || row.type === 'ACCOUNT_APPROVED';

    if (!statusOk || isSuppressed(prefs.get(row.userId)!, row.type)) {
      await stamp(row.id, { outcome: 'SUPPRESSED', sentAt: now });
      summary.suppressed += 1;
      continue;
    }
    sendable.push(row);
  }

  for (const row of sendable.filter((r) => r.channel === 'IMMEDIATE')) {
    await deliverGroup([row], renderImmediate(toRow(row), baseUrl()), row.email, now, summary);
  }

  // One email per recipient, across types (D66).
  const byUser = new Map<string, PendingRow[]>();
  for (const row of sendable.filter((r) => r.channel === 'DIGEST')) {
    const list = byUser.get(row.userId) ?? [];
    list.push(row);
    byUser.set(row.userId, list);
  }

  for (const rows of byUser.values()) {
    await deliverGroup(rows, renderDigest(rows.map(toRow), baseUrl()), rows[0].email, now, summary);
  }

  return summary;
}

async function deliverGroup(
  rows: PendingRow[],
  email: RenderedEmail,
  to: string,
  now: Date,
  summary: DeliverSummary,
): Promise<void> {
  const result = await sendEmail({ to, email });

  if (result.ok) {
    for (const row of rows) await stamp(row.id, { outcome: 'SENT', sentAt: now });
    summary.sent += rows.length;
    return;
  }

  summary.failed += rows.length;
  summary.errors.push(result.error);

  for (const row of rows) {
    const attempts = row.attempts + 1;
    // Five attempts and it stops. A permanently bad address must not be retried every day
    // forever; the alert `runJob` raises on the pass is what makes it visible instead.
    const exhausted = attempts >= MAX_ATTEMPTS;
    await stamp(row.id, {
      attempts,
      error: result.error,
      outcome: exhausted ? 'FAILED' : null,
      sentAt: exhausted ? now : null,
    });
  }
}

async function stamp(
  id: string,
  set: {
    outcome?: 'SENT' | 'SUPPRESSED' | 'FAILED' | null;
    sentAt?: Date | null;
    attempts?: number;
    error?: string | null;
  },
): Promise<void> {
  await db.update(notifications).set(set).where(eq(notifications.id, id));
}

/**
 * Flush immediates once the response is out (D64). `after` runs its callback after the response
 * is finished, so nothing sends inside a transaction and nothing sits in the request path.
 *
 * Swallows everything: a mail failure must never change what an action returns. Anything this
 * drops stays unsent and is picked up by the next cron pass, which is the whole reason the row
 * is the source of truth rather than the call.
 */
export function flushSoon(): void {
  try {
    after(async () => {
      try {
        await deliverPending({ channels: ['IMMEDIATE'] });
      } catch (err) {
        console.error('[notify] immediate flush failed; the cron pass will retry', err);
      }
    });
  } catch (err) {
    // `after` throws outside a request scope — a script, or a test calling the service directly.
    console.warn('[notify] flushSoon called outside a request scope', err);
  }
}

/** Retention. Rides the daily reconcile run, as `pruneJobRuns` does. */
export async function pruneNotifications(olderThanDays = 30): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
  const deleted = await db
    .delete(notifications)
    .where(lt(notifications.queuedAt, cutoff))
    .returning({ id: notifications.id });
  return deleted.length;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/server/notify/__tests__/deliver.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
npm run format && npm run verify
git add src/server/notify
git commit -m "feat(notify): deliver pending notifications, collapsing digests per recipient"
```

---

### Task 7 [CLOUD]: `ACCOUNT_APPROVED` — move the approval out of the page

**DB.** No money path — the hook does not fire here.

**Files:**

- Create: `src/server/admin/approve.ts`
- Modify: `src/app/admin/page.tsx` (the inline `setStatus` action, currently around line 29)
- Test: `src/server/admin/__tests__/approve.test.ts`

**Interfaces:**

- Consumes: `enqueueNotification` (Task 5), `flushSoon` (Task 6).
- Produces: `setUserStatus(userId: string, status: 'APPROVED' | 'DISABLED'): Promise<{ changed: boolean }>`

- [ ] **Step 1: Write the failing test**

`src/server/admin/__tests__/approve.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { notifications, users } from '@/db/schema';
import { resetDb } from '@/test/db';

vi.mock('@/server/notify/deliver', () => ({ flushSoon: vi.fn() }));

import { setUserStatus } from '@/server/admin/approve';

async function aPendingUser(email = 'p@example.com') {
  const [row] = await db
    .insert(users)
    .values({ provider: 'GOOGLE', providerAccountId: email, email, displayName: 'P' })
    .returning({ id: users.id });
  return row.id;
}

beforeEach(resetDb);

describe('setUserStatus', () => {
  it('approves a pending user and queues exactly one notification', async () => {
    const userId = await aPendingUser();

    const result = await setUserStatus(userId, 'APPROVED');

    expect(result.changed).toBe(true);
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user.status).toBe('APPROVED');

    const rows = await db.select().from(notifications);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('ACCOUNT_APPROVED');
    expect(rows[0].dedupeKey).toBe(`user:${userId}:approved`);
  });

  it('is idempotent on a double-click', async () => {
    const userId = await aPendingUser();

    await setUserStatus(userId, 'APPROVED');
    const second = await setUserStatus(userId, 'APPROVED');

    expect(second.changed).toBe(false);
    expect(await db.select().from(notifications)).toHaveLength(1);
  });

  it('does not re-notify after a disable and re-approve — it is not news twice', async () => {
    const userId = await aPendingUser();

    await setUserStatus(userId, 'APPROVED');
    await setUserStatus(userId, 'DISABLED');
    await setUserStatus(userId, 'APPROVED');

    expect(await db.select().from(notifications)).toHaveLength(1);
  });

  it('queues nothing when denying', async () => {
    const userId = await aPendingUser();

    await setUserStatus(userId, 'DISABLED');

    expect(await db.select().from(notifications)).toHaveLength(0);
  });

  it('reports no change for a user id that does not exist', async () => {
    const result = await setUserStatus('11111111-1111-1111-1111-111111111111', 'APPROVED');
    expect(result.changed).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/server/admin/__tests__/approve.test.ts`
Expected: FAIL — cannot resolve `@/server/admin/approve`.

- [ ] **Step 3: Implement**

`src/server/admin/approve.ts`:

```ts
import { and, eq, ne } from 'drizzle-orm';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { flushSoon } from '@/server/notify/deliver';
import { enqueueNotification } from '@/server/notify/enqueue';

/**
 * The approval write, moved out of `src/app/admin/page.tsx` because it now enqueues inside a
 * transaction — an action that does that does not belong in a page component, and cannot be
 * tested there.
 *
 * `ne(status, target)` in the WHERE plus `returning()` makes a double-click a no-op at the
 * database rather than at the UI. The unique dedupe key would catch it anyway; this keeps the
 * "changed" answer honest, which is what the caller revalidates on.
 */
export async function setUserStatus(
  userId: string,
  status: 'APPROVED' | 'DISABLED',
): Promise<{ changed: boolean }> {
  const changed = await db.transaction(async (tx) => {
    const updated = await tx
      .update(users)
      .set({ status })
      .where(and(eq(users.id, userId), ne(users.status, status)))
      .returning({ id: users.id, displayName: users.displayName });

    if (updated.length === 0) return false;
    if (status !== 'APPROVED') return true;

    // Unversioned on purpose (D63): approve, disable, approve again sends one email ever. Being
    // let in is not news the second time.
    await enqueueNotification(tx, {
      userId,
      type: 'ACCOUNT_APPROVED',
      dedupeKey: `user:${userId}:approved`,
      payload: { displayName: updated[0].displayName },
    });

    return true;
  });

  // Outside the transaction: a send must never be able to roll the approval back.
  if (changed && status === 'APPROVED') flushSoon();
  return { changed };
}
```

- [ ] **Step 4: Rewire the page**

In `src/app/admin/page.tsx`, add the import:

```ts
import { setUserStatus } from '@/server/admin/approve';
```

and replace the body of the inline `setStatus` action so it delegates:

```ts
async function setStatus(formData: FormData) {
  'use server';
  await requireAdmin();

  const userId = String(formData.get('userId'));
  const status = String(formData.get('status'));
  if (status !== 'APPROVED' && status !== 'DISABLED') return;

  await setUserStatus(userId, status);
  revalidatePath('/admin');
}
```

The page still reads the pending list directly, so its `db` and `users` imports stay. If `eq` is
now unused, remove it — lint will tell you.

- [ ] **Step 5: Run and watch it pass**

```bash
npx vitest run src/server/admin src/app/__tests__
```

Expected: PASS, 5 new tests plus the existing admin and structural ones.

- [ ] **Step 6: Commit**

```bash
npm run format && npm run verify
git add src/server/admin src/app/admin/page.tsx
git commit -m "feat(notify): notify a member when an admin approves their account"
```

---

### Task 8 [CLOUD]: The peer-to-peer emit points

**DB.** **⚠️ The money-touch hook fires on all three files. Run `/money-invariants` before
committing.** Nothing here calls `postEntry` or touches a balance — the review is to confirm
exactly that.

**Files:**

- Modify: `src/server/p2p/offer.ts` (beside the `P2P_OFFERED` emit, currently line 161)
- Modify: `src/server/p2p/claim.ts` (beside the `P2P_DISPUTED` emit, currently line 104)
- Modify: `src/server/p2p/sweep.ts` (inside `overduePass`'s existing transaction)
- Test: `src/server/p2p/__tests__/notify-p2p.test.ts`

**Interfaces:**

- Consumes: `enqueueNotification` (Task 5), `userIdForMembership`/`adminUserIds` (Task 5),
  `flushSoon` (Task 6).
- Produces: no new exports. Behavioural change only.

> **Fixtures:** this repo already has `src/test/factories.ts` with `makeUser`, `makeSeason`,
> `makeCreditedMembership(creditsCents?, seasonId?)` → `{ membership, user, seasonId }`, and
> `makeWager({ seasonId, offererMembershipId, opponentMembershipId?, expiresAt?, … })`. Use them.
> Read `src/server/p2p/__tests__/claim.test.ts` first for how the existing tests drive
> `acceptOffer` and `claimResult` — do not fabricate wager state by writing rows directly, or the
> test proves nothing about the emit point.

- [ ] **Step 1: Write the failing test**

`src/server/p2p/__tests__/notify-p2p.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { notifications } from '@/db/schema';
import { makeCreditedMembership, makeUser } from '@/test/factories';
import { resetDb } from '@/test/db';
import { offerWager } from '@/server/p2p/offer';

vi.mock('@/server/notify/deliver', () => ({ flushSoon: vi.fn() }));

beforeEach(resetDb);

describe('WAGER_OFFERED', () => {
  it('queues one notification for a directed offer, addressed to the opponent', async () => {
    const offerer = await makeCreditedMembership();
    const opponent = await makeCreditedMembership(100_000n, offerer.seasonId);

    const result = await offerWager({
      userId: offerer.user.id,
      kind: 'FREEFORM',
      description: 'Dana takes the over',
      opponentMembershipId: opponent.membership.id,
      offererStakeCents: 10_000n,
      acceptorStakeCents: 10_000n,
      expiresAt: new Date(Date.now() + 86_400_000),
      resolvesBy: new Date(Date.now() + 7 * 86_400_000),
    });
    if (!result.ok) throw new Error(`offer failed: ${result.error.code}`);

    const rows = await db.select().from(notifications);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('WAGER_OFFERED');
    expect(rows[0].userId).toBe(opponent.user.id);
    expect(rows[0].dedupeKey).toBe(`p2p:${result.wagerId}:offered:${opponent.user.id}`);
  });

  it('queues nothing for an open offer — mailing the season is the noise that gets it muted', async () => {
    const offerer = await makeCreditedMembership();

    const result = await offerWager({
      userId: offerer.user.id,
      kind: 'FREEFORM',
      description: 'anyone want this',
      opponentMembershipId: null,
      offererStakeCents: 10_000n,
      acceptorStakeCents: 10_000n,
      expiresAt: new Date(Date.now() + 86_400_000),
      resolvesBy: new Date(Date.now() + 7 * 86_400_000),
    });
    if (!result.ok) throw new Error(`offer failed: ${result.error.code}`);

    expect(await db.select().from(notifications)).toHaveLength(0);
  });
});

describe('DISPUTE_NEEDS_RULING from a contested claim', () => {
  it('queues one row per admin, keyed on the attempt', async () => {
    const offerer = await makeCreditedMembership();
    const opponent = await makeCreditedMembership(100_000n, offerer.seasonId);
    const adminA = await makeUser({ role: 'ADMIN', status: 'APPROVED' });
    const adminB = await makeUser({ role: 'ADMIN', status: 'APPROVED' });

    // Drive the real services, exactly as claim.test.ts does: offer, accept, then have both
    // sides claim opposite verdicts.
    const wagerId = await offerAcceptAndDisagree(offerer, opponent);

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.type, 'DISPUTE_NEEDS_RULING'));

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.userId).sort()).toEqual([adminA.id, adminB.id].sort());
    expect(rows[0].dedupeKey).toContain(`p2p:${wagerId}:disputed:1:`);
  });

  it('excludes a disabled admin, who cannot rule on anything', async () => {
    const offerer = await makeCreditedMembership();
    const opponent = await makeCreditedMembership(100_000n, offerer.seasonId);
    await makeUser({ role: 'ADMIN', status: 'APPROVED' });
    await makeUser({ role: 'ADMIN', status: 'DISABLED' });

    await offerAcceptAndDisagree(offerer, opponent);

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.type, 'DISPUTE_NEEDS_RULING'));
    expect(rows).toHaveLength(1);
  });
});
```

> Write `offerAcceptAndDisagree` in the same file, calling the real `offerWager`, `acceptOffer`
> and `claimResult` and returning the wager id. Copy the argument shapes from
> `src/server/p2p/__tests__/claim.test.ts` rather than guessing them.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/server/p2p/__tests__/notify-p2p.test.ts`
Expected: FAIL — no `notifications` rows are written.

- [ ] **Step 3: `offer.ts` — enqueue beside the emit**

Add the imports:

```ts
import { flushSoon } from '@/server/notify/deliver';
import { enqueueNotification } from '@/server/notify/enqueue';
import { userIdForMembership } from '@/server/notify/recipients';
```

and, immediately after the existing `await emitFeedEvent(tx, { … type: 'P2P_OFFERED' … })`:

```ts
// Directed offers only. `P2P_OFFERED` fires for open offers too, but the notification is
// "a wager was offered to YOU" — mailing the whole season every time somebody posts an
// open offer is the noise that gets the feature muted wholesale.
if (opponentId !== null) {
  const opponentUserId = await userIdForMembership(tx, opponentId);
  if (opponentUserId) {
    await enqueueNotification(tx, {
      userId: opponentUserId,
      type: 'WAGER_OFFERED',
      // The feed event's own key with the recipient appended (D63).
      dedupeKey: `p2p:${wager.id}:offered:${opponentUserId}`,
      payload: {
        wagerId: wager.id,
        fromName: member.displayName,
        subject,
        stakeCents: input.offererStakeCents.toString(),
        expiresAt: input.expiresAt.toISOString(),
      },
    });
  }
}
```

Then flush **outside** the transaction. The function currently returns from inside
`db.transaction`; hoist the result:

```ts
const result = await db.transaction(async (tx) => {
  /* … unchanged body, still ending in `return { ok: true as const, … }` … */
});

// Outside the transaction: a send must never be able to roll an escrow write back.
if (result.ok) flushSoon();
return result;
```

> `member.displayName` must be in scope. If the loaded `member` does not carry it, add it to the
> `select` that already loads the membership rather than issuing a second query.

- [ ] **Step 4: `claim.ts` — enqueue for every admin**

Add the same three imports (with `adminUserIds` instead of `userIdForMembership`), and after the
existing `await emitFeedEvent(tx, { … type: 'P2P_DISPUTED' … })`:

```ts
// Every admin, because any of them can rule and none of them knows they are needed.
// Keyed on the attempt, so a dispute after an admin correction announces itself again
// rather than being swallowed — the same reason the feed key is.
for (const adminUserId of await adminUserIds(tx)) {
  await enqueueNotification(tx, {
    userId: adminUserId,
    type: 'DISPUTE_NEEDS_RULING',
    dedupeKey: `p2p:${wager.id}:disputed:${wager.settlementAttempts + 1}:${adminUserId}`,
    payload: { wagerId: wager.id, subject, kind: 'P2P' },
  });
}
```

and `flushSoon()` after the transaction returns, on the `DISPUTED` branch only.

- [ ] **Step 5: `sweep.ts` `overduePass` — widen the existing transaction**

It currently reads `const emitted = await db.transaction((tx) => emitFeedEvent(tx, {…}));`.
Make it a block:

```ts
const emitted = await db.transaction(async (tx) => {
  const result = await emitFeedEvent(tx, {
    seasonId: wager.seasonId,
    type: 'P2P_DISPUTED',
    subjectMembershipId: wager.offererMembershipId,
    dedupeKey: `p2p:${wager.id}:overdue:${wager.settlementAttempts + 1}`,
    payload,
    occurredAt: now,
  });

  // An overdue wager is a dispute nobody filed. The admin queue treats the two
  // identically, so the notification does too.
  for (const adminUserId of await adminUserIds(tx)) {
    await enqueueNotification(tx, {
      userId: adminUserId,
      type: 'DISPUTE_NEEDS_RULING',
      dedupeKey: `p2p:${wager.id}:overdue:${wager.settlementAttempts + 1}:${adminUserId}`,
      payload: { wagerId: wager.id, subject, kind: 'P2P_OVERDUE' },
    });
  }

  return result;
});
```

No `flushSoon()` here — this runs from a cron, not a request, so the cron pass sends it.

- [ ] **Step 6: Run the new test and the whole p2p suite**

```bash
npx vitest run src/server/p2p
```

Expected: PASS, including every pre-existing p2p test. If an existing test now fails you have
changed behaviour rather than added to it — fix that before continuing.

- [ ] **Step 7: Money review, then commit**

```bash
npm run format && npm run verify
```

Run `/money-invariants`. Confirm and record in the commit body: no `postEntry` added; no balance
or escrow path touched; the new keys derive from wager id, `settlementAttempts` and the recipient,
so they are deterministic and cannot collide with the payout they follow.

```bash
git add src/server/p2p
git commit -m "feat(notify): notify from the peer-to-peer offer and dispute emit points"
```

---

### Task 9 [CLOUD]: The expiring-offer sweep — an event with no feed emit point

**DB.** **⚠️ Money-touch hook fires. Run `/money-invariants` before committing.**

**Files:**

- Modify: `src/server/p2p/sweep.ts` — a fourth pass, plus the summary type
- Modify: `src/app/api/cron/settle/route.ts` — surface the counter
- Test: `src/server/p2p/__tests__/notify-expiring.test.ts`

**Interfaces:**

- Produces: `SweepP2PSummary` gains `expiringFlagged: number`.

- [ ] **Step 1: Write the failing test**

`src/server/p2p/__tests__/notify-expiring.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { notifications } from '@/db/schema';
import { sweepP2PWagers } from '@/server/p2p/sweep';
import { makeCreditedMembership, makeWager } from '@/test/factories';
import { resetDb } from '@/test/db';

const HOURS = 3_600_000;
const NOW = new Date('2026-09-03T12:00:00Z');

async function twoMembers() {
  const offerer = await makeCreditedMembership();
  const opponent = await makeCreditedMembership(100_000n, offerer.seasonId);
  return { offerer, opponent };
}

async function expiringRows() {
  return db.select().from(notifications).where(eq(notifications.type, 'OFFER_EXPIRING'));
}

beforeEach(resetDb);

describe('the expiring pass', () => {
  it('warns both parties on a directed offer inside the window', async () => {
    const { offerer, opponent } = await twoMembers();
    const wager = await makeWager({
      seasonId: offerer.seasonId,
      offererMembershipId: offerer.membership.id,
      opponentMembershipId: opponent.membership.id,
      expiresAt: new Date(NOW.getTime() + 6 * HOURS),
      resolvesBy: new Date(NOW.getTime() + 7 * 24 * HOURS),
    });

    const summary = await sweepP2PWagers(NOW);

    expect(summary.expiringFlagged).toBe(2);
    const rows = await expiringRows();
    expect(rows.map((r) => r.userId).sort()).toEqual([offerer.user.id, opponent.user.id].sort());
    expect(rows.map((r) => r.dedupeKey).sort()).toEqual(
      [
        `p2p:${wager.id}:expiring:${offerer.user.id}`,
        `p2p:${wager.id}:expiring:${opponent.user.id}`,
      ].sort(),
    );
  });

  it('warns only the offerer on an open offer — there is no opponent to warn', async () => {
    const { offerer } = await twoMembers();
    await makeWager({
      seasonId: offerer.seasonId,
      offererMembershipId: offerer.membership.id,
      expiresAt: new Date(NOW.getTime() + 6 * HOURS),
      resolvesBy: new Date(NOW.getTime() + 7 * 24 * HOURS),
    });

    await sweepP2PWagers(NOW);

    const rows = await expiringRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(offerer.user.id);
  });

  it('says nothing about an offer more than a day out', async () => {
    const { offerer, opponent } = await twoMembers();
    await makeWager({
      seasonId: offerer.seasonId,
      offererMembershipId: offerer.membership.id,
      opponentMembershipId: opponent.membership.id,
      expiresAt: new Date(NOW.getTime() + 48 * HOURS),
      resolvesBy: new Date(NOW.getTime() + 7 * 24 * HOURS),
    });

    await sweepP2PWagers(NOW);

    expect(await expiringRows()).toHaveLength(0);
  });

  it('warns once, not once per sweep', async () => {
    const { offerer, opponent } = await twoMembers();
    await makeWager({
      seasonId: offerer.seasonId,
      offererMembershipId: offerer.membership.id,
      opponentMembershipId: opponent.membership.id,
      expiresAt: new Date(NOW.getTime() + 6 * HOURS),
      resolvesBy: new Date(NOW.getTime() + 7 * 24 * HOURS),
    });

    await sweepP2PWagers(NOW);
    const second = await sweepP2PWagers(new Date(NOW.getTime() + 10 * 60_000));

    expect(second.expiringFlagged).toBe(0);
    expect(await expiringRows()).toHaveLength(2);
  });

  it('says nothing about an offer that has already lapsed', async () => {
    const { offerer, opponent } = await twoMembers();
    await makeWager({
      seasonId: offerer.seasonId,
      offererMembershipId: offerer.membership.id,
      opponentMembershipId: opponent.membership.id,
      expiresAt: new Date(NOW.getTime() - 1 * HOURS),
      resolvesBy: new Date(NOW.getTime() + 7 * 24 * HOURS),
    });

    await sweepP2PWagers(NOW);

    // expirePass ran first and closed it, so it is no longer OFFERED and cannot be warned about.
    expect(await expiringRows()).toHaveLength(0);
  });

  it('says nothing about an offer somebody already accepted', async () => {
    const { offerer, opponent } = await twoMembers();
    await makeWager({
      seasonId: offerer.seasonId,
      offererMembershipId: offerer.membership.id,
      acceptorMembershipId: opponent.membership.id,
      status: 'ACCEPTED',
      expiresAt: new Date(NOW.getTime() + 6 * HOURS),
      resolvesBy: new Date(NOW.getTime() + 7 * 24 * HOURS),
    });

    await sweepP2PWagers(NOW);

    expect(await expiringRows()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/server/p2p/__tests__/notify-expiring.test.ts`
Expected: FAIL — `expiringFlagged` is not on the summary.

- [ ] **Step 3: Extend the summary and add the pass**

In `src/server/p2p/sweep.ts`:

```ts
export interface SweepP2PSummary {
  expired: number;
  settled: number;
  overdueFlagged: number;
  expiringFlagged: number;
  errors: { wagerId: string; message: string }[];
}

export async function sweepP2PWagers(now: Date = new Date()): Promise<SweepP2PSummary> {
  const summary: SweepP2PSummary = {
    expired: 0,
    settled: 0,
    overdueFlagged: 0,
    expiringFlagged: 0,
    errors: [],
  };

  await expirePass(now, summary);
  await settlePass(now, summary);
  await overduePass(now, summary);
  await expiringPass(now, summary);

  return summary;
}
```

Order matters: `expiringPass` runs **after** `expirePass`, so an offer that has just lapsed and
been refunded is already out of `OFFERED` and cannot be warned about.

At the end of the file:

```ts
const EXPIRING_WINDOW_MS = 24 * 3_600_000;

/**
 * Pass 4: offers about to lapse.
 *
 * One of the two notifications with no feed event to ride (D63). `expirePass` writes no card on
 * purpose — an ignored offer is a non-event to the season — but it is very much an event to the
 * two people involved, which is the reason this phase exists at all.
 *
 * Both parties are warned. Read literally it is the offerer's offer and the offerer's escrowed
 * credits about to come back; but the person who can PREVENT the expiry is the opponent.
 *
 * There is no fixed lead time to rely on: an offer written with a two-hour window is inside this
 * query the moment it is created, and gets its warning on the first sweep rather than a day
 * ahead. The dedupe key makes that happen once, not once per sweep.
 */
async function expiringPass(now: Date, summary: SweepP2PSummary): Promise<void> {
  const soon = new Date(now.getTime() + EXPIRING_WINDOW_MS);

  const closing = await db
    .select()
    .from(p2pWagers)
    .where(
      and(
        eq(p2pWagers.status, 'OFFERED'),
        gt(p2pWagers.expiresAt, now),
        lte(p2pWagers.expiresAt, soon),
      ),
    );

  for (const wager of closing) {
    try {
      const subject =
        wager.kind === 'FREEFORM'
          ? (wager.description ?? '')
          : ((await loadSelectionSubject(wager.selectionId!))?.subject ?? '');

      await db.transaction(async (tx) => {
        const memberships = [wager.offererMembershipId, wager.opponentMembershipId].filter(
          (id): id is string => id !== null,
        );

        for (const membershipId of memberships) {
          const userId = await userIdForMembership(tx, membershipId);
          if (!userId) continue;

          const { applied } = await enqueueNotification(tx, {
            userId,
            type: 'OFFER_EXPIRING',
            dedupeKey: `p2p:${wager.id}:expiring:${userId}`,
            payload: {
              wagerId: wager.id,
              subject,
              expiresAt: wager.expiresAt.toISOString(),
            },
          });
          if (applied) summary.expiringFlagged += 1;
        }
      });
    } catch (err) {
      summary.errors.push({ wagerId: wager.id, message: (err as Error).message });
    }
  }
}
```

Extend the `drizzle-orm` import at the top of the file:

```ts
import { and, eq, gt, lt, lte } from 'drizzle-orm';
```

- [ ] **Step 4: Surface the counter on the settle route**

In `src/app/api/cron/settle/route.ts`, beside the other wager counts in the returned object:

```ts
    wagersExpiring: wagers.expiringFlagged,
```

- [ ] **Step 5: Run and watch it pass**

```bash
npx vitest run src/server/p2p src/server/cron src/app
```

Expected: PASS. Any pre-existing assertion on the exact shape of `SweepP2PSummary` needs the new
key added — that is a real change to a public type, not a test to loosen.

- [ ] **Step 6: Money review, then commit**

Run `/money-invariants`. This pass reads `p2pWagers` in the same file that refunds escrow, so
confirm explicitly that it moves no money, takes no `FOR UPDATE` lock, and changes no status.

```bash
npm run format && npm run verify
git add src/server/p2p src/app/api/cron/settle/route.ts
git commit -m "feat(notify): warn both parties before a peer-to-peer offer lapses"
```

---

### Task 10 [CLOUD]: Settlement, allowance and custom-event disputes

**DB.** **⚠️ The money-touch hook fires on `grade-legs.ts` and `resettle.ts`. Run
`/money-invariants` before committing.** These two files sit directly in the settlement path and
are the most important review in this plan.

**Files:**

- Create: `src/server/feed/describe-leg.ts`
- Modify: `src/server/bets/grade-legs.ts` (beside the `BET_SETTLED` emit, currently line 128)
- Modify: `src/server/bets/resettle.ts` (beside the `BET_SETTLED` emit, currently line 310)
- Modify: `src/server/seasons/allowance.ts` (after the season-wide emit)
- Modify: `src/server/events/dispute.ts` (beside the `CUSTOM_EVENT_DISPUTED` emit, line 91)
- Test: `src/server/bets/__tests__/notify-settlement.test.ts`
- Test: `src/server/seasons/__tests__/notify-allowance.test.ts`

**Interfaces:**

- Consumes: Task 5's exports.
- Produces: `describeLeg(leg: FeedLegSnapshot): string` from `@/server/feed/describe-leg`.

- [ ] **Step 1: Write `describe-leg.ts` first — both settlement files need it**

`src/server/feed/describe-leg.ts`:

```ts
import type { FeedLegSnapshot } from './payload';

/**
 * One line naming what a leg was, for an email subject or body. Lifted out of the two
 * settlement paths rather than copied into both — two copies of a formatting rule is how they
 * drift, and a correction email that describes a bet differently from the original is a bug
 * somebody will report as "it emailed me about the wrong bet".
 *
 * The feed card renders its own richer version from the same snapshot; this is the plain-text
 * one, because an email body has no components.
 */
export function describeLeg(leg: FeedLegSnapshot): string {
  if (leg.kind === 'GAME') {
    const line = leg.line ? ` ${leg.line}` : '';
    return `${leg.awayAbbr} @ ${leg.homeAbbr} — ${leg.marketType} ${leg.side}${line}`;
  }
  return `${leg.eventTitle} — ${leg.outcomeLabel}`;
}

/** What a whole bet is called in an email: the leg, or the leg count. */
export function describeBet(legs: FeedLegSnapshot[]): string {
  if (legs.length === 0) return 'a bet';
  return legs.length === 1 ? describeLeg(legs[0]) : `${legs.length}-leg parlay`;
}
```

- [ ] **Step 2: Write the failing settlement test**

`src/server/bets/__tests__/notify-settlement.test.ts`. Read
`src/server/bets/__tests__/settle.test.ts` first and copy its `place`/`single`/`finalize` helpers
and its `seedBettableGame` usage verbatim — this test is about the notification, not about
inventing a second way to settle a bet.

```ts
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { games, notifications } from '@/db/schema';
import { placeBet } from '@/server/bets/place';
import { settleGame } from '@/server/bets/settle';
import { resetDb } from '@/test/db';
import { makeMembership, seedBettableGame, type BettableGame } from './helpers';

// Copy the exact shapes settle.test.ts uses — see its `place`, `single` and `finalize` helpers.

beforeEach(resetDb);

describe('BETS_SETTLED', () => {
  it('queues one digest row per settled bet, addressed to its owner', async () => {
    const membership = await makeMembership();
    const game: BettableGame = await seedBettableGame();
    const betId = await place(single(membership.userId, game.spreadHomeSelectionId, '-3.5'));

    await finalize(game.gameId, 30, 20);
    await settleGame(game.gameId);

    const rows = await db.select().from(notifications);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('BETS_SETTLED');
    expect(rows[0].channel).toBe('DIGEST');
    expect(rows[0].userId).toBe(membership.userId);
    expect(rows[0].dedupeKey).toBe(`bet:${betId}:settled:1:${membership.userId}`);
  });

  it('queues nothing extra on a second settle run — this is the whole point', async () => {
    const membership = await makeMembership();
    const game = await seedBettableGame();
    await place(single(membership.userId, game.spreadHomeSelectionId, '-3.5'));

    await finalize(game.gameId, 30, 20);
    await settleGame(game.gameId);
    await settleGame(game.gameId);

    expect(await db.select().from(notifications)).toHaveLength(1);
  });

  it('queues a SECOND row after an admin correction, because the attempt changed', async () => {
    const membership = await makeMembership();
    const game = await seedBettableGame();
    const betId = await place(single(membership.userId, game.spreadHomeSelectionId, '-3.5'));

    await finalize(game.gameId, 30, 20);
    await settleGame(game.gameId);

    // Correct the score and re-settle, the way resettle.test.ts does.
    await db.update(games).set({ homeScore: 10, awayScore: 40 }).where(eq(games.id, game.gameId));
    await resettleGame(game.gameId, 'scores were wrong');

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.type, 'BETS_SETTLED'));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.dedupeKey).sort()).toEqual(
      [
        `bet:${betId}:settled:1:${membership.userId}`,
        `bet:${betId}:settled:2:${membership.userId}`,
      ].sort(),
    );
  });
});
```

> Import `resettleGame` (or whatever `src/server/bets/resettle.ts` actually exports — check its
> signature) and match the argument shape `resettle.test.ts` already uses.

- [ ] **Step 3: Write the failing allowance test**

`src/server/seasons/__tests__/notify-allowance.test.ts`. Read
`src/server/seasons/__tests__/allowance.test.ts` first and reuse its season/membership setup.

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { notifications, seasonMemberships } from '@/db/schema';
import { payWeeklyAllowance } from '@/server/seasons/allowance';
import { makeSeason, makeUser } from '@/test/factories';
import { resetDb } from '@/test/db';

async function seedSeasonWith(members: number) {
  const season = await makeSeason({ status: 'ACTIVE', weeklyAllowanceCents: 50_000n });
  const userIds: string[] = [];
  for (let i = 0; i < members; i++) {
    const user = await makeUser({ providerAccountId: `m${i}`, email: `m${i}@example.com` });
    await db
      .insert(seasonMemberships)
      .values({ userId: user.id, seasonId: season.id, balanceCents: 0n });
    userIds.push(user.id);
  }
  return { seasonId: season.id, userIds };
}

beforeEach(resetDb);

describe('ALLOWANCE_PAID', () => {
  it('fans one season-wide card out to a row per member', async () => {
    const { seasonId, userIds } = await seedSeasonWith(3);

    await payWeeklyAllowance(new Date('2026-09-03T12:00:00Z'));

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.type, 'ALLOWANCE_PAID'));

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.userId).sort()).toEqual([...userIds].sort());
    expect(rows.every((r) => r.channel === 'DIGEST')).toBe(true);
    expect(rows[0].dedupeKey).toContain(`allowance:${seasonId}:`);
  });

  it('queues nothing extra on a second run in the same week', async () => {
    await seedSeasonWith(3);
    const now = new Date('2026-09-03T12:00:00Z');

    await payWeeklyAllowance(now);
    await payWeeklyAllowance(now);

    expect(await db.select().from(notifications)).toHaveLength(3);
  });

  it('queues a fresh set the following week', async () => {
    await seedSeasonWith(2);

    await payWeeklyAllowance(new Date('2026-09-03T12:00:00Z'));
    await payWeeklyAllowance(new Date('2026-09-10T12:00:00Z'));

    expect(await db.select().from(notifications)).toHaveLength(4);
  });
});
```

- [ ] **Step 4: Run both and watch them fail**

```bash
npx vitest run src/server/bets/__tests__/notify-settlement.test.ts src/server/seasons/__tests__/notify-allowance.test.ts
```

Expected: FAIL — no notification rows.

- [ ] **Step 5: `grade-legs.ts` — enqueue beside the `BET_SETTLED` emit**

Add the imports:

```ts
import { describeBet } from '@/server/feed/describe-leg';
import { enqueueNotification } from '@/server/notify/enqueue';
import { userIdForMembership } from '@/server/notify/recipients';
```

and, immediately after the existing `await emitFeedEvent(tx, { … type: 'BET_SETTLED' … })`:

```ts
// The bet's owner, in the digest. `attempts` is in the key exactly as it is in the feed key
// and the ledger key beside it, so a re-run sends nothing and an admin correction sends a
// second, correct email rather than being swallowed (D63).
const settledUserId = await userIdForMembership(tx, bet.membershipId);
if (settledUserId) {
  await enqueueNotification(tx, {
    userId: settledUserId,
    type: 'BETS_SETTLED',
    dedupeKey: `bet:${bet.id}:settled:${attempts}:${settledUserId}`,
    payload: {
      betId: bet.id,
      outcome,
      netCents: (payout - bet.stakeCents).toString(),
      subject: describeBet(snapshots),
      correction: attempts > 1,
    },
  });
}
```

- [ ] **Step 6: `resettle.ts` — the same, using its own `attempt` variable**

The correction path uses `attempt` (singular) in its feed key. Match it exactly, or the
correction email collides with the original:

```ts
const settledUserId = await userIdForMembership(tx, bet.membershipId);
if (settledUserId) {
  await enqueueNotification(tx, {
    userId: settledUserId,
    type: 'BETS_SETTLED',
    dedupeKey: `bet:${bet.id}:settled:${attempt}:${settledUserId}`,
    payload: {
      betId: bet.id,
      outcome,
      netCents: (payout - bet.stakeCents).toString(),
      subject: describeBet(snapshots),
      correction: true,
    },
  });
}
```

with the same three imports.

- [ ] **Step 7: `allowance.ts` — fan out per member**

After the existing season-wide `emitFeedEvent` transaction:

```ts
// The feed gets one card for the whole run (D26); the mail gets one row per person, because
// an email is addressed and a feed card is broadcast. Same fact, different fan-out (D63).
//
// A separate transaction from the per-member postEntry loop above, on purpose: those money
// writes are already committed member by member, and a notification failure must not be able
// to roll any of them back.
await db.transaction(async (tx) => {
  for (const { userId } of await seasonMemberUserIds(tx, season.id)) {
    await enqueueNotification(tx, {
      userId,
      type: 'ALLOWANCE_PAID',
      dedupeKey: `allowance:${season.id}:${weekKey}:${userId}`,
      payload: {
        weekKey,
        amountCents: season.weeklyAllowanceCents.toString(),
        creditAmountCents: season.weeklyCreditAllowanceCents.toString(),
      },
    });
  }
});
```

with:

```ts
import { enqueueNotification } from '@/server/notify/enqueue';
import { seasonMemberUserIds } from '@/server/notify/recipients';
```

- [ ] **Step 8: `dispute.ts` — notify the admins**

After the existing `CUSTOM_EVENT_DISPUTED` emit:

```ts
for (const adminUserId of await adminUserIds(tx)) {
  await enqueueNotification(tx, {
    userId: adminUserId,
    type: 'DISPUTE_NEEDS_RULING',
    // Per disputing member, matching the feed key: a second member disputing the same event
    // is a genuinely new fact and worth a second email.
    dedupeKey: `customevent:${input.eventId}:disputed:${input.membershipId}:${adminUserId}`,
    payload: { eventId: input.eventId, subject: event.title, kind: 'CUSTOM_EVENT' },
  });
}
```

and `flushSoon()` after the transaction, since this one runs from a user action. Hoist the result
out of `db.transaction` the same way Task 8 step 3 does for `offer.ts`.

- [ ] **Step 9: Run everything in the affected trees**

```bash
npx vitest run src/server/bets src/server/seasons src/server/events src/server/feed
```

Expected: PASS, including every pre-existing test in those directories.

- [ ] **Step 10: Money review, then commit**

Run `/money-invariants`. This is the run that matters most in the plan. Confirm and record in the
commit body:

- **Invariant 1** — no `postEntry` added anywhere in the diff; nothing updates or deletes a
  ledger entry.
- **Invariant 2** — the notification keys embed `attempts`/`attempt` verbatim from the
  idempotency key beside them, so a correction cannot collide with the payout it corrects.
- **Invariant 3** — the settle transaction gains one primary-key read and one INSERT, both on the
  existing `tx`, so the balance cache still moves in the same transaction as its entry.
- **Invariant 4** — escrow is untouched.

```bash
npm run format && npm run verify
git add src/server/bets src/server/seasons src/server/events src/server/feed
git commit -m "feat(notify): queue settlement, allowance and event-dispute notifications"
```

---

### Task 11 [CLOUD]: The delivery cron, retention, and the health row

**DB.**

**Files:**

- Create: `src/app/api/cron/notify/route.ts`
- Modify: `src/app/api/cron/reconcile/route.ts`
- Modify: `vercel.json`
- Modify: `src/server/ops/health.ts`
- Modify: `src/app/admin/health/page.tsx`
- Test: `src/server/notify/__tests__/notify-route.test.ts`

**Interfaces:** consumes `deliverPending`/`pruneNotifications` (Task 6) and `runJob` (existing).

> **Dependency on phase 6.** `runJob` and the `job_name` enum come from phase 6; Task 1 already
> added `NOTIFY` to that enum. If phase 6 is not in your base branch, `src/server/ops/` will not
> exist — in that case write the route without `runJob`, say so in the commit body, and skip the
> health-row steps.

- [ ] **Step 1: Write the failing test**

`src/server/notify/__tests__/notify-route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/client';
import { jobRuns, notifications, users } from '@/db/schema';
import { resetDb } from '@/test/db';

vi.mock('@/server/notify/transport', () => ({
  sendEmail: vi.fn().mockResolvedValue({ ok: true }),
  activeTransport: () => 'console',
}));
vi.mock('@/server/ops/alerts', () => ({
  raiseAlert: vi.fn().mockResolvedValue(undefined),
  formatAlert: (a: { kind: string; message: string }) => `[${a.kind}] ${a.message}`,
}));

import { GET } from '@/app/api/cron/notify/route';

function request(secret = 'shhh') {
  return new Request('https://app.example/api/cron/notify', {
    headers: { authorization: `Bearer ${secret}` },
  });
}

beforeEach(async () => {
  await resetDb();
  vi.stubEnv('CRON_SECRET', 'shhh');
  vi.stubEnv('AUTH_SECRET', 'test-secret');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://bets.example');
});

afterEach(() => vi.unstubAllEnvs());

describe('GET /api/cron/notify', () => {
  it('refuses a request without the bearer token', async () => {
    const response = await GET(request('wrong'));
    expect(response.status).toBe(401);
  });

  it('delivers what is queued and records the run', async () => {
    const [user] = await db
      .insert(users)
      .values({
        provider: 'GOOGLE',
        providerAccountId: 'a@example.com',
        email: 'a@example.com',
        displayName: 'A',
        status: 'APPROVED',
      })
      .returning({ id: users.id });

    await db.insert(notifications).values({
      userId: user.id,
      type: 'BETS_SETTLED',
      channel: 'DIGEST',
      dedupeKey: 'k1',
      payload: { outcome: 'WON', netCents: '100', subject: 'A' },
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sent: 1, suppressed: 0, failed: 0 });

    const runs = await db.select().from(jobRuns);
    expect(runs).toHaveLength(1);
    expect(runs[0].job).toBe('NOTIFY');
    expect(runs[0].ok).toBe(true);
  });

  it('returns 207 and records a failure when a send fails', async () => {
    const { sendEmail } = await import('@/server/notify/transport');
    vi.mocked(sendEmail).mockResolvedValue({ ok: false, error: 'Resend answered 401' });

    const [user] = await db
      .insert(users)
      .values({
        provider: 'GOOGLE',
        providerAccountId: 'a@example.com',
        email: 'a@example.com',
        displayName: 'A',
        status: 'APPROVED',
      })
      .returning({ id: users.id });

    await db.insert(notifications).values({
      userId: user.id,
      type: 'WAGER_OFFERED',
      channel: 'IMMEDIATE',
      dedupeKey: 'k1',
      payload: {},
    });

    const response = await GET(request());

    expect(response.status).toBe(207);
    const [run] = await db.select().from(jobRuns);
    expect(run.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/server/notify/__tests__/notify-route.test.ts`
Expected: FAIL — the route does not exist.

- [ ] **Step 3: Write the route**

`src/app/api/cron/notify/route.ts`:

```ts
import { authorizeCronRequest, jsonSafe } from '@/server/cron/auth';
import { deliverPending } from '@/server/notify/deliver';
import { runJob } from '@/server/ops/job-runs';

/**
 * Daily at 13:00 UTC — 9am Eastern, so Sunday's settlements arrive Monday morning rather than at
 * 4am (D66).
 *
 * It flushes the digest and sweeps whatever the in-request `after()` flush dropped: a process
 * that died, or an enqueue that came from a cron rather than a request. Both channels, because
 * an unsent immediate is exactly what this pass exists to catch.
 *
 * Daily-or-less, so it is legal on Vercel Hobby and needs no GitHub Actions job and no new
 * secret — unlike settle, whose Actions schedule is currently disabled.
 *
 * A send failure is a partial error, so `runJob` alerts through D60's transition rule: a rotated
 * API key shouts rather than being discovered by a member who stopped getting mail.
 */
export async function GET(request: Request): Promise<Response> {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  const payload = await runJob('NOTIFY', () => deliverPending(), {
    partialErrors: (p) => p.errors,
  });

  return Response.json(jsonSafe(payload), { status: payload.failed > 0 ? 207 : 200 });
}
```

- [ ] **Step 4: Schedule it**

In `vercel.json`, add to `crons`:

```json
{ "path": "/api/cron/notify", "schedule": "0 13 * * *" }
```

- [ ] **Step 5: Prune on the daily reconcile**

In `src/app/api/cron/reconcile/route.ts`, extend the existing housekeeping `try`:

```ts
// Retention rides this job rather than earning a schedule of its own. Its own try/catch:
// a failed prune is housekeeping and must not fail a reconciliation run.
try {
  await pruneJobRuns();
  await pruneNotifications();
} catch (err) {
  console.error('[reconcile] pruning bookkeeping tables failed', err);
}
```

with `import { pruneNotifications } from '@/server/notify/deliver';`.

- [ ] **Step 6: Report the transport on the health page**

In `src/server/ops/health.ts`, add to `HealthSnapshot`:

```ts
emailTransport: 'resend' | 'console';
```

and populate it in `readHealth` from `activeTransport()`
(`import { activeTransport } from '@/server/notify/transport';`).

In `src/app/admin/health/page.tsx`, add a row to the existing "Markets and escrow" card:

```tsx
<Row label="Email transport">
  {health.emailTransport === 'resend'
    ? 'Resend'
    : 'Console — RESEND_API_KEY is not set, so nothing is being sent'}
</Row>
```

This row exists because dev mode is the absence of a key (D68): a production deploy that forgets
the key logs silently, and this is the only thing that says so.

- [ ] **Step 7: Run and watch it pass**

```bash
npx vitest run src/server/notify src/server/ops src/app
```

Expected: PASS. `health.test.ts` and `health-reads.test.ts` may need the new field added to a
fixture — that is a real shape change, not a test to loosen.

- [ ] **Step 8: Commit**

```bash
npm run format && npm run verify
git add src/app/api/cron vercel.json src/server/ops src/app/admin/health src/server/notify
git commit -m "feat(notify): add the daily delivery cron, retention and the health row"
```

---

### Task 12 [CLOUD]: `/me/notifications`

**Files:**

- Create: `src/app/(app)/me/notifications/page.tsx`
- Create: `src/app/(app)/me/notifications/notification-form.tsx`
- Create: `src/app/(app)/me/notifications/actions.ts`
- Modify: `src/app/(app)/me/page.tsx`

**Interfaces:** consumes `getNotificationPreferences`/`setNotificationPreferences` (Task 5).

- [ ] **Step 1: Write the action**

`src/app/(app)/me/notifications/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import type { NotificationType } from '@/db/schema';
import { requireApprovedMemberOrThrow } from '@/server/auth/session';
import { setNotificationPreferences } from '@/server/notify/preferences';

export async function saveNotificationPreferencesAction(next: {
  mutedTypes: NotificationType[];
  emailsEnabled: boolean;
}): Promise<void> {
  // The user comes from the session, never from the client — otherwise a crafted request
  // silences somebody else's email.
  const member = await requireApprovedMemberOrThrow();
  await setNotificationPreferences(member.userId, next);
  revalidatePath('/me/notifications');
}
```

- [ ] **Step 2: Write the page**

`src/app/(app)/me/notifications/page.tsx`:

```tsx
import type { Metadata } from 'next';
import type { NotificationType } from '@/db/schema';
import { requireApprovedMember } from '@/server/auth/session';
import { getNotificationPreferences } from '@/server/notify/preferences';
import { NotificationForm, type NotificationOption } from './notification-form';

export const metadata: Metadata = { title: 'Email' };

/** The six types that send, with copy that says what would stop arriving. */
const OPTIONS: NotificationOption[] = [
  {
    type: 'WAGER_OFFERED',
    label: 'Wagers offered to you',
    description: 'When somebody challenges you directly',
  },
  {
    type: 'OFFER_EXPIRING',
    label: 'Offers about to expire',
    description: 'Before an offer lapses and the credits go back',
  },
  {
    type: 'DISPUTE_NEEDS_RULING',
    label: 'Disputes needing a ruling',
    description: 'Admins only — something is waiting on you',
  },
  {
    type: 'ACCOUNT_APPROVED',
    label: 'Account approved',
    description: 'Once, when an admin lets you in',
  },
  {
    type: 'BETS_SETTLED',
    label: 'Your bets settled',
    description: 'A daily summary of how everything resolved',
  },
  {
    type: 'ALLOWANCE_PAID',
    label: 'Weekly allowance',
    description: 'When the weekly allowance lands',
  },
];

export default async function NotificationPreferencesPage() {
  const member = await requireApprovedMember();
  const prefs = await getNotificationPreferences(member.userId);

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Email</h1>
        <p className="text-sm text-ink-muted">
          Everything is on unless you turn it off. Nothing here changes what you see in the app —
          only what arrives in your inbox.
        </p>
      </header>

      <NotificationForm
        options={OPTIONS}
        muted={prefs.mutedTypes as NotificationType[]}
        emailsEnabled={prefs.emailsEnabled}
      />
    </div>
  );
}
```

- [ ] **Step 3: Write the client form**

`src/app/(app)/me/notifications/notification-form.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import type { NotificationType } from '@/db/schema';
import { Button } from '@/components/ui/button';
import { saveNotificationPreferencesAction } from './actions';

export interface NotificationOption {
  type: NotificationType;
  label: string;
  description: string;
}

export function NotificationForm({
  options,
  muted,
  emailsEnabled,
}: {
  options: NotificationOption[];
  muted: NotificationType[];
  emailsEnabled: boolean;
}) {
  const [mutedSet, setMutedSet] = useState(() => new Set(muted));
  const [enabled, setEnabled] = useState(emailsEnabled);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function toggle(type: NotificationType) {
    setSaved(false);
    setMutedSet((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  function save() {
    startTransition(async () => {
      await saveNotificationPreferencesAction({
        mutedTypes: [...mutedSet],
        emailsEnabled: enabled,
      });
      setSaved(true);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-start gap-3 rounded-xl border border-line-strong bg-surface-raised p-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={() => {
            setSaved(false);
            setEnabled((on) => !on);
          }}
          className="mt-0.5"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Send me email at all</span>
          <span className="text-xs text-ink-muted">
            Turn this off and nothing below sends, whatever it says.
          </span>
        </span>
      </label>

      {options.map((option) => {
        const on = !mutedSet.has(option.type);
        return (
          <label
            key={option.type}
            className="flex items-start gap-3 rounded-xl border border-line bg-surface-raised p-3"
          >
            <input
              type="checkbox"
              checked={on && enabled}
              // Disabled under a global off, because a row of live-looking toggles beneath one
              // is a lie about what will happen.
              disabled={!enabled}
              onChange={() => toggle(option.type)}
              className="mt-0.5"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{option.label}</span>
              <span className="text-xs text-ink-muted">{option.description}</span>
            </span>
          </label>
        );
      })}

      <div className="flex items-center justify-end gap-3 pt-2">
        {saved ? <span className="text-xs text-positive">Saved</span> : null}
        <Button onClick={save} disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Link it from `/me`**

Beside the existing "Feed filters" link in `src/app/(app)/me/page.tsx`:

```tsx
<Link href="/me/notifications" className="text-xs text-ink-muted hover:underline">
  Email
</Link>
```

- [ ] **Step 5: Verify the structural tests still pass**

```bash
npx vitest run src/app/__tests__
npm run build
```

Expected: PASS. `token-lint` fails on a raw colour class; the `useTransition` test fails if the
Save button is not disabled while pending. Both are satisfied above — if either fails, something
changed.

- [ ] **Step 6: Commit**

```bash
npm run format && npm run verify
git add "src/app/(app)/me"
git commit -m "feat(notify): add the email preferences screen with a global off"
```

---

### Task 13 [CLOUD]: The unsubscribe routes

**DB.** Both routes are public — they simply do not call `requireApprovedMember()`. This app has
no middleware; auth is enforced per page.

**Files:**

- Create: `src/app/unsubscribe/page.tsx`
- Create: `src/app/api/unsubscribe/route.ts`
- Test: `src/server/notify/__tests__/unsubscribe-route.test.ts`

**Interfaces:** consumes `verifyUnsubscribe` (Task 2), `muteType`/`disableAllEmail` (Task 5).

- [ ] **Step 1: Write the failing test**

`src/server/notify/__tests__/unsubscribe-route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { getNotificationPreferences } from '@/server/notify/preferences';
import { signUnsubscribe } from '@/server/notify/unsubscribe';
import { resetDb } from '@/test/db';
import { POST } from '@/app/api/unsubscribe/route';

async function aUser() {
  const [row] = await db
    .insert(users)
    .values({
      provider: 'GOOGLE',
      providerAccountId: 'a@example.com',
      email: 'a@example.com',
      displayName: 'A',
      status: 'APPROVED',
    })
    .returning({ id: users.id });
  return row.id;
}

function post(userId: string, scope: string, token: string) {
  const url = new URL('https://app.example/api/unsubscribe');
  url.searchParams.set('u', userId);
  url.searchParams.set('s', scope);
  url.searchParams.set('t', token);
  return new Request(url, { method: 'POST' });
}

beforeEach(async () => {
  await resetDb();
  vi.stubEnv('AUTH_SECRET', 'test-secret');
});

afterEach(() => vi.unstubAllEnvs());

describe('POST /api/unsubscribe', () => {
  it('mutes one type on a valid type-scoped token', async () => {
    const userId = await aUser();
    const token = signUnsubscribe(userId, 'BETS_SETTLED');

    const response = await POST(post(userId, 'BETS_SETTLED', token));

    expect(response.status).toBe(200);
    const prefs = await getNotificationPreferences(userId);
    expect(prefs.mutedTypes).toEqual(['BETS_SETTLED']);
    expect(prefs.emailsEnabled).toBe(true);
  });

  it('turns everything off on a valid all-scoped token', async () => {
    const userId = await aUser();
    const token = signUnsubscribe(userId, 'all');

    await POST(post(userId, 'all', token));

    expect((await getNotificationPreferences(userId)).emailsEnabled).toBe(false);
  });

  it('rejects a tampered token and changes nothing', async () => {
    const userId = await aUser();
    const token = signUnsubscribe(userId, 'BETS_SETTLED');

    const response = await POST(post(userId, 'BETS_SETTLED', `${token.slice(0, -1)}x`));

    expect(response.status).toBe(400);
    expect(await getNotificationPreferences(userId)).toEqual({
      mutedTypes: [],
      emailsEnabled: true,
    });
  });

  it('rejects a narrower token used on the global scope — a link cannot widen itself', async () => {
    const userId = await aUser();
    const token = signUnsubscribe(userId, 'BETS_SETTLED');

    const response = await POST(post(userId, 'all', token));

    expect(response.status).toBe(400);
    expect((await getNotificationPreferences(userId)).emailsEnabled).toBe(true);
  });

  it('is idempotent — a scanner POSTing twice is not an error', async () => {
    const userId = await aUser();
    const token = signUnsubscribe(userId, 'BETS_SETTLED');

    await POST(post(userId, 'BETS_SETTLED', token));
    const second = await POST(post(userId, 'BETS_SETTLED', token));

    expect(second.status).toBe(200);
    expect((await getNotificationPreferences(userId)).mutedTypes).toEqual(['BETS_SETTLED']);
  });

  it('says nothing about whether the user exists', async () => {
    const stranger = '11111111-1111-1111-1111-111111111111';
    const response = await POST(post(stranger, 'BETS_SETTLED', 'nope'));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid link' });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/server/notify/__tests__/unsubscribe-route.test.ts`
Expected: FAIL — the route does not exist.

- [ ] **Step 3: Write the POST route**

`src/app/api/unsubscribe/route.ts`:

```ts
import { disableAllEmail, muteType } from '@/server/notify/preferences';
import { verifyUnsubscribe } from '@/server/notify/unsubscribe';

/**
 * The only thing that writes an unsubscribe, and it is POST-only on purpose (D67).
 *
 * Outlook Safe Links, corporate mail filters and link scanners issue a GET against every URL in
 * a message. A mutating GET means members get silently unsubscribed by their own employer's
 * spam filter, and the symptom is "email stopped working" with nothing anywhere to explain it.
 *
 * This is also the RFC 8058 target: `List-Unsubscribe-Post: List-Unsubscribe=One-Click` makes
 * Gmail and Apple Mail POST here from their own native control, which is what "one click
 * without signing in" actually means.
 *
 * Public by construction — it calls no session helper. The signed token is the authorization.
 */
export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const userId = url.searchParams.get('u') ?? '';
  const scope = url.searchParams.get('s') ?? '';
  const token = url.searchParams.get('t') ?? '';

  const verified = verifyUnsubscribe(userId, scope, token);
  // Deliberately says nothing about whether the user exists.
  if (!verified) return Response.json({ error: 'invalid link' }, { status: 400 });

  if (verified === 'all') await disableAllEmail(userId);
  else await muteType(userId, verified);

  return Response.json({ ok: true, scope: verified });
}
```

- [ ] **Step 4: Write the confirmation page**

`src/app/unsubscribe/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { Card } from '@/components/ui/card';
import { verifyUnsubscribe } from '@/server/notify/unsubscribe';

export const metadata: Metadata = { title: 'Unsubscribe' };

const LABELS: Record<string, string> = {
  all: 'all email',
  WAGER_OFFERED: 'wagers offered to you',
  OFFER_EXPIRING: 'offers about to expire',
  DISPUTE_NEEDS_RULING: 'disputes needing a ruling',
  ACCOUNT_APPROVED: 'account approval',
  BETS_SETTLED: 'your settled bets',
  ALLOWANCE_PAID: 'the weekly allowance',
};

/**
 * Renders a button and changes nothing; the POST route is the only writer (D67).
 *
 * Public by construction — no session helper is called, because somebody unsubscribing is by
 * definition not signed in.
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ u?: string; s?: string; t?: string }>;
}) {
  const { u = '', s = '', t = '' } = await searchParams;
  const verified = verifyUnsubscribe(u, s, t);

  if (!verified) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-4 py-6">
        <Card className="flex flex-col gap-2 p-4">
          <h1 className="text-lg font-semibold">This link is not valid</h1>
          <p className="text-sm text-ink-muted">
            It may have been truncated by your mail client. You can change what you receive from the
            app’s Email settings once you are signed in.
          </p>
        </Card>
      </main>
    );
  }

  const query = new URLSearchParams({ u, s, t }).toString();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-4 py-6">
      <Card className="flex flex-col gap-3 p-4">
        <h1 className="text-lg font-semibold">Turn off {LABELS[verified] ?? 'these emails'}?</h1>
        <p className="text-sm text-ink-muted">
          Nothing has changed yet. Nothing is deleted either — you can turn it back on any time from
          the app.
        </p>
        <form method="POST" action={`/api/unsubscribe?${query}`}>
          <button className="h-10 w-full rounded-full bg-accent px-4 text-sm font-medium text-accent-ink">
            Turn it off
          </button>
        </form>
      </Card>
    </main>
  );
}
```

- [ ] **Step 5: Run and watch it pass**

```bash
npx vitest run src/server/notify src/app/__tests__
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
npm run format && npm run verify
git add src/app/unsubscribe src/app/api/unsubscribe src/server/notify
git commit -m "feat(notify): add one-click unsubscribe with a non-mutating GET"
```

---

### Task 14 [CLOUD]: Environment, README, and the docs

**Files:**

- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/roadmap.md`

- [ ] **Step 1: `.env.example`**

Append, matching the commenting style of the entries already there:

```
# Transactional email. Unset means the console transport: every message is logged and nothing
# is sent, which is the expected state in CI, in the test suite, and in local development.
# Get a key at resend.com; the free tier is 3,000/month and 100/day.
RESEND_API_KEY=

# The From header on every message. Must be an address on a domain verified with the provider.
# Defaults to Resend's onboarding@resend.dev, which only delivers to the account owner.
EMAIL_FROM=
```

- [ ] **Step 2: `README.md`**

Add both variables wherever the existing optional variables are listed, with the same framing:
unset is a working state, not a broken one.

- [ ] **Step 3: `docs/README.md` — verify, do not add**

Both rows are already there. This repo's convention is that a document is listed in
`docs/README.md` in the same commit that creates it, so the spec and plan rows landed with the
spec and plan themselves. Confirm both are present and their links resolve:

```bash
grep -n "Email notifications" docs/README.md
```

Expected: two rows, one for the spec and one for this plan. If either is missing, add it —
otherwise change nothing here.

- [ ] **Step 4: `docs/roadmap.md`**

Three edits:

1. Master table row 8 — replace `—` in the Reference column with the spec and plan links, the way
   rows 5 and 6 do.
2. Master table row 8 status — `🔄 Partial — built, not yet sending`, owner `[NOAH] [MANUAL]`.
3. The phase 8 task table — move the five `[CLOUD]` rows to `✅ Complete`, leaving the `[NOAH]`
   and `[MANUAL]` rows at `🔲 Backlog`.

- [ ] **Step 5: Check every new link resolves**

```bash
npm run format
```

Then follow the new links by eye. A broken doc link is invisible until somebody follows it.

- [ ] **Step 6: Final full verify and commit**

```bash
npm run verify
git add .env.example README.md docs
git commit -m "docs(notify): document the email variables and update the roadmap"
```

---

### Task 15 [NOAH]: The provider

**Not a cloud task.** Nothing in the repository changes.

- [ ] Sign up at [resend.com](https://resend.com) on the free tier.
- [ ] Add and verify the sending domain. Its DNS records — SPF, DKIM, and the return-path CNAME —
      go on the domain the app is served from, or a subdomain of it.
- [ ] Create an API key with send permission only.
- [ ] Set `RESEND_API_KEY` and `EMAIL_FROM` in the Vercel project's Production environment.
- [ ] Apply the migration to the production database.
- [ ] Confirm `/admin/health` now shows "Email transport: Resend".

> Until this task is done, phase 8 is code-complete and silent. That is the designed state, not a
> failure — see [D68](../decisions.md#d68--the-email-transport-is-inert-without-an-api-key).

---

### Task 16 [MANUAL]: Confirm a real message renders

**Needs a human with an inbox.** The one thing no session of any kind can prove.

- [ ] With the key set, approve a test account and confirm the approval email arrives.
- [ ] Check it in Gmail on desktop and on a phone: subject readable in the list view, body legible,
      no raw HTML, no broken layout.
- [ ] Confirm Gmail shows its own **Unsubscribe** control beside the sender — that is the RFC 8058
      header working. Press it, then confirm that type is off in `/me/notifications`.
- [ ] Open the footer's "Stop these emails" link and confirm it shows a **confirmation page**
      rather than unsubscribing on the spot. This is the scanner-safety property; if the link
      unsubscribes on load, something regressed.
- [ ] Let a settle run produce a digest and confirm several settled bets arrive as **one** email.
- [ ] File anything wrong as a ticket. It does not block the rest of the roadmap.

---

## What a cloud session can and cannot prove

Measured 2026-09-03 in the session that wrote this plan, not assumed.

| Step                                                                   | Provable in a cloud session                                                |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Tasks 2, 3, 4 — pure modules and a stubbed `fetch`                     | ✅ Yes, no database in the import graph                                    |
| Tasks 1, 5, 6, 7, 8, 9, 10, 11, 13 — everything marked **DB**          | ✅ Yes. The session-start hook runs a native Postgres and the suite passes |
| The migration                                                          | ✅ Against the local test database, via `npm run db:migrate:test`          |
| Task 12 — the preferences screen                                       | ✅ Structurally, via `src/app/__tests__` and `npm run build`               |
| `npm run verify` in full                                               | ✅ Typecheck, lint, and all tests                                          |
| The migration against the **production** database                      | ❌ **[NOAH]** — credentials only Noah holds (Task 15)                      |
| A real message reaching, rendering in, and unsubscribing from an inbox | ❌ **[MANUAL]** — Task 16                                                  |

The evidence for the second row: `npm test` on this branch's base, 2026-09-03, reported
**86 files / 925 tests passing, exit 0, 76s**, against the native Postgres the session-start hook
brings up without a Docker daemon. See
[repo-health 3.7](../repo-health.md#37-postgres-without-docker-in-a-cloud-session).

**If a future session's hook cannot start Postgres**, say so plainly, mark every **DB** task
written-but-not-run, and let CI be the proof. Never report a DB test as passing on the strength of
having written it.

---

## Dependency order

Tasks 2, 3 and 4 are independent of each other and of everything else, so they can go in parallel
after Task 1. Everything after that is a chain.

```
1 (schema)
├── 2 (unsubscribe token) ──┐
├── 3 (types + render) ─────┼── 6 (deliver) ── 11 (cron, health)
├── 4 (transport) ──────────┘        │
└── 5 (enqueue, recipients, prefs) ──┴── 7 (approve)
                                      ├── 8 (p2p emit points)
                                      ├── 9 (expiring sweep)   [needs 8's imports in sweep.ts]
                                      ├── 10 (settle, allowance, event dispute)
                                      ├── 12 (preferences screen)
                                      └── 13 (unsubscribe routes)  [also needs 2]
                                                 └── 14 (docs)
```

Tasks 8 and 9 both edit `src/server/p2p/sweep.ts`. Do 8 first; 9 assumes its imports are already
there.

---

## Self-review

Checked against the spec, section by section.

**Spec coverage.** Every requirement maps to a task:

| Spec section                    | Task(s)                                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| §3 — the six events             | 7 (approved), 8 (offered, p2p dispute), 9 (expiring), 10 (settled, allowance, event dispute)         |
| §4 — the data model             | 1, including the `job_name` extension Task 11 needs                                                  |
| §5 — enqueue and delivery       | 5, 6; the two triggers are `flushSoon` (7, 8, 10) and the cron (11); retention is 11 step 5          |
| §6 — the transport and dev mode | 4, with the health row in 11 step 6                                                                  |
| §7 — unsubscribe                | 2 (token), 13 (both routes); the RFC 8058 headers are in 3                                           |
| §8 — `/me/notifications`        | 12                                                                                                   |
| §9 — the money position         | the global constraint, plus explicit `/money-invariants` gates on 8, 9 and 10                        |
| §10 — the test table            | every row has a task; the re-run assertions are 10 steps 2–3 and 9 step 1                            |
| §11 — success criteria 1–8      | 1–3 → Task 10's tests; 4 → Task 4's; 5 → Task 6's; 6 → Task 13's; 7 → every commit gate; 8 → Task 16 |

**Placeholder scan.** No "TBD", no "add appropriate error handling", no "write tests for the
above", no "similar to Task N". Every code step carries the code. Three places deliberately point
at an existing file instead of inlining a fixture — Task 8's and Task 10's seeding, which reuse
`src/test/factories.ts` and `src/server/bets/__tests__/helpers.ts`. That is reuse of real,
named, existing helpers, not a placeholder; the alternative is a second way to seed a season,
which is exactly the drift this repo avoids elsewhere.

**Type consistency.** One name for each thing across all sixteen tasks:
`enqueueNotification`, `deliverPending`, `flushSoon`, `pruneNotifications`,
`userIdForMembership`, `adminUserIds`, `seasonMemberUserIds`, `getNotificationPreferences`,
`getManyNotificationPreferences`, `setNotificationPreferences`, `muteType`, `disableAllEmail`,
`isSuppressed`, `signUnsubscribe`, `verifyUnsubscribe`, `unsubscribeUrl`, `renderImmediate`,
`renderDigest`, `sendEmail`, `activeTransport`, `setUserStatus`, `describeLeg`, `describeBet`,
`CHANNEL_FOR_TYPE`, `NotificationRow`, `RenderedEmail`, `DeliverSummary`, `EnqueueInput`,
`NotificationPreferences`, `UnsubscribeScope`.

Two consistency points worth calling out because they are the kind of thing that silently breaks:

- `grade-legs.ts` uses `attempts` and `resettle.ts` uses `attempt`. The plan uses each file's own
  variable rather than normalising, because the notification key must match the ledger key beside
  it exactly.
- `CHANNEL_FOR_TYPE` lives in `types.ts` and is read by `enqueue.ts`, so no call site passes a
  channel. Task 5's first test asserts that.

**One thing left deliberately undone.** `src/server/seasons/allowance.ts` calls `postEntry` twice
and sits outside all five of the money-touch hook's paths. Task 10 edits that file. Widening
`.claude/hooks/money-touch.sh` is a one-line change, but it belongs to repo health rather than to
this phase — and changing a guard in the same commit as the code it guards is the wrong order.
