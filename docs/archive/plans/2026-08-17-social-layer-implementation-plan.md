# Social Layer (Subsystem 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a season activity feed with reactions, comments, member profiles, and per-viewer feed filters to an existing play-money sportsbook, without changing any money or grading behavior.

**Architecture:** Feed events are materialized rows in a new `feed_events` table, written by `emitFeedEvent(tx, …)` from inside the same transaction as the state change that caused them — the same pattern the existing ledger uses with `postEntry(tx, …)`. Each event carries a deterministic unique `dedupe_key`, so re-running any job or re-settling any bet produces no duplicates. Reactions and comments are plain foreign keys onto those event rows. Two pieces of real logic (milestone thresholds and profile statistics) live as pure functions in `src/domain/` with no I/O.

**Tech Stack:** Next.js 16.3.1 (App Router, React 19.2.8, Server Components + server actions), TypeScript 5, Drizzle ORM 0.45 on Postgres 16, Vitest 4, Tailwind 4.

**Read first:** [`docs/specs/2026-08-17-social-layer-design.md`](../specs/2026-08-17-social-layer-design.md) is the spec this plan implements. [`docs/decisions.md`](../decisions.md) D21–D29 explain why each choice was made. You do not need to read the subsystem 1 spec to execute this plan, but `docs/specs/2026-08-14-core-betting-engine-design.md` is the reference if something about the existing engine is unclear.

---

## Global Constraints

- **This is NOT the Next.js you know.** Per `AGENTS.md`, this version has breaking changes from your training data. Before writing any UI code (Tasks 12–16), read the relevant guide in `node_modules/next/dist/docs/`. In particular confirm how `params` is typed and awaited in dynamic routes, and how server actions are declared. The existing code uses generated route types — `src/app/(app)/layout.tsx` takes `LayoutProps<'/'>` — so dynamic pages should use `PageProps<'/route/[param]'>` rather than a hand-written props type.
- **All money is integer cents as `bigint`.** No floating-point value touches a balance or any money-derived display value. Ratios are integer basis points.
- **`bigint` is not serializable across a server action boundary or into JSON.** Cents cross those boundaries as decimal strings (`"95450"`) and are re-parsed with `BigInt()`. This is already the convention in `src/app/(app)/bets/actions.ts`.
- **Every ledger write and every feed write carries a deterministic idempotency/dedupe key.** Running any background job twice must move no extra money and create no extra events.
- **Authorization is server-side on every request**, never by hiding UI. Use the existing `requireApprovedMember()` (pages, redirects) and `requireApprovedMemberOrThrow()` (server actions, throws).
- **Do not change existing money or grading behavior.** The existing 222 tests must still pass. The only edits to `place.ts`, `settle.ts`, `resettle.ts`, `service.ts`, `allowance.ts` and `adjust.ts` are added emit calls plus the extra columns those emits need.
- **Database for tests:** see [Environment setup](#environment-setup) — the `npm run db:up` path needs Docker and does **not** work in the Claude Code cloud environment. Tests run against `simbet_test`.
- **Verification command:** `npm run verify` (typecheck + lint + test). It must pass before the final commit of every task.
- **Commit after every task**, with a `feat:` / `test:` / `docs:` prefix matching the existing history style.

---

## Environment setup

Run this once at the start of the session, before Task 1. These commands were executed and verified in the Claude Code cloud environment on 2026-08-17: `npm ci` succeeds through the proxy, and `npm run verify` passes clean at 26 files / 222 tests against the database this sets up.

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

# .env.test points DATABASE_URL at the test database — src/db/migrate.ts reads
# DATABASE_URL, not TEST_DATABASE_URL, when ENV_FILE=.env.test.
cp .env .env.test
sed -i 's#^DATABASE_URL=.*#DATABASE_URL=postgres://simbet:simbet@127.0.0.1:5432/simbet_test#' .env.test

npm run db:migrate:test
npm run verify
```

Expected from the last command: **26 test files, 222 tests, all passing.** If that does not hold, stop and fix the environment before starting Task 1 — every task in this plan gates on `npm run verify`, and you cannot tell your own regression from a broken setup.

Both `.env` files are covered by `.gitignore` (`.env*`), so they will not be committed. Re-run `npm run db:migrate:test` after Task 1 generates the new migration.

**The running app cannot be signed into here.** Sign-in is Google OAuth only ([D20](../decisions.md#d20--auth-google-only-apple-dropped)) with no dev bypass, so `npm run dev` will serve the app but you cannot get past `/sign-in` without real Google credentials. Tasks 12–15 therefore mark their browser steps as local-only and give a substitute gate that does work here: `npm run build`, which compiles every route for real and is what catches server/client boundary mistakes — the actual risk in those tasks.

---

## File Structure

**New files**

| Path                                                     | Responsibility                                                                                             |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/db/schema/social.ts`                                | `feed_events`, `feed_reactions`, `feed_comments`, `feed_preferences` tables and the `feed_event_type` enum |
| `src/server/feed/payload.ts`                             | The discriminated-union payload types stored in `feed_events.payload`                                      |
| `src/server/feed/emit.ts`                                | `emitFeedEvent(tx, input)` — the single write path for every event                                         |
| `src/server/feed/snapshot.ts`                            | Builds `FeedLegSnapshot[]` from already-loaded selection rows                                              |
| `src/server/feed/query.ts`                               | `getSeasonFeed(…)` — keyset-paginated read with reactions and comment counts                               |
| `src/server/feed/social.ts`                              | `toggleReaction`, `addComment`, `deleteComment`, `listComments`                                            |
| `src/server/feed/preferences.ts`                         | `getMutedTypes`, `setMutedTypes`                                                                           |
| `src/server/feed/leaders.ts`                             | `detectLeadChange(seasonId)`                                                                               |
| `src/server/feed/stats.ts`                               | Loads a member's bet rows and calls the pure stats function                                                |
| `src/domain/milestones.ts`                               | Pure milestone thresholds                                                                                  |
| `src/domain/stats.ts`                                    | Pure `computeMemberStats`                                                                                  |
| `src/app/(app)/feed/page.tsx`                            | Feed tab — first page, server-rendered                                                                     |
| `src/app/(app)/feed/feed-list.tsx`                       | Client component: appends further pages                                                                    |
| `src/app/(app)/feed/feed-card.tsx`                       | One card, all eight event types                                                                            |
| `src/app/(app)/feed/actions.ts`                          | Server actions: load more, react, comment, delete                                                          |
| `src/app/(app)/feed/[eventId]/page.tsx`                  | Event detail with the full comment thread                                                                  |
| `src/app/(app)/feed/[eventId]/comment-thread.tsx`        | Client component: composer + delete controls                                                               |
| `src/app/(app)/members/[membershipId]/page.tsx`          | Member profile                                                                                             |
| `src/app/(app)/me/feed-preferences/page.tsx`             | Per-viewer mute settings                                                                                   |
| `src/app/(app)/me/feed-preferences/preferences-form.tsx` | Client component for the checkbox list                                                                     |

**Modified files**

| Path                                      | Change                                                           |
| ----------------------------------------- | ---------------------------------------------------------------- |
| `src/db/schema/index.ts`                  | Export `./social`                                                |
| `src/test/db.ts`                          | Truncate the four new tables                                     |
| `src/server/bets/validate.ts`             | `LoadedSelection` gains snapshot columns                         |
| `src/server/bets/place.ts`                | `loadSelections` selects the snapshot columns; emit `BET_PLACED` |
| `src/server/bets/settle.ts`               | Emit `BET_SETTLED` + big-win + parlay-hit                        |
| `src/server/bets/resettle.ts`             | Emit the corrected `BET_SETTLED` + milestones                    |
| `src/server/seasons/service.ts`           | Emit `MEMBER_JOINED`                                             |
| `src/server/seasons/allowance.ts`         | Emit one aggregated `ALLOWANCE_PAID`                             |
| `src/server/admin/adjust.ts`              | Emit `ADMIN_ADJUSTMENT`                                          |
| `src/app/api/cron/settle/route.ts`        | Call `detectLeadChange` after the sweep                          |
| `src/components/ui/tab-bar.tsx`           | Five tabs instead of four                                        |
| `src/app/(app)/standings/page.tsx`        | Link rows to member profiles                                     |
| `src/app/(app)/me/page.tsx`               | Link to feed preferences                                         |
| `src/server/__tests__/end-to-end.test.ts` | Assert the feed's event sequence                                 |

---

### Task 1: Social schema and migration

**Files:**

- Create: `src/db/schema/social.ts`
- Modify: `src/db/schema/index.ts`
- Modify: `src/test/db.ts:6`
- Test: `src/db/__tests__/social-schema.test.ts`

**Interfaces:**

- Consumes: nothing — this is the first task.
- Produces: `feedEvents`, `feedReactions`, `feedComments`, `feedPreferences` tables; `feedEventType` pgEnum; `type FeedEventType = 'BET_PLACED' | 'BET_SETTLED' | 'MEMBER_JOINED' | 'ALLOWANCE_PAID' | 'ADMIN_ADJUSTMENT' | 'MILESTONE_LEAD_CHANGE' | 'MILESTONE_BIG_WIN' | 'MILESTONE_PARLAY_HIT'`.

- [ ] **Step 1: Write the failing test**

Create `src/db/__tests__/social-schema.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedComments, feedEvents, feedPreferences, feedReactions } from '@/db/schema';
import { resetDb } from '@/test/db';
import { makeMembership } from '@/test/factories';

describe('social schema', () => {
  beforeEach(resetDb);

  it('stores an event with a jsonb payload and a season scope', async () => {
    const membership = await makeMembership();

    const [event] = await db
      .insert(feedEvents)
      .values({
        seasonId: membership.seasonId,
        type: 'BET_PLACED',
        subjectMembershipId: membership.id,
        payload: { betType: 'SINGLE', stakeCents: '5000' },
        dedupeKey: 'bet:abc:placed',
        occurredAt: new Date('2026-09-01T17:00:00Z'),
      })
      .returning();

    expect(event.type).toBe('BET_PLACED');
    expect(event.payload).toEqual({ betType: 'SINGLE', stakeCents: '5000' });
    expect(event.subjectMembershipId).toBe(membership.id);
  });

  it('rejects a duplicate dedupe key', async () => {
    const membership = await makeMembership();
    const values = {
      seasonId: membership.seasonId,
      type: 'MEMBER_JOINED' as const,
      subjectMembershipId: membership.id,
      payload: {},
      dedupeKey: 'membership:x:joined',
      occurredAt: new Date(),
    };

    await db.insert(feedEvents).values(values);
    await expect(db.insert(feedEvents).values(values)).rejects.toThrow();
  });

  it('allows a season-wide event with no subject', async () => {
    const membership = await makeMembership();

    const [event] = await db
      .insert(feedEvents)
      .values({
        seasonId: membership.seasonId,
        type: 'ALLOWANCE_PAID',
        payload: { weekKey: '2026-W36', memberCount: 3, amountCents: '50000' },
        dedupeKey: 'allowance:s:2026-W36',
        occurredAt: new Date(),
      })
      .returning();

    expect(event.subjectMembershipId).toBeNull();
  });

  it('allows different emoji from one member but not the same one twice', async () => {
    const membership = await makeMembership();
    const [event] = await db
      .insert(feedEvents)
      .values({
        seasonId: membership.seasonId,
        type: 'BET_PLACED',
        subjectMembershipId: membership.id,
        payload: {},
        dedupeKey: 'bet:react:placed',
        occurredAt: new Date(),
      })
      .returning();

    await db
      .insert(feedReactions)
      .values({ eventId: event.id, membershipId: membership.id, emoji: '🔥' });
    await db
      .insert(feedReactions)
      .values({ eventId: event.id, membershipId: membership.id, emoji: '💀' });

    await expect(
      db
        .insert(feedReactions)
        .values({ eventId: event.id, membershipId: membership.id, emoji: '🔥' }),
    ).rejects.toThrow();

    const rows = await db.select().from(feedReactions).where(eq(feedReactions.eventId, event.id));
    expect(rows).toHaveLength(2);
  });

  it('soft-deletes a comment, keeping the row', async () => {
    const membership = await makeMembership();
    const [event] = await db
      .insert(feedEvents)
      .values({
        seasonId: membership.seasonId,
        type: 'BET_PLACED',
        subjectMembershipId: membership.id,
        payload: {},
        dedupeKey: 'bet:comment:placed',
        occurredAt: new Date(),
      })
      .returning();

    const [comment] = await db
      .insert(feedComments)
      .values({ eventId: event.id, membershipId: membership.id, body: 'lock of the year' })
      .returning();

    expect(comment.deletedAt).toBeNull();

    await db
      .update(feedComments)
      .set({ deletedAt: new Date() })
      .where(eq(feedComments.id, comment.id));

    const [after] = await db.select().from(feedComments).where(eq(feedComments.id, comment.id));
    expect(after.deletedAt).not.toBeNull();
    expect(after.body).toBe('lock of the year');
  });

  it('defaults muted types to an empty array', async () => {
    const membership = await makeMembership();
    const [row] = await db
      .insert(feedPreferences)
      .values({ userId: membership.userId })
      .returning();

    expect(row.mutedTypes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- src/db/__tests__/social-schema.test.ts`
Expected: FAIL — `feedEvents` is not exported from `@/db/schema`.

- [ ] **Step 3: Write the schema**

Create `src/db/schema/social.ts`:

```ts
import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { seasonMemberships, seasons, users } from './identity';
import { bets } from './betting';
import { ledgerEntries } from './money';

export const feedEventType = pgEnum('feed_event_type', [
  'BET_PLACED',
  'BET_SETTLED',
  'MEMBER_JOINED',
  'ALLOWANCE_PAID',
  'ADMIN_ADJUSTMENT',
  'MILESTONE_LEAD_CHANGE',
  'MILESTONE_BIG_WIN',
  'MILESTONE_PARLAY_HIT',
]);

export type FeedEventType = (typeof feedEventType.enumValues)[number];

/**
 * Append-only. Never updated, never deleted.
 *
 * `payload` freezes what to render — the teams, the market, the line and price as they were
 * offered. Identity is deliberately NOT in the payload: display name and avatar are joined
 * live from `users`, so renaming yourself updates every card you ever posted. Facts freeze,
 * identity does not.
 *
 * `dedupeKey` is the same guarantee `ledger_entries.idempotency_key` gives the money core:
 * a re-run job or a re-settled bet writes no duplicate row.
 */
export const feedEvents = pgTable(
  'feed_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => seasons.id),
    type: feedEventType('type').notNull(),
    // Null only for ALLOWANCE_PAID, which is season-wide and belongs to nobody.
    subjectMembershipId: uuid('subject_membership_id').references(() => seasonMemberships.id),
    betId: uuid('bet_id').references(() => bets.id),
    ledgerEntryId: uuid('ledger_entry_id').references(() => ledgerEntries.id),
    payload: jsonb('payload').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    // Business time, copied from the source row — not the write time.
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('feed_events_dedupe_key_idx').on(t.dedupeKey),
    // The feed's keyset pagination sorts on exactly this pair. `id` is in the key because a
    // settlement transaction posts several events at the same microsecond, and paginating on
    // a non-unique sort key silently skips or repeats rows at page boundaries.
    index('feed_events_season_idx').on(t.seasonId, t.occurredAt.desc(), t.id.desc()),
    index('feed_events_subject_idx').on(t.subjectMembershipId, t.occurredAt.desc()),
    index('feed_events_bet_idx').on(t.betId),
  ],
);

/** A reaction is not an audit record — removing one deletes the row (D28). */
export const feedReactions = pgTable(
  'feed_reactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => feedEvents.id),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => seasonMemberships.id),
    emoji: text('emoji').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('feed_reactions_unique_idx').on(t.eventId, t.membershipId, t.emoji),
    index('feed_reactions_event_idx').on(t.eventId),
  ],
);

/**
 * Deletion is soft: the thread keeps its shape, the card renders "Comment removed", and
 * `deletedByUserId` records whether the author or an admin did it (D28).
 */
export const feedComments = pgTable(
  'feed_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => feedEvents.id),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => seasonMemberships.id),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedByUserId: uuid('deleted_by_user_id').references(() => users.id),
  },
  (t) => [index('feed_comments_event_idx').on(t.eventId, t.createdAt)],
);

/**
 * Keyed on the user, not the membership: a preference is about a person and should survive
 * into next season rather than resetting when a new membership row is created.
 *
 * No row means nothing muted, so this table stays empty until somebody changes something.
 */
export const feedPreferences = pgTable('feed_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id),
  mutedTypes: feedEventType('muted_types')
    .array()
    .notNull()
    .default(sql`'{}'::feed_event_type[]`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 4: Export it and extend the test reset**

In `src/db/schema/index.ts`, add the export as the last line:

```ts
export * from './social';
```

In `src/test/db.ts`, replace the `TRUNCATE` statement with one that includes the new tables. The new tables come first because they reference the old ones:

```ts
await db.execute(
  sql`TRUNCATE TABLE feed_reactions, feed_comments, feed_events, feed_preferences, ledger_entries, bet_legs, bets, odds_snapshots, selections, markets, games, teams, season_memberships, seasons, users RESTART IDENTITY CASCADE`,
);
```

- [ ] **Step 5: Generate and apply the migration**

Run:

```bash
npm run db:generate
npm run db:up
npm run db:test:create
npm run db:migrate:test
```

Expected: `db:generate` writes `drizzle/0004_<name>.sql` plus a new snapshot in `drizzle/meta/`. Open the generated SQL and confirm it creates the `feed_event_type` enum, all four tables, and the five indexes. If the `muted_types` default came out as anything other than `DEFAULT '{}'::feed_event_type[]`, fix the schema and regenerate rather than hand-editing the SQL.

- [ ] **Step 6: Run the test and verify it passes**

Run: `npm test -- src/db/__tests__/social-schema.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 7: Verify nothing else broke, then commit**

Run: `npm run verify`
Expected: PASS.

```bash
git add src/db/schema/social.ts src/db/schema/index.ts src/db/__tests__/social-schema.test.ts src/test/db.ts drizzle/
git commit -m "feat: add the social layer schema"
```

---

### Task 2: Payload types and `emitFeedEvent`

**Files:**

- Create: `src/server/feed/payload.ts`
- Create: `src/server/feed/emit.ts`
- Test: `src/server/feed/__tests__/emit.test.ts`

**Interfaces:**

- Consumes: `feedEvents`, `FeedEventType` from Task 1; `Tx` from `@/db/client`.
- Produces:
  - `type FeedLegSnapshot`, `BetPlacedPayload`, `BetSettledPayload`, `MemberJoinedPayload`, `AllowancePaidPayload`, `AdminAdjustmentPayload`, `LeadChangePayload`, `BigWinPayload`, `ParlayHitPayload`, `FeedEventPayload`, `LegOutcome`
  - `emitFeedEvent(tx: Tx, input: EmitFeedEventInput): Promise<{ applied: boolean; eventId: string | null }>`

- [ ] **Step 1: Write the failing test**

Create `src/server/feed/__tests__/emit.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedEvents } from '@/db/schema';
import { emitFeedEvent } from '@/server/feed/emit';
import { resetDb } from '@/test/db';
import { makeMembership } from '@/test/factories';

describe('emitFeedEvent', () => {
  beforeEach(resetDb);

  it('writes an event and reports that it applied', async () => {
    const membership = await makeMembership();
    const occurredAt = new Date('2026-09-06T18:30:00Z');

    const result = await db.transaction((tx) =>
      emitFeedEvent(tx, {
        seasonId: membership.seasonId,
        type: 'MEMBER_JOINED',
        subjectMembershipId: membership.id,
        dedupeKey: `membership:${membership.id}:joined`,
        payload: { startingBankrollCents: '1000000' },
        occurredAt,
      }),
    );

    expect(result.applied).toBe(true);
    expect(result.eventId).not.toBeNull();

    const [row] = await db.select().from(feedEvents).where(eq(feedEvents.id, result.eventId!));
    expect(row.type).toBe('MEMBER_JOINED');
    expect(row.occurredAt).toEqual(occurredAt);
    expect(row.payload).toEqual({ startingBankrollCents: '1000000' });
  });

  it('is a no-op on a repeated dedupe key', async () => {
    const membership = await makeMembership();
    const input = {
      seasonId: membership.seasonId,
      type: 'MEMBER_JOINED' as const,
      subjectMembershipId: membership.id,
      dedupeKey: `membership:${membership.id}:joined`,
      payload: { startingBankrollCents: '1000000' },
      occurredAt: new Date(),
    };

    const first = await db.transaction((tx) => emitFeedEvent(tx, input));
    const second = await db.transaction((tx) => emitFeedEvent(tx, input));

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(second.eventId).toBeNull();

    const rows = await db.select().from(feedEvents);
    expect(rows).toHaveLength(1);
  });

  it('defaults occurredAt to now when the caller has no business time', async () => {
    const membership = await makeMembership();
    const before = Date.now();

    const result = await db.transaction((tx) =>
      emitFeedEvent(tx, {
        seasonId: membership.seasonId,
        type: 'ALLOWANCE_PAID',
        dedupeKey: 'allowance:x:2026-W36',
        payload: { weekKey: '2026-W36', memberCount: 1, amountCents: '50000' },
      }),
    );

    const [row] = await db.select().from(feedEvents).where(eq(feedEvents.id, result.eventId!));
    expect(row.occurredAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- src/server/feed/__tests__/emit.test.ts`
Expected: FAIL — cannot resolve `@/server/feed/emit`.

- [ ] **Step 3: Write the payload types**

Create `src/server/feed/payload.ts`:

```ts
/**
 * What a feed card renders, frozen at the moment the event happened.
 *
 * Money is a decimal string, never a JSON number: `JSON.stringify` throws on a `bigint` and
 * a `number` silently loses precision past 2^53. A string round-trips through `BigInt()`
 * exactly, which keeps D17 true inside jsonb as well as in columns (D25).
 */
export interface FeedLegSnapshot {
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

/** A leg's graded outcome — the engine's `BetStatus` values minus `PENDING`. */
export type LegOutcome = 'WON' | 'LOST' | 'PUSHED' | 'VOIDED';

export interface BetPlacedPayload {
  betType: 'SINGLE' | 'PARLAY';
  stakeCents: string;
  potentialPayoutCents: string;
  combinedPriceAmerican: number;
  legs: FeedLegSnapshot[];
}

export interface BetSettledPayload extends BetPlacedPayload {
  outcome: 'WON' | 'LOST' | 'PUSHED' | 'VOIDED';
  /** "0" for a loss — the stake left the balance at placement and nothing comes back. */
  payoutCents: string;
  netCents: string;
  legOutcomes: LegOutcome[];
  settlementAttempt: number;
  correction: boolean;
}

export interface MemberJoinedPayload {
  startingBankrollCents: string;
}

export interface AllowancePaidPayload {
  weekKey: string;
  memberCount: number;
  amountCents: string;
}

export interface AdminAdjustmentPayload {
  amountCents: string;
  note: string;
  adminDisplayName: string;
}

export interface LeadChangePayload {
  sequence: number;
  previousLeaderMembershipId: string | null;
  previousLeaderDisplayName: string | null;
  balanceCents: string;
  marginCents: string;
}

export interface BigWinPayload {
  stakeCents: string;
  payoutCents: string;
  /** payout × 10000 / stake, as integer BigInt division. 124000 renders as "12.4×". */
  multipleBasisPoints: number;
}

export interface ParlayHitPayload {
  legCount: number;
  payoutCents: string;
  combinedPriceAmerican: number;
}

/** The union stored in `feed_events.payload`, discriminated by the row's `type` column. */
export type FeedEventPayload =
  | BetPlacedPayload
  | BetSettledPayload
  | MemberJoinedPayload
  | AllowancePaidPayload
  | AdminAdjustmentPayload
  | LeadChangePayload
  | BigWinPayload
  | ParlayHitPayload;
```

- [ ] **Step 4: Write the emitter**

Create `src/server/feed/emit.ts`:

```ts
import type { Tx } from '@/db/client';
import { feedEvents, type FeedEventType } from '@/db/schema';
import type { FeedEventPayload } from './payload';

export interface EmitFeedEventInput {
  seasonId: string;
  type: FeedEventType;
  /** Deterministic. Two calls describing the same fact must produce the same key. */
  dedupeKey: string;
  payload: FeedEventPayload;
  /** Null only for season-wide events (ALLOWANCE_PAID). */
  subjectMembershipId?: string;
  betId?: string;
  ledgerEntryId?: string;
  /** Business time. Defaults to now when the caller has no better answer. */
  occurredAt?: Date;
}

export interface EmitFeedEventResult {
  applied: boolean;
  eventId: string | null;
}

/**
 * The single write path for every feed event.
 *
 * Takes a `tx` rather than opening its own, deliberately: an event that commits separately
 * from the change it describes can succeed when the bet fails, producing a feed that lies.
 * Inside the transaction this is one INSERT with no joins and no computation, so the only
 * way it fails is a database that is unavailable — in which case the bet must not commit
 * either. Same argument `postEntry` already makes for the ledger (D23).
 */
export async function emitFeedEvent(
  tx: Tx,
  input: EmitFeedEventInput,
): Promise<EmitFeedEventResult> {
  const inserted = await tx
    .insert(feedEvents)
    .values({
      seasonId: input.seasonId,
      type: input.type,
      subjectMembershipId: input.subjectMembershipId,
      betId: input.betId,
      ledgerEntryId: input.ledgerEntryId,
      payload: input.payload,
      dedupeKey: input.dedupeKey,
      occurredAt: input.occurredAt ?? new Date(),
    })
    .onConflictDoNothing({ target: feedEvents.dedupeKey })
    .returning({ id: feedEvents.id });

  if (inserted.length === 0) return { applied: false, eventId: null };
  return { applied: true, eventId: inserted[0].id };
}
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `npm test -- src/server/feed/__tests__/emit.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add src/server/feed/
git commit -m "feat: add the feed event emitter"
```

---

### Task 3: Profile statistics (pure)

**Files:**

- Create: `src/domain/stats.ts`
- Test: `src/domain/__tests__/stats.test.ts`

**Interfaces:**

- Consumes: `BetStatus` from `@/db/schema`.
- Produces: `interface BetOutcomeRow`, `interface MemberStats`, `computeMemberStats(rows: BetOutcomeRow[]): MemberStats`.

This file performs no I/O. It takes values and returns values, which is what makes it exhaustively testable without a database — the same rule the grading engine already follows.

- [ ] **Step 1: Write the failing test**

Create `src/domain/__tests__/stats.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeMemberStats, type BetOutcomeRow } from '@/domain/stats';

const at = (iso: string) => new Date(iso);

function row(overrides: Partial<BetOutcomeRow> = {}): BetOutcomeRow {
  return {
    status: 'WON',
    stakeCents: 10_000n,
    payoutCents: 19_091n,
    settledAt: at('2026-09-06T20:00:00Z'),
    ...overrides,
  };
}

describe('computeMemberStats', () => {
  it('returns a zeroed shape for an empty history', () => {
    const stats = computeMemberStats([]);
    expect(stats.settled).toBe(0);
    expect(stats.netCents).toBe(0n);
    expect(stats.roiBasisPoints).toBeNull();
    expect(stats.currentStreak).toEqual({ kind: 'NONE', length: 0 });
    expect(stats.biggestWinCents).toBe(0n);
  });

  it('counts pending bets separately and never as action', () => {
    const stats = computeMemberStats([
      row({ status: 'PENDING', payoutCents: 0n, settledAt: null }),
    ]);
    expect(stats.pending).toBe(1);
    expect(stats.pendingStakeCents).toBe(10_000n);
    expect(stats.settled).toBe(0);
    expect(stats.stakedCents).toBe(0n);
    expect(stats.roiBasisPoints).toBeNull();
  });

  it('nets a win against a loss', () => {
    const stats = computeMemberStats([
      row({ status: 'WON', stakeCents: 10_000n, payoutCents: 19_091n }),
      row({ status: 'LOST', stakeCents: 10_000n, payoutCents: 0n }),
    ]);
    expect(stats.won).toBe(1);
    expect(stats.lost).toBe(1);
    expect(stats.stakedCents).toBe(20_000n);
    expect(stats.returnedCents).toBe(19_091n);
    expect(stats.netCents).toBe(-909n);
    // -909 × 10000 / 20000 = -454 basis points = -4.54%
    expect(stats.roiBasisPoints).toBe(-454);
  });

  it('counts a push in both staked and returned, leaving ROI unmoved', () => {
    const stats = computeMemberStats([
      row({ status: 'PUSHED', stakeCents: 10_000n, payoutCents: 10_000n }),
    ]);
    expect(stats.pushed).toBe(1);
    expect(stats.stakedCents).toBe(10_000n);
    expect(stats.returnedCents).toBe(10_000n);
    expect(stats.roiBasisPoints).toBe(0);
  });

  it('excludes a voided bet from staked entirely', () => {
    const stats = computeMemberStats([
      row({ status: 'WON', stakeCents: 10_000n, payoutCents: 20_000n }),
      row({ status: 'VOIDED', stakeCents: 90_000n, payoutCents: 90_000n }),
    ]);
    expect(stats.voided).toBe(1);
    // The void never happened as far as ROI is concerned: 10000 net on 10000 staked.
    expect(stats.stakedCents).toBe(10_000n);
    expect(stats.netCents).toBe(10_000n);
    expect(stats.roiBasisPoints).toBe(10_000);
  });

  it('breaks a streak on a loss but not on a push', () => {
    const stats = computeMemberStats([
      row({ status: 'WON', settledAt: at('2026-09-01T20:00:00Z') }),
      row({ status: 'WON', settledAt: at('2026-09-02T20:00:00Z') }),
      row({ status: 'PUSHED', payoutCents: 10_000n, settledAt: at('2026-09-03T20:00:00Z') }),
      row({ status: 'WON', settledAt: at('2026-09-04T20:00:00Z') }),
    ]);
    expect(stats.currentStreak).toEqual({ kind: 'W', length: 3 });
  });

  it('reports a losing streak from the most recent settlement backward', () => {
    const stats = computeMemberStats([
      row({ status: 'WON', settledAt: at('2026-09-01T20:00:00Z') }),
      row({ status: 'LOST', payoutCents: 0n, settledAt: at('2026-09-02T20:00:00Z') }),
      row({ status: 'LOST', payoutCents: 0n, settledAt: at('2026-09-03T20:00:00Z') }),
    ]);
    expect(stats.currentStreak).toEqual({ kind: 'L', length: 2 });
  });

  it('takes the biggest win as net profit, not gross payout', () => {
    const stats = computeMemberStats([
      row({ status: 'WON', stakeCents: 100_000n, payoutCents: 120_000n }), // +20,000
      row({ status: 'WON', stakeCents: 1_000n, payoutCents: 51_000n }), //   +50,000
    ]);
    expect(stats.biggestWinCents).toBe(50_000n);
  });

  it('does not depend on input order when computing streaks', () => {
    const rows = [
      row({ status: 'LOST', payoutCents: 0n, settledAt: at('2026-09-03T20:00:00Z') }),
      row({ status: 'WON', settledAt: at('2026-09-01T20:00:00Z') }),
      row({ status: 'LOST', payoutCents: 0n, settledAt: at('2026-09-02T20:00:00Z') }),
    ];
    expect(computeMemberStats(rows).currentStreak).toEqual({ kind: 'L', length: 2 });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- src/domain/__tests__/stats.test.ts`
Expected: FAIL — cannot resolve `@/domain/stats`.

- [ ] **Step 3: Write the implementation**

Create `src/domain/stats.ts`:

```ts
import type { BetStatus } from '@/db/schema';

export interface BetOutcomeRow {
  status: BetStatus;
  stakeCents: bigint;
  /** What settlement returned. 0 for PENDING and for LOST. */
  payoutCents: bigint;
  settledAt: Date | null;
}

export interface MemberStats {
  pending: number;
  pendingStakeCents: bigint;
  settled: number;
  won: number;
  lost: number;
  pushed: number;
  voided: number;
  stakedCents: bigint;
  returnedCents: bigint;
  netCents: bigint;
  /** net × 10000 / staked, integer. Null when nothing was staked. */
  roiBasisPoints: number | null;
  currentStreak: { kind: 'W' | 'L' | 'NONE'; length: number };
  biggestWinCents: bigint;
}

/**
 * Season statistics for one member, from their bets.
 *
 * Three definitions worth knowing, each chosen over a defensible alternative:
 *
 * - VOIDED bets are excluded from `stakedCents`. The game never happened and the stake came
 *   back in full; counting it as action drags ROI toward zero for reasons that have nothing
 *   to do with betting.
 * - PUSHED bets are included in both staked and returned, so they are ROI-neutral rather
 *   than invisible. A push is a result — you had action and got your money back.
 * - Streaks count only WON and LOST. A push does not end a hot run.
 */
export function computeMemberStats(rows: BetOutcomeRow[]): MemberStats {
  const stats: MemberStats = {
    pending: 0,
    pendingStakeCents: 0n,
    settled: 0,
    won: 0,
    lost: 0,
    pushed: 0,
    voided: 0,
    stakedCents: 0n,
    returnedCents: 0n,
    netCents: 0n,
    roiBasisPoints: null,
    currentStreak: { kind: 'NONE', length: 0 },
    biggestWinCents: 0n,
  };

  for (const row of rows) {
    if (row.status === 'PENDING') {
      stats.pending += 1;
      stats.pendingStakeCents += row.stakeCents;
      continue;
    }

    stats.settled += 1;

    switch (row.status) {
      case 'WON': {
        stats.won += 1;
        const profit = row.payoutCents - row.stakeCents;
        if (profit > stats.biggestWinCents) stats.biggestWinCents = profit;
        break;
      }
      case 'LOST':
        stats.lost += 1;
        break;
      case 'PUSHED':
        stats.pushed += 1;
        break;
      case 'VOIDED':
        stats.voided += 1;
        break;
    }

    // A void is not action. Everything else is.
    if (row.status !== 'VOIDED') {
      stats.stakedCents += row.stakeCents;
      stats.returnedCents += row.payoutCents;
    }
  }

  stats.netCents = stats.returnedCents - stats.stakedCents;

  if (stats.stakedCents > 0n) {
    // Integer basis points, BigInt throughout — no float ever touches a money-derived value.
    stats.roiBasisPoints = Number((stats.netCents * 10_000n) / stats.stakedCents);
  }

  stats.currentStreak = computeStreak(rows);
  return stats;
}

/** Walks decided bets newest-first, skipping pushes and voids rather than breaking on them. */
function computeStreak(rows: BetOutcomeRow[]): MemberStats['currentStreak'] {
  const decided = rows
    .filter((row) => (row.status === 'WON' || row.status === 'LOST') && row.settledAt !== null)
    .sort((a, b) => b.settledAt!.getTime() - a.settledAt!.getTime());

  if (decided.length === 0) return { kind: 'NONE', length: 0 };

  const kind = decided[0].status === 'WON' ? 'W' : 'L';
  let length = 0;
  for (const row of decided) {
    const rowKind = row.status === 'WON' ? 'W' : 'L';
    if (rowKind !== kind) break;
    length += 1;
  }

  return { kind, length };
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test -- src/domain/__tests__/stats.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/stats.ts src/domain/__tests__/stats.test.ts
git commit -m "feat: add member season statistics"
```

---

### Task 4: Milestone thresholds (pure)

**Files:**

- Create: `src/domain/milestones.ts`
- Test: `src/domain/__tests__/milestones.test.ts`

**Interfaces:**

- Consumes: `LegOutcome` from `@/server/feed/payload`.
- Produces:
  - `BIG_WIN_MULTIPLE = 10n`
  - `PARLAY_HIT_MIN_LEGS = 4`
  - `isBigWin(stakeCents: bigint, payoutCents: bigint): boolean`
  - `multipleBasisPoints(stakeCents: bigint, payoutCents: bigint): number`
  - `isParlayHit(betType: 'SINGLE' | 'PARLAY', outcome: string, legOutcomes: LegOutcome[]): boolean`
  - `survivingLegCount(legOutcomes: LegOutcome[]): number`
  - `pickLeader(rows: LeaderRow[]): LeaderRow | null` and `interface LeaderRow { membershipId: string; balanceCents: bigint }`

- [ ] **Step 1: Write the failing test**

Create `src/domain/__tests__/milestones.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  isBigWin,
  isParlayHit,
  multipleBasisPoints,
  pickLeader,
  survivingLegCount,
} from '@/domain/milestones';

describe('isBigWin', () => {
  it('fires at exactly ten times the stake', () => {
    expect(isBigWin(10_000n, 100_000n)).toBe(true);
  });

  it('does not fire just under ten times', () => {
    expect(isBigWin(10_000n, 99_999n)).toBe(false);
  });

  it('does not fire on a zero payout', () => {
    expect(isBigWin(10_000n, 0n)).toBe(false);
  });

  it('does not divide by zero on a zero stake', () => {
    expect(isBigWin(0n, 100_000n)).toBe(false);
  });
});

describe('multipleBasisPoints', () => {
  it('reports 12.4x as 124000 basis points', () => {
    expect(multipleBasisPoints(5_000n, 62_000n)).toBe(124_000);
  });

  it('truncates rather than rounding, and never returns a float', () => {
    const bp = multipleBasisPoints(3n, 10n);
    expect(bp).toBe(33_333);
    expect(Number.isInteger(bp)).toBe(true);
  });

  it('returns 0 for a zero stake instead of Infinity', () => {
    expect(multipleBasisPoints(0n, 10_000n)).toBe(0);
  });
});

describe('survivingLegCount', () => {
  it('counts only legs that were not removed', () => {
    expect(survivingLegCount(['WON', 'WON', 'PUSHED', 'VOIDED', 'WON'])).toBe(3);
  });
});

describe('isParlayHit', () => {
  it('fires on a won parlay with four surviving legs', () => {
    expect(isParlayHit('PARLAY', 'WON', ['WON', 'WON', 'WON', 'WON'])).toBe(true);
  });

  it('does not fire on three surviving legs', () => {
    expect(isParlayHit('PARLAY', 'WON', ['WON', 'WON', 'WON'])).toBe(false);
  });

  it('does not fire when pushes reduce a five-leg parlay below the threshold', () => {
    expect(isParlayHit('PARLAY', 'WON', ['WON', 'WON', 'WON', 'PUSHED', 'PUSHED'])).toBe(false);
  });

  it('never fires on a single', () => {
    expect(isParlayHit('SINGLE', 'WON', ['WON'])).toBe(false);
  });

  it('never fires on a parlay that did not win', () => {
    expect(isParlayHit('PARLAY', 'LOST', ['WON', 'WON', 'WON', 'LOST'])).toBe(false);
  });
});

describe('pickLeader', () => {
  it('returns the single highest balance', () => {
    const leader = pickLeader([
      { membershipId: 'a', balanceCents: 100n },
      { membershipId: 'b', balanceCents: 300n },
      { membershipId: 'c', balanceCents: 200n },
    ]);
    expect(leader?.membershipId).toBe('b');
  });

  it('returns null when the top balance is tied — a tie has no leader', () => {
    expect(
      pickLeader([
        { membershipId: 'a', balanceCents: 300n },
        { membershipId: 'b', balanceCents: 300n },
      ]),
    ).toBeNull();
  });

  it('returns null for an empty season', () => {
    expect(pickLeader([])).toBeNull();
  });

  it('returns the only member when there is exactly one', () => {
    expect(pickLeader([{ membershipId: 'a', balanceCents: 1n }])?.membershipId).toBe('a');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- src/domain/__tests__/milestones.test.ts`
Expected: FAIL — cannot resolve `@/domain/milestones`.

- [ ] **Step 3: Write the implementation**

Create `src/domain/milestones.ts`:

```ts
import type { LegOutcome } from '@/server/feed/payload';

/** A win paying ten times the stake or better is worth telling the league about. */
export const BIG_WIN_MULTIPLE = 10n;

/** Four surviving legs is where a parlay stops being routine. */
export const PARLAY_HIT_MIN_LEGS = 4;

export function isBigWin(stakeCents: bigint, payoutCents: bigint): boolean {
  if (stakeCents <= 0n) return false;
  return payoutCents >= stakeCents * BIG_WIN_MULTIPLE;
}

/**
 * The payout multiple in integer basis points — 124000 means 12.4x.
 *
 * Basis points rather than a float because D17 holds for display values too: no
 * floating-point value goes anywhere near money, including in a card's headline.
 */
export function multipleBasisPoints(stakeCents: bigint, payoutCents: bigint): number {
  if (stakeCents <= 0n) return 0;
  return Number((payoutCents * 10_000n) / stakeCents);
}

/** Pushed and voided legs are removed from a parlay (D12), so they do not survive. */
export function survivingLegCount(legOutcomes: LegOutcome[]): number {
  return legOutcomes.filter((outcome) => outcome === 'WON' || outcome === 'LOST').length;
}

export function isParlayHit(
  betType: 'SINGLE' | 'PARLAY',
  outcome: string,
  legOutcomes: LegOutcome[],
): boolean {
  if (betType !== 'PARLAY' || outcome !== 'WON') return false;
  return survivingLegCount(legOutcomes) >= PARLAY_HIT_MIN_LEGS;
}

export interface LeaderRow {
  membershipId: string;
  balanceCents: bigint;
}

/**
 * The season's leader, or null when there isn't one.
 *
 * A tie at the top returns null on purpose. At season start every member holds the same
 * bankroll, and the feed should not open with a coin-flip "X takes the lead" that flips
 * again on the next sweep.
 */
export function pickLeader(rows: LeaderRow[]): LeaderRow | null {
  if (rows.length === 0) return null;

  let best = rows[0];
  let tied = false;

  for (const row of rows.slice(1)) {
    if (row.balanceCents > best.balanceCents) {
      best = row;
      tied = false;
    } else if (row.balanceCents === best.balanceCents) {
      tied = true;
    }
  }

  return tied ? null : best;
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test -- src/domain/__tests__/milestones.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/milestones.ts src/domain/__tests__/milestones.test.ts
git commit -m "feat: add milestone thresholds"
```

---

### Task 5: Emit `BET_PLACED` from `placeBet`

**Files:**

- Create: `src/server/feed/snapshot.ts`
- Create: `src/server/feed/__tests__/snapshot.test.ts`
- Modify: `src/server/bets/validate.ts` — `LoadedSelection` gains three columns
- Modify: `src/server/bets/place.ts` — `loadSelections` selects them; emit after `postEntry`
- Test: `src/server/feed/__tests__/place-emission.test.ts`

**Interfaces:**

- Consumes: `emitFeedEvent` (Task 2), `FeedLegSnapshot`/`BetPlacedPayload` (Task 2).
- Produces:
  - `interface SnapshotSource { sport; marketType; side; homeAbbr; awayAbbr; startsAt: Date }`
  - `buildLegSnapshot(source: SnapshotSource, frozen: { line: string | null; priceAmerican: number }): FeedLegSnapshot`
  - `LoadedSelection` now also carries `sport: Sport`, `homeAbbr: string`, `awayAbbr: string`.

The snapshot needs team abbreviations and sport, which `loadSelections` does not currently select. It gains them through two aliased joins to `teams` rather than paying for a second query inside the placement transaction — placement holds a row lock while it runs, so an extra round trip there is a real cost.

- [ ] **Step 1: Write the failing snapshot test**

Create `src/server/feed/__tests__/snapshot.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildLegSnapshot } from '@/server/feed/snapshot';

describe('buildLegSnapshot', () => {
  const source = {
    sport: 'NFL' as const,
    marketType: 'SPREAD' as const,
    side: 'HOME' as const,
    homeAbbr: 'KC',
    awayAbbr: 'BUF',
    startsAt: new Date('2026-09-06T17:00:00Z'),
  };

  it('takes the line and price from the frozen values, not from the source row', () => {
    const snapshot = buildLegSnapshot(source, { line: '-3.50', priceAmerican: -115 });

    expect(snapshot.line).toBe('-3.50');
    expect(snapshot.priceAmerican).toBe(-115);
    expect(snapshot.homeAbbr).toBe('KC');
    expect(snapshot.awayAbbr).toBe('BUF');
    expect(snapshot.marketType).toBe('SPREAD');
  });

  it('serializes the kickoff as an ISO string so it survives jsonb', () => {
    const snapshot = buildLegSnapshot(source, { line: null, priceAmerican: -110 });
    expect(snapshot.startsAt).toBe('2026-09-06T17:00:00.000Z');
  });

  it('keeps a null line for a moneyline leg', () => {
    const snapshot = buildLegSnapshot(
      { ...source, marketType: 'MONEYLINE' },
      { line: null, priceAmerican: 150 },
    );
    expect(snapshot.line).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npm test -- src/server/feed/__tests__/snapshot.test.ts`
Expected: FAIL — cannot resolve `@/server/feed/snapshot`.

- [ ] **Step 3: Write the snapshot builder**

Create `src/server/feed/snapshot.ts`:

```ts
import type { Sport } from '@/db/schema';
import type { FeedLegSnapshot } from './payload';

export interface SnapshotSource {
  sport: Sport;
  marketType: 'MONEYLINE' | 'SPREAD' | 'TOTAL';
  side: 'HOME' | 'AWAY' | 'OVER' | 'UNDER';
  homeAbbr: string;
  awayAbbr: string;
  startsAt: Date;
}

/**
 * Builds one card's leg snapshot.
 *
 * The split matters: market and team facts come from the source row, but `line` and
 * `priceAmerican` come from `frozen` — the leg's `line_at_placement` and
 * `price_at_placement`. Reading the live selection instead would let later line movement
 * rewrite an old card, which is exactly what D10 exists to prevent.
 */
export function buildLegSnapshot(
  source: SnapshotSource,
  frozen: { line: string | null; priceAmerican: number },
): FeedLegSnapshot {
  return {
    sport: source.sport,
    marketType: source.marketType,
    side: source.side,
    line: frozen.line,
    priceAmerican: frozen.priceAmerican,
    homeAbbr: source.homeAbbr,
    awayAbbr: source.awayAbbr,
    startsAt: source.startsAt.toISOString(),
  };
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `npm test -- src/server/feed/__tests__/snapshot.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the failing emission test**

Create `src/server/feed/__tests__/place-emission.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedEvents } from '@/db/schema';
import { placeBet } from '@/server/bets/place';
import type { BetPlacedPayload } from '@/server/feed/payload';
import { resetDb } from '@/test/db';
import { makeMembership, seedBettableGame } from '@/server/bets/__tests__/helpers';

describe('placeBet feed emission', () => {
  beforeEach(resetDb);

  it('writes one BET_PLACED event whose payload matches the frozen leg', async () => {
    const { membership, user, seasonId } = await makeMembership();
    const game = await seedBettableGame();

    const result = await placeBet({
      userId: user.id,
      type: 'SINGLE',
      stakeCents: 10_000n,
      legs: [{ selectionId: game.spread.home, line: '-3.50', priceAmerican: -110 }],
      clientRequestId: randomUUID(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const events = await db.select().from(feedEvents).where(eq(feedEvents.seasonId, seasonId));
    expect(events).toHaveLength(1);

    const event = events[0];
    expect(event.type).toBe('BET_PLACED');
    expect(event.subjectMembershipId).toBe(membership.id);
    expect(event.betId).toBe(result.bet.id);
    expect(event.dedupeKey).toBe(`bet:${result.bet.id}:placed`);

    const payload = event.payload as BetPlacedPayload;
    expect(payload.betType).toBe('SINGLE');
    expect(payload.stakeCents).toBe('10000');
    expect(payload.legs).toHaveLength(1);
    expect(payload.legs[0].line).toBe('-3.50');
    expect(payload.legs[0].priceAmerican).toBe(-110);
    expect(payload.legs[0].marketType).toBe('SPREAD');
    expect(payload.legs[0].homeAbbr).toEqual(expect.any(String));
  });

  it('writes one event per leg of a parlay inside a single payload', async () => {
    const { user } = await makeMembership();
    const first = await seedBettableGame();
    const second = await seedBettableGame();

    const result = await placeBet({
      userId: user.id,
      type: 'PARLAY',
      stakeCents: 5_000n,
      legs: [
        { selectionId: first.moneyline.home, line: null, priceAmerican: -110 },
        { selectionId: second.total.over, line: '44.50', priceAmerican: -110 },
      ],
      clientRequestId: randomUUID(),
    });

    expect(result.ok).toBe(true);

    const events = await db.select().from(feedEvents);
    expect(events).toHaveLength(1);
    expect((events[0].payload as BetPlacedPayload).legs).toHaveLength(2);
  });

  it('writes no event when placement is rejected', async () => {
    const { user } = await makeMembership(500n);
    const game = await seedBettableGame();

    const result = await placeBet({
      userId: user.id,
      type: 'SINGLE',
      stakeCents: 100_000n, // more than the balance
      legs: [{ selectionId: game.moneyline.home, line: null, priceAmerican: -110 }],
      clientRequestId: randomUUID(),
    });

    expect(result.ok).toBe(false);
    expect(await db.select().from(feedEvents)).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Run it and verify it fails**

Run: `npm test -- src/server/feed/__tests__/place-emission.test.ts`
Expected: FAIL — 0 events found, because nothing emits yet.

- [ ] **Step 7: Extend `LoadedSelection`**

In `src/server/bets/validate.ts`, add a `Sport` import and three fields to the interface. Leave every other line alone:

```ts
import type { Sport } from '@/db/schema';
```

```ts
export interface LoadedSelection {
  selectionId: string;
  marketId: string;
  marketType: MarketType;
  marketStatus: 'OPEN' | 'SUSPENDED' | 'SETTLED';
  side: Side;
  line: string | null;
  priceAmerican: number;
  gameId: string;
  gameStatus: string;
  gameStartsAt: Date;
  // Carried for the feed card's frozen snapshot, not for validation.
  sport: Sport;
  homeAbbr: string;
  awayAbbr: string;
}
```

- [ ] **Step 8: Select the new columns in `loadSelections`**

In `src/server/bets/place.ts`, add these imports:

```ts
import { alias } from 'drizzle-orm/pg-core';
import { teams } from '@/db/schema';
import { emitFeedEvent } from '@/server/feed/emit';
import { buildLegSnapshot } from '@/server/feed/snapshot';
import type { BetPlacedPayload } from '@/server/feed/payload';
```

Then replace the body of `loadSelections`' query with the joined version. `teams` is joined twice, so it needs two aliases:

```ts
const homeTeams = alias(teams, 'home_teams');
const awayTeams = alias(teams, 'away_teams');

async function loadSelections(
  reader: Reader,
  input: PlaceBetInput,
): Promise<(LoadedSelection | null)[]> {
  const ids = [...new Set(input.legs.map((leg) => leg.selectionId))];
  if (ids.length === 0) return [];

  const rows = await reader
    .select({
      selectionId: selections.id,
      marketId: markets.id,
      marketType: markets.type,
      marketStatus: markets.status,
      side: selections.side,
      line: selections.line,
      priceAmerican: selections.priceAmerican,
      gameId: games.id,
      gameStatus: games.status,
      gameStartsAt: games.startsAt,
      sport: games.sport,
      homeAbbr: homeTeams.abbreviation,
      awayAbbr: awayTeams.abbreviation,
    })
    .from(selections)
    .innerJoin(markets, eq(selections.marketId, markets.id))
    .innerJoin(games, eq(markets.gameId, games.id))
    .innerJoin(homeTeams, eq(games.homeTeamId, homeTeams.id))
    .innerJoin(awayTeams, eq(games.awayTeamId, awayTeams.id))
    .where(inArray(selections.id, ids));

  const bySelectionId = new Map(rows.map((row) => [row.selectionId, row as LoadedSelection]));

  // Aligned 1:1 with input.legs in submission order — validatePlacement asserts this.
  return input.legs.map((leg) => bySelectionId.get(leg.selectionId) ?? null);
}
```

- [ ] **Step 9: Return `placedAt` from the insert, then emit**

Still in `src/server/bets/place.ts`, change the bet insert's `returning` to include the timestamp:

```ts
        .returning({ id: bets.id, placedAt: bets.placedAt });
```

and capture it next to `betId`:

```ts
const betId = inserted[0].id;
const placedAt = inserted[0].placedAt;
```

Then, immediately after the existing `postEntry` call and before the `return`, add the emit:

```ts
const payload: BetPlacedPayload = {
  betType: input.type,
  stakeCents: input.stakeCents.toString(),
  potentialPayoutCents: freshQuote.potentialPayoutCents.toString(),
  combinedPriceAmerican: freshQuote.combinedPriceAmerican,
  legs: input.legs.map((_leg, i) =>
    buildLegSnapshot(freshSelections[i], {
      line: freshSelections[i].line,
      priceAmerican: freshSelections[i].priceAmerican,
    }),
  ),
};

await emitFeedEvent(tx, {
  seasonId: fresh.activeSeasonId!,
  type: 'BET_PLACED',
  subjectMembershipId: fresh.membership!.id,
  betId,
  dedupeKey: `bet:${betId}:placed`,
  payload,
  occurredAt: placedAt,
});
```

`fresh.activeSeasonId` is non-null here because `validatePlacement` already rejected the request otherwise — the same reason the existing code writes `fresh.membership!`.

- [ ] **Step 10: Run the tests and verify they pass**

Run: `npm test -- src/server/feed/__tests__/place-emission.test.ts src/server/bets/`
Expected: PASS. The existing placement tests must be unaffected — if any fail, the extra joins changed which selections load, which means a game is missing a team row in a fixture.

- [ ] **Step 11: Verify and commit**

Run: `npm run verify`
Expected: PASS.

```bash
git add src/server/feed/ src/server/bets/place.ts src/server/bets/validate.ts
git commit -m "feat: post a feed card when a bet is placed"
```

---

### Task 6: Emit `BET_SETTLED` and the two per-bet milestones from `settleGame`

**Files:**

- Modify: `src/server/bets/settle.ts`
- Test: `src/server/feed/__tests__/settle-emission.test.ts`

**Interfaces:**

- Consumes: `emitFeedEvent`, `buildLegSnapshot`, `BetSettledPayload`, `BigWinPayload`, `ParlayHitPayload`, `isBigWin`, `isParlayHit`, `multipleBasisPoints`, `survivingLegCount`.
- Produces: no new exports. `settleGame`'s existing `SettleGameSummary` return type is unchanged.

- [ ] **Step 1: Write the failing test**

Create `src/server/feed/__tests__/settle-emission.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedEvents, games } from '@/db/schema';
import { placeBet } from '@/server/bets/place';
import { settleFinalGames, settleGame } from '@/server/bets/settle';
import type { BetSettledPayload, BigWinPayload } from '@/server/feed/payload';
import { resetDb } from '@/test/db';
import { makeMembership, seedBettableGame } from '@/server/bets/__tests__/helpers';

async function finalize(gameId: string, homeScore: number, awayScore: number) {
  await db.update(games).set({ status: 'FINAL', homeScore, awayScore }).where(eq(games.id, gameId));
}

describe('settleGame feed emission', () => {
  beforeEach(resetDb);

  it('posts a BET_SETTLED card carrying the outcome and payout', async () => {
    const { user } = await makeMembership();
    const game = await seedBettableGame();

    const placed = await placeBet({
      userId: user.id,
      type: 'SINGLE',
      stakeCents: 10_000n,
      legs: [{ selectionId: game.moneyline.home, line: null, priceAmerican: -110 }],
      clientRequestId: randomUUID(),
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    await finalize(game.game.id, 27, 20);
    await settleGame(game.game.id);

    const settled = await db.select().from(feedEvents).where(eq(feedEvents.type, 'BET_SETTLED'));

    expect(settled).toHaveLength(1);
    expect(settled[0].dedupeKey).toBe(`bet:${placed.bet.id}:settled:1`);

    const payload = settled[0].payload as BetSettledPayload;
    expect(payload.outcome).toBe('WON');
    expect(payload.payoutCents).toBe('19091');
    expect(payload.netCents).toBe('9091');
    expect(payload.legOutcomes).toEqual(['WON']);
    expect(payload.correction).toBe(false);
    expect(payload.settlementAttempt).toBe(1);
  });

  it('records a loss with a zero payout and a negative net', async () => {
    const { user } = await makeMembership();
    const game = await seedBettableGame();

    await placeBet({
      userId: user.id,
      type: 'SINGLE',
      stakeCents: 10_000n,
      legs: [{ selectionId: game.moneyline.home, line: null, priceAmerican: -110 }],
      clientRequestId: randomUUID(),
    });

    await finalize(game.game.id, 17, 24);
    await settleGame(game.game.id);

    const [event] = await db.select().from(feedEvents).where(eq(feedEvents.type, 'BET_SETTLED'));
    const payload = event.payload as BetSettledPayload;
    expect(payload.outcome).toBe('LOST');
    expect(payload.payoutCents).toBe('0');
    expect(payload.netCents).toBe('-10000');
  });

  it('posts a big-win milestone alongside the settlement when the payout clears 10x', async () => {
    const { user } = await makeMembership();
    const game = await seedBettableGame();
    // +1200 on $100 returns $1,300 — thirteen times the stake.
    await db.update(games).set({ status: 'SCHEDULED' }).where(eq(games.id, game.game.id));
    const { setSelectionPrice } = await import('@/server/bets/__tests__/helpers');
    await setSelectionPrice(game.moneyline.home, 1200);

    await placeBet({
      userId: user.id,
      type: 'SINGLE',
      stakeCents: 10_000n,
      legs: [{ selectionId: game.moneyline.home, line: null, priceAmerican: 1200 }],
      clientRequestId: randomUUID(),
    });

    await finalize(game.game.id, 30, 3);
    await settleGame(game.game.id);

    const [milestone] = await db
      .select()
      .from(feedEvents)
      .where(eq(feedEvents.type, 'MILESTONE_BIG_WIN'));

    expect(milestone).toBeDefined();
    const payload = milestone.payload as BigWinPayload;
    expect(payload.payoutCents).toBe('130000');
    expect(payload.multipleBasisPoints).toBe(130_000);
  });

  it('posts no milestone on an ordinary win', async () => {
    const { user } = await makeMembership();
    const game = await seedBettableGame();

    await placeBet({
      userId: user.id,
      type: 'SINGLE',
      stakeCents: 10_000n,
      legs: [{ selectionId: game.moneyline.home, line: null, priceAmerican: -110 }],
      clientRequestId: randomUUID(),
    });

    await finalize(game.game.id, 27, 20);
    await settleGame(game.game.id);

    const milestones = await db
      .select()
      .from(feedEvents)
      .where(eq(feedEvents.type, 'MILESTONE_BIG_WIN'));
    expect(milestones).toHaveLength(0);
  });

  it('is idempotent: a second sweep adds no events', async () => {
    const { user } = await makeMembership();
    const game = await seedBettableGame();

    await placeBet({
      userId: user.id,
      type: 'SINGLE',
      stakeCents: 10_000n,
      legs: [{ selectionId: game.moneyline.home, line: null, priceAmerican: -110 }],
      clientRequestId: randomUUID(),
    });

    await finalize(game.game.id, 27, 20);

    await settleFinalGames();
    const afterFirst = await db.select().from(feedEvents).orderBy(asc(feedEvents.id));

    await settleFinalGames();
    const afterSecond = await db.select().from(feedEvents).orderBy(asc(feedEvents.id));

    expect(afterSecond).toEqual(afterFirst);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npm test -- src/server/feed/__tests__/settle-emission.test.ts`
Expected: FAIL — no `BET_SETTLED` events exist.

- [ ] **Step 3: Add the imports and the season join**

In `src/server/bets/settle.ts`, add:

```ts
import { alias } from 'drizzle-orm/pg-core';
import { seasonMemberships, teams } from '@/db/schema';
import { isBigWin, isParlayHit, multipleBasisPoints, survivingLegCount } from '@/domain/milestones';
import { emitFeedEvent } from '@/server/feed/emit';
import { buildLegSnapshot } from '@/server/feed/snapshot';
import type {
  BetSettledPayload,
  BigWinPayload,
  LegOutcome,
  ParlayHitPayload,
} from '@/server/feed/payload';

const homeTeams = alias(teams, 'settle_home_teams');
const awayTeams = alias(teams, 'settle_away_teams');
```

Replace the `candidates` query so it carries the season id and the columns the payload needs. It selects explicit columns now rather than the whole row:

```ts
const candidates =
  touchedBetIds.length === 0
    ? []
    : await tx
        .select({
          id: bets.id,
          membershipId: bets.membershipId,
          seasonId: seasonMemberships.seasonId,
          type: bets.type,
          stakeCents: bets.stakeCents,
          potentialPayoutCents: bets.potentialPayoutCents,
          combinedPriceAmerican: bets.combinedPriceAmerican,
          settlementAttempts: bets.settlementAttempts,
        })
        .from(bets)
        .innerJoin(seasonMemberships, eq(bets.membershipId, seasonMemberships.id))
        .where(and(inArray(bets.id, touchedBetIds), eq(bets.status, 'PENDING')))
        .orderBy(asc(bets.membershipId));
```

- [ ] **Step 4: Extend the per-bet legs query with snapshot columns**

Still inside the `for (const bet of candidates)` loop, replace the `legs` query:

```ts
const legs = await tx
  .select({
    status: betLegs.status,
    priceAtPlacement: betLegs.priceAtPlacement,
    lineAtPlacement: betLegs.lineAtPlacement,
    marketType: markets.type,
    side: selections.side,
    sport: games.sport,
    startsAt: games.startsAt,
    homeAbbr: homeTeams.abbreviation,
    awayAbbr: awayTeams.abbreviation,
  })
  .from(betLegs)
  .innerJoin(selections, eq(betLegs.selectionId, selections.id))
  .innerJoin(markets, eq(selections.marketId, markets.id))
  .innerJoin(games, eq(markets.gameId, games.id))
  .innerJoin(homeTeams, eq(games.homeTeamId, homeTeams.id))
  .innerJoin(awayTeams, eq(games.awayTeamId, awayTeams.id))
  .where(eq(betLegs.betId, bet.id))
  .orderBy(asc(betLegs.createdAt));
```

The `orderBy` is new and load-bearing: `legOutcomes` must be parallel to `legs` in the payload, and an unordered query does not guarantee that across two reads.

- [ ] **Step 5: Emit after the bet's status update**

Immediately after the existing `await tx.update(bets).set({ status: outcome, ... })` call and before `summary.betsSettled += 1`, add:

```ts
const legOutcomes = legs.map((leg) => leg.status as LegOutcome);

const settledPayload: BetSettledPayload = {
  betType: bet.type,
  stakeCents: bet.stakeCents.toString(),
  potentialPayoutCents: bet.potentialPayoutCents.toString(),
  combinedPriceAmerican: bet.combinedPriceAmerican,
  legs: legs.map((leg) =>
    buildLegSnapshot(leg, { line: leg.lineAtPlacement, priceAmerican: leg.priceAtPlacement }),
  ),
  outcome,
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
  occurredAt: settledAt,
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
    occurredAt: settledAt,
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
    occurredAt: settledAt,
  });
}
```

Note the milestone dedupe keys carry `attempts` for the same reason the settlement key does: a corrected settlement must be able to re-post without colliding.

- [ ] **Step 6: Run the tests and verify they pass**

Run: `npm test -- src/server/feed/__tests__/settle-emission.test.ts src/server/bets/`
Expected: PASS, including every pre-existing settlement test.

- [ ] **Step 7: Verify and commit**

Run: `npm run verify`
Expected: PASS.

```bash
git add src/server/bets/settle.ts src/server/feed/__tests__/settle-emission.test.ts
git commit -m "feat: post feed cards when bets settle"
```

---

### Task 7: Emit the corrected settlement from `resettleBet`

**Files:**

- Modify: `src/server/bets/resettle.ts`
- Test: `src/server/feed/__tests__/resettle-emission.test.ts`

**Interfaces:**

- Consumes: everything Task 6 consumed. No new exports.

- [ ] **Step 1: Write the failing test**

Create `src/server/feed/__tests__/resettle-emission.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedEvents, games } from '@/db/schema';
import { placeBet } from '@/server/bets/place';
import { resettleBet } from '@/server/bets/resettle';
import { settleGame } from '@/server/bets/settle';
import type { BetSettledPayload } from '@/server/feed/payload';
import { resetDb } from '@/test/db';
import { makeMembership, makeUser, seedBettableGame } from '@/server/bets/__tests__/helpers';

describe('resettleBet feed emission', () => {
  beforeEach(resetDb);

  it('posts a second card flagged as a correction and leaves the first intact', async () => {
    const { user } = await makeMembership();
    const admin = await makeUser({ role: 'ADMIN' });
    const game = await seedBettableGame();

    const placed = await placeBet({
      userId: user.id,
      type: 'SINGLE',
      stakeCents: 10_000n,
      legs: [{ selectionId: game.moneyline.home, line: null, priceAmerican: -110 }],
      clientRequestId: randomUUID(),
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    // Settle on a wrong score: home loses.
    await db
      .update(games)
      .set({ status: 'FINAL', homeScore: 17, awayScore: 24 })
      .where(eq(games.id, game.game.id));
    await settleGame(game.game.id);

    const [first] = await db.select().from(feedEvents).where(eq(feedEvents.type, 'BET_SETTLED'));
    expect((first.payload as BetSettledPayload).outcome).toBe('LOST');

    // The score was wrong: home actually won.
    await db.update(games).set({ homeScore: 27, awayScore: 20 }).where(eq(games.id, game.game.id));
    const result = await resettleBet({
      betId: placed.bet.id,
      actorUserId: admin.id,
      note: 'official score corrected',
    });
    expect(result.ok).toBe(true);

    const cards = await db
      .select()
      .from(feedEvents)
      .where(eq(feedEvents.type, 'BET_SETTLED'))
      .orderBy(asc(feedEvents.createdAt));

    expect(cards).toHaveLength(2);

    // The original is untouched — history is never edited (D15).
    expect(cards[0].id).toBe(first.id);
    expect((cards[0].payload as BetSettledPayload).outcome).toBe('LOST');
    expect((cards[0].payload as BetSettledPayload).correction).toBe(false);

    const corrected = cards[1].payload as BetSettledPayload;
    expect(corrected.outcome).toBe('WON');
    expect(corrected.correction).toBe(true);
    expect(corrected.settlementAttempt).toBe(2);
    expect(cards[1].dedupeKey).toBe(`bet:${placed.bet.id}:settled:2`);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npm test -- src/server/feed/__tests__/resettle-emission.test.ts`
Expected: FAIL — only one `BET_SETTLED` card exists.

- [ ] **Step 3: Read the file and mirror Task 6's emit block**

Open `src/server/bets/resettle.ts`. It already re-grades every leg and writes the corrected entry inside one transaction. Add the same imports Task 6 added to `settle.ts` (aliasing the teams as `resettle_home_teams` / `resettle_away_teams` to keep the SQL aliases distinct), extend its per-bet legs query with the same snapshot columns and `orderBy(asc(betLegs.createdAt))`, and add the same three emit calls after the bet's status update — using the `attempt` variable the file already computes.

Two differences from Task 6:

- `correction` is `attempt > 1`, which is always true here, so the corrected card always renders as a correction.
- The season id is not yet in scope. Add it to the file's existing `bet` load by joining `season_memberships`:

```ts
const [membership] = await tx
  .select({ seasonId: seasonMemberships.seasonId })
  .from(seasonMemberships)
  .where(eq(seasonMemberships.id, bet.membershipId));
```

This is a separate small read rather than a join because `resettleBet` loads the bet with `.for('update')`, and Postgres will not take a `FOR UPDATE` lock through an outer-joined query.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- src/server/feed/__tests__/resettle-emission.test.ts src/server/bets/__tests__/resettle.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

Run: `npm run verify`
Expected: PASS.

```bash
git add src/server/bets/resettle.ts src/server/feed/__tests__/resettle-emission.test.ts
git commit -m "feat: post a correction card when a bet is re-settled"
```

---

### Task 8: Emit `MEMBER_JOINED`, `ALLOWANCE_PAID` and `ADMIN_ADJUSTMENT`

**Files:**

- Modify: `src/server/money/ledger.ts` — `PostEntryResult` gains `entryId`
- Modify: `src/server/seasons/service.ts`
- Modify: `src/server/seasons/allowance.ts`
- Modify: `src/server/admin/adjust.ts`
- Test: `src/server/feed/__tests__/money-emission.test.ts`

**Interfaces:**

- Consumes: `emitFeedEvent`, `isoWeekKey` (already exported from `@/server/seasons/allowance`).
- Produces: `PostEntryResult` is now `{ applied: boolean; balanceCents: bigint; entryId: string | null }`. This is additive — existing callers destructure only what they use.

`ADMIN_ADJUSTMENT`'s dedupe key is the ledger entry's own id, which means `postEntry` has to hand it back. That is a one-line change to the money core's return type and no change to its behavior.

- [ ] **Step 1: Write the failing test**

Create `src/server/feed/__tests__/money-emission.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedEvents, seasonMemberships } from '@/db/schema';
import { adjustBalance } from '@/server/admin/adjust';
import { isoWeekKey, payWeeklyAllowance } from '@/server/seasons/allowance';
import { joinSeason } from '@/server/seasons/service';
import type {
  AdminAdjustmentPayload,
  AllowancePaidPayload,
  MemberJoinedPayload,
} from '@/server/feed/payload';
import { resetDb } from '@/test/db';
import { makeSeason, makeUser } from '@/test/factories';

describe('money-path feed emission', () => {
  beforeEach(resetDb);

  it('announces a member joining, once', async () => {
    const user = await makeUser();
    const season = await makeSeason({ status: 'ACTIVE' });

    await joinSeason(user.id, season.id);
    await joinSeason(user.id, season.id); // idempotent re-join

    const events = await db.select().from(feedEvents).where(eq(feedEvents.type, 'MEMBER_JOINED'));
    expect(events).toHaveLength(1);
    expect((events[0].payload as MemberJoinedPayload).startingBankrollCents).toBe('1000000');
  });

  it('posts one aggregated allowance card per week, not one per member', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    for (const _ of [1, 2, 3]) {
      const user = await makeUser();
      await joinSeason(user.id, season.id);
    }

    const now = new Date('2026-09-08T12:00:00Z');
    await payWeeklyAllowance(now);
    await payWeeklyAllowance(now); // double cron fire

    const events = await db.select().from(feedEvents).where(eq(feedEvents.type, 'ALLOWANCE_PAID'));
    expect(events).toHaveLength(1);

    const payload = events[0].payload as AllowancePaidPayload;
    expect(payload.memberCount).toBe(3);
    expect(payload.amountCents).toBe('50000');
    expect(payload.weekKey).toBe(isoWeekKey(now));
    expect(events[0].subjectMembershipId).toBeNull();
  });

  it('publishes an admin adjustment with its note and the admin name', async () => {
    const user = await makeUser();
    const admin = await makeUser({ role: 'ADMIN', displayName: 'Chris' });
    const season = await makeSeason({ status: 'ACTIVE' });
    const { membershipId } = await joinSeason(user.id, season.id);

    await adjustBalance({
      membershipId,
      amountCents: 25_000n,
      note: 'won the survivor pool',
      actorUserId: admin.id,
      idempotencyKey: 'adjust:test:1',
    });

    const [event] = await db
      .select()
      .from(feedEvents)
      .where(eq(feedEvents.type, 'ADMIN_ADJUSTMENT'));
    expect(event.subjectMembershipId).toBe(membershipId);
    expect(event.ledgerEntryId).not.toBeNull();

    const payload = event.payload as AdminAdjustmentPayload;
    expect(payload.amountCents).toBe('25000');
    expect(payload.note).toBe('won the survivor pool');
    expect(payload.adminDisplayName).toBe('Chris');
  });

  it('does not re-announce an adjustment replayed under the same idempotency key', async () => {
    const user = await makeUser();
    const admin = await makeUser({ role: 'ADMIN' });
    const season = await makeSeason({ status: 'ACTIVE' });
    const { membershipId } = await joinSeason(user.id, season.id);

    const input = {
      membershipId,
      amountCents: 25_000n,
      note: 'twice',
      actorUserId: admin.id,
      idempotencyKey: 'adjust:test:2',
    };
    await adjustBalance(input);
    await adjustBalance(input);

    const events = await db
      .select()
      .from(feedEvents)
      .where(eq(feedEvents.type, 'ADMIN_ADJUSTMENT'));
    expect(events).toHaveLength(1);

    const [membership] = await db
      .select()
      .from(seasonMemberships)
      .where(eq(seasonMemberships.id, membershipId));
    expect(membership.balanceCents).toBe(1_025_000n);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npm test -- src/server/feed/__tests__/money-emission.test.ts`
Expected: FAIL — no events of any of the three types.

- [ ] **Step 3: Return the entry id from `postEntry`**

In `src/server/money/ledger.ts`, add the field to the result interface:

```ts
export interface PostEntryResult {
  applied: boolean;
  balanceCents: bigint;
  /** The row this call inserted, or null when the idempotency key already existed. */
  entryId: string | null;
}
```

and thread it through the two return statements:

```ts
if (inserted.length === 0) {
  return { applied: false, balanceCents: membership.balanceCents, entryId: null };
}
```

```ts
return { applied: true, balanceCents: nextBalance, entryId: inserted[0].id };
```

- [ ] **Step 4: Emit `MEMBER_JOINED`**

In `src/server/seasons/service.ts`, add the import and emit inside the existing transaction, guarded on the grant having applied — a re-join must not re-announce:

```ts
import { emitFeedEvent } from '@/server/feed/emit';
```

```ts
if (result.applied) {
  await emitFeedEvent(tx, {
    seasonId,
    type: 'MEMBER_JOINED',
    subjectMembershipId: membership.id,
    dedupeKey: `membership:${membership.id}:joined`,
    payload: { startingBankrollCents: season.startingBankrollCents.toString() },
    occurredAt: membership.joinedAt,
  });
}

return { membershipId: membership.id, balanceCents: result.balanceCents };
```

The `dedupeKey` alone would make this safe, but the guard also keeps a re-join from posting a card dated to the original join.

- [ ] **Step 5: Emit the aggregated `ALLOWANCE_PAID`**

In `src/server/seasons/allowance.ts`, add the import and emit once after the per-membership loop, in its own transaction:

```ts
import { emitFeedEvent } from '@/server/feed/emit';
```

```ts
// One card for the whole run (D26). Twelve members would otherwise post twelve identical
// cards every Tuesday, which is how a feed dies. Emitted unconditionally — the week-scoped
// dedupe key already makes a repeat run a no-op, so there is nothing to branch on.
await db.transaction((tx) =>
  emitFeedEvent(tx, {
    seasonId: season.id,
    type: 'ALLOWANCE_PAID',
    dedupeKey: `allowance:${season.id}:${weekKey}`,
    payload: {
      weekKey,
      memberCount: memberships.length,
      amountCents: season.weeklyAllowanceCents.toString(),
    },
    occurredAt: now,
  }),
);

return { credited, skipped };
```

- [ ] **Step 6: Emit `ADMIN_ADJUSTMENT`**

Replace the body of `adjustBalance` in `src/server/admin/adjust.ts`. It needs the season id and the admin's display name, both read inside the same transaction:

```ts
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { seasonMemberships, users } from '@/db/schema';
import { postEntry } from '@/server/money/ledger';
import { emitFeedEvent } from '@/server/feed/emit';

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

  const result = await db.transaction(async (tx) => {
    const posted = await postEntry(tx, {
      membershipId: input.membershipId,
      amountCents: input.amountCents,
      type: input.amountCents > 0n ? 'ADMIN_CREDIT' : 'ADMIN_DEBIT',
      idempotencyKey: input.idempotencyKey,
      actorUserId: input.actorUserId,
      note: input.note,
    });

    // A replayed adjustment moved no money, so it announces nothing.
    if (!posted.applied || posted.entryId === null) return posted;

    const [membership] = await tx
      .select({ seasonId: seasonMemberships.seasonId })
      .from(seasonMemberships)
      .where(eq(seasonMemberships.id, input.membershipId));

    const [admin] = await tx
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, input.actorUserId));

    // Published to the whole season on purpose (D24): an admin cannot quietly gift anyone
    // when the league watches every adjustment land.
    await emitFeedEvent(tx, {
      seasonId: membership.seasonId,
      type: 'ADMIN_ADJUSTMENT',
      subjectMembershipId: input.membershipId,
      ledgerEntryId: posted.entryId,
      dedupeKey: `ledger:${posted.entryId}`,
      payload: {
        amountCents: input.amountCents.toString(),
        note: input.note,
        adminDisplayName: admin?.displayName ?? 'an admin',
      },
    });

    return posted;
  });

  return { balanceCents: result.balanceCents };
}
```

- [ ] **Step 7: Run the tests and verify they pass**

Run: `npm test -- src/server/feed/__tests__/money-emission.test.ts src/server/money/ src/server/seasons/ src/server/admin/`
Expected: PASS. If a pre-existing ledger test asserts the exact shape of `PostEntryResult` with a strict equality check, update it to include `entryId`.

- [ ] **Step 8: Verify and commit**

Run: `npm run verify`
Expected: PASS.

```bash
git add src/server/money/ledger.ts src/server/seasons/ src/server/admin/adjust.ts src/server/feed/__tests__/money-emission.test.ts
git commit -m "feat: post feed cards for joins, allowance and admin adjustments"
```

---

### Task 9: Lead-change detection

**Files:**

- Create: `src/server/feed/leaders.ts`
- Modify: `src/app/api/cron/settle/route.ts`
- Test: `src/server/feed/__tests__/leaders.test.ts`

**Interfaces:**

- Consumes: `pickLeader` (Task 4), `emitFeedEvent` (Task 2), `LeadChangePayload` (Task 2).
- Produces: `detectLeadChange(seasonId: string): Promise<{ emitted: boolean }>`.

Previous state is read back out of the last lead-change event's payload, so there is no snapshot table and no cursor. Sequence-numbered keys let a leader lose and retake the lead while a double-fired run still no-ops.

- [ ] **Step 1: Write the failing test**

Create `src/server/feed/__tests__/leaders.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedEvents, seasonMemberships } from '@/db/schema';
import { detectLeadChange } from '@/server/feed/leaders';
import type { LeadChangePayload } from '@/server/feed/payload';
import { resetDb } from '@/test/db';
import { makeSeason, makeUser } from '@/test/factories';

async function seedSeason(balances: bigint[]) {
  const season = await makeSeason({ status: 'ACTIVE' });
  const ids: string[] = [];
  for (const balance of balances) {
    const user = await makeUser();
    const [membership] = await db
      .insert(seasonMemberships)
      .values({ userId: user.id, seasonId: season.id, balanceCents: balance })
      .returning();
    ids.push(membership.id);
  }
  return { seasonId: season.id, membershipIds: ids };
}

async function setBalance(membershipId: string, balanceCents: bigint) {
  await db
    .update(seasonMemberships)
    .set({ balanceCents })
    .where(eq(seasonMemberships.id, membershipId));
}

async function leadEvents(seasonId: string) {
  return db
    .select()
    .from(feedEvents)
    .where(eq(feedEvents.type, 'MILESTONE_LEAD_CHANGE'))
    .orderBy(asc(feedEvents.createdAt));
}

describe('detectLeadChange', () => {
  beforeEach(resetDb);

  it('emits nothing at season start, when everyone is tied', async () => {
    const { seasonId } = await seedSeason([1_000_000n, 1_000_000n, 1_000_000n]);

    expect(await detectLeadChange(seasonId)).toEqual({ emitted: false });
    expect(await leadEvents(seasonId)).toHaveLength(0);
  });

  it('emits when someone opens a strict lead, with the margin over second', async () => {
    const { seasonId, membershipIds } = await seedSeason([1_000_000n, 1_000_000n]);
    await setBalance(membershipIds[1], 1_030_000n);

    expect(await detectLeadChange(seasonId)).toEqual({ emitted: true });

    const events = await leadEvents(seasonId);
    expect(events).toHaveLength(1);
    expect(events[0].subjectMembershipId).toBe(membershipIds[1]);
    expect(events[0].dedupeKey).toBe(`lead:${seasonId}:1`);

    const payload = events[0].payload as LeadChangePayload;
    expect(payload.sequence).toBe(1);
    expect(payload.previousLeaderMembershipId).toBeNull();
    expect(payload.balanceCents).toBe('1030000');
    expect(payload.marginCents).toBe('30000');
  });

  it('does not re-announce an unchanged leader', async () => {
    const { seasonId, membershipIds } = await seedSeason([1_000_000n, 1_030_000n]);

    await detectLeadChange(seasonId);
    await setBalance(membershipIds[1], 1_040_000n);

    expect(await detectLeadChange(seasonId)).toEqual({ emitted: false });
    expect(await leadEvents(seasonId)).toHaveLength(1);
  });

  it('announces a lead retaken by a previous leader with the next sequence number', async () => {
    const { seasonId, membershipIds } = await seedSeason([1_100_000n, 1_000_000n]);

    await detectLeadChange(seasonId); // A leads, sequence 1

    await setBalance(membershipIds[1], 1_200_000n);
    await detectLeadChange(seasonId); // B leads, sequence 2

    await setBalance(membershipIds[0], 1_300_000n);
    await detectLeadChange(seasonId); // A leads again, sequence 3

    const events = await leadEvents(seasonId);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.subjectMembershipId)).toEqual([
      membershipIds[0],
      membershipIds[1],
      membershipIds[0],
    ]);
    expect((events[2].payload as LeadChangePayload).sequence).toBe(3);
    expect((events[2].payload as LeadChangePayload).previousLeaderMembershipId).toBe(
      membershipIds[1],
    );
    expect(events[2].dedupeKey).toBe(`lead:${seasonId}:3`);
  });

  it('is safe to run twice in a row', async () => {
    const { seasonId } = await seedSeason([1_000_000n, 1_030_000n]);

    await detectLeadChange(seasonId);
    await detectLeadChange(seasonId);

    expect(await leadEvents(seasonId)).toHaveLength(1);
  });

  it('emits nothing for a season with no members', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    expect(await detectLeadChange(season.id)).toEqual({ emitted: false });
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npm test -- src/server/feed/__tests__/leaders.test.ts`
Expected: FAIL — cannot resolve `@/server/feed/leaders`.

- [ ] **Step 3: Write the implementation**

Create `src/server/feed/leaders.ts`:

```ts
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedEvents, seasonMemberships, users } from '@/db/schema';
import { pickLeader } from '@/domain/milestones';
import { emitFeedEvent } from './emit';
import type { LeadChangePayload } from './payload';

/**
 * Emits MILESTONE_LEAD_CHANGE when the season's leader changes.
 *
 * The only derived event in the system: detecting it means comparing every membership's
 * balance, which has no business inside a bet's transaction. So it runs on its own, after
 * the settlement sweep and after an admin adjustment — the two things that actually reorder
 * standings. Not after the allowance run: crediting everyone the same amount cannot change
 * the order.
 *
 * Previous state is read back out of the last event's payload, which is the only place it
 * needs to exist. No snapshot table, no cursor, nothing to get stuck.
 */
export async function detectLeadChange(seasonId: string): Promise<{ emitted: boolean }> {
  const rows = await db
    .select({
      membershipId: seasonMemberships.id,
      balanceCents: seasonMemberships.balanceCents,
    })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.seasonId, seasonId))
    .orderBy(desc(seasonMemberships.balanceCents));

  const leader = pickLeader(rows);
  if (!leader) return { emitted: false };

  const priorEvents = await db
    .select({ payload: feedEvents.payload, subjectMembershipId: feedEvents.subjectMembershipId })
    .from(feedEvents)
    .where(and(eq(feedEvents.seasonId, seasonId), eq(feedEvents.type, 'MILESTONE_LEAD_CHANGE')))
    .orderBy(desc(feedEvents.occurredAt), desc(feedEvents.id));

  const previous = priorEvents[0] ?? null;
  if (previous?.subjectMembershipId === leader.membershipId) return { emitted: false };

  // rows is ordered by balance descending, so second place is the next distinct row.
  const runnerUp = rows.find((row) => row.membershipId !== leader.membershipId) ?? null;

  const [previousLeader] = previous?.subjectMembershipId
    ? await db
        .select({ displayName: users.displayName })
        .from(seasonMemberships)
        .innerJoin(users, eq(seasonMemberships.userId, users.id))
        .where(eq(seasonMemberships.id, previous.subjectMembershipId))
    : [];

  const payload: LeadChangePayload = {
    // Deterministic given prior state: two concurrent runs compute the same number and one
    // loses the unique-key race harmlessly.
    sequence: priorEvents.length + 1,
    previousLeaderMembershipId: previous?.subjectMembershipId ?? null,
    previousLeaderDisplayName: previousLeader?.displayName ?? null,
    balanceCents: leader.balanceCents.toString(),
    marginCents: (leader.balanceCents - (runnerUp?.balanceCents ?? 0n)).toString(),
  };

  const result = await db.transaction((tx) =>
    emitFeedEvent(tx, {
      seasonId,
      type: 'MILESTONE_LEAD_CHANGE',
      subjectMembershipId: leader.membershipId,
      dedupeKey: `lead:${seasonId}:${payload.sequence}`,
      payload,
    }),
  );

  return { emitted: result.applied };
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `npm test -- src/server/feed/__tests__/leaders.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Wire it into the settle cron route**

Replace `src/app/api/cron/settle/route.ts` with:

```ts
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { seasons } from '@/db/schema';
import { settleFinalGames } from '@/server/bets/settle';
import { authorizeCronRequest, jsonSafe } from '@/server/cron/auth';
import { detectLeadChange } from '@/server/feed/leaders';

/**
 * Every 10 minutes. Settles finished games in batches sized to fit the invocation limit;
 * whatever it does not reach is picked up by the next run.
 *
 * Lead-change detection rides along here rather than in its own cron entry: settlement is
 * what moves standings, and folding it in means no new schedule to keep in sync.
 */
export async function GET(request: Request): Promise<Response> {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  const summary = await settleFinalGames();

  let leadChanged = false;
  const [activeSeason] = await db
    .select({ id: seasons.id })
    .from(seasons)
    .where(eq(seasons.status, 'ACTIVE'));

  if (activeSeason) {
    leadChanged = (await detectLeadChange(activeSeason.id)).emitted;
  }

  // A game that failed to settle is reported, not swallowed — the run still succeeded for
  // everyone else, but a persistent failure needs to be visible in the cron logs.
  const status = summary.errors.length > 0 ? 207 : 200;
  return Response.json(jsonSafe({ ...summary, leadChanged }), { status });
}
```

- [ ] **Step 6: Call it after an admin adjustment**

An admin adjustment can reorder standings too. In `src/server/admin/adjust.ts`, call it after the transaction commits — never inside, because it opens its own:

```ts
import { detectLeadChange } from '@/server/feed/leaders';
```

At the end of `adjustBalance`, replace the final return with:

```ts
if (result.applied) {
  const [membership] = await db
    .select({ seasonId: seasonMemberships.seasonId })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, input.membershipId));
  await detectLeadChange(membership.seasonId);
}

return { balanceCents: result.balanceCents };
```

- [ ] **Step 7: Verify and commit**

Run: `npm run verify`
Expected: PASS.

```bash
git add src/server/feed/leaders.ts src/server/feed/__tests__/leaders.test.ts src/app/api/cron/settle/route.ts src/server/admin/adjust.ts
git commit -m "feat: announce lead changes in the feed"
```

---

### Task 10: Read the feed

**Files:**

- Create: `src/server/feed/preferences.ts`
- Create: `src/server/feed/query.ts`
- Test: `src/server/feed/__tests__/query.test.ts`

**Interfaces:**

- Consumes: the schema from Task 1, `FeedEventPayload` from Task 2.
- Produces:
  - `getMutedTypes(userId: string): Promise<FeedEventType[]>`
  - `setMutedTypes(userId: string, types: FeedEventType[]): Promise<void>`
  - `interface FeedCursor { occurredAt: Date; id: string }`
  - `interface FeedCard { id; type; occurredAt; subject; payload; reactions; commentCount }`
  - `getSeasonFeed(opts): Promise<{ cards: FeedCard[]; nextCursor: FeedCursor | null }>`

- [ ] **Step 1: Write the failing test**

Create `src/server/feed/__tests__/query.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { feedComments, feedEvents, feedReactions, seasonMemberships } from '@/db/schema';
import { getSeasonFeed } from '@/server/feed/query';
import { setMutedTypes } from '@/server/feed/preferences';
import { resetDb } from '@/test/db';
import { makeSeason, makeUser } from '@/test/factories';

async function seedMember(seasonId: string, balanceCents = 1_000_000n) {
  const user = await makeUser();
  const [membership] = await db
    .insert(seasonMemberships)
    .values({ userId: user.id, seasonId, balanceCents })
    .returning();
  return { user, membership };
}

async function seedEvent(
  seasonId: string,
  membershipId: string | null,
  overrides: { type?: 'BET_PLACED' | 'ALLOWANCE_PAID'; occurredAt?: Date; key?: string } = {},
) {
  const [event] = await db
    .insert(feedEvents)
    .values({
      seasonId,
      type: overrides.type ?? 'BET_PLACED',
      subjectMembershipId: membershipId,
      payload: {},
      dedupeKey: overrides.key ?? `k-${Math.random()}`,
      occurredAt: overrides.occurredAt ?? new Date(),
    })
    .returning();
  return event;
}

describe('getSeasonFeed', () => {
  beforeEach(resetDb);

  it('returns newest first with the subject joined live', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    const { user, membership } = await seedMember(season.id);

    await seedEvent(season.id, membership.id, { occurredAt: new Date('2026-09-01T12:00:00Z') });
    await seedEvent(season.id, membership.id, { occurredAt: new Date('2026-09-02T12:00:00Z') });

    const page = await getSeasonFeed({
      seasonId: season.id,
      viewerUserId: user.id,
      viewerMembershipId: membership.id,
    });

    expect(page.cards).toHaveLength(2);
    expect(page.cards[0].occurredAt).toEqual(new Date('2026-09-02T12:00:00Z'));
    expect(page.cards[0].subject?.displayName).toBe(user.displayName);
    expect(page.nextCursor).toBeNull();
  });

  it('never leaks another season', async () => {
    const mine = await makeSeason({ status: 'ACTIVE' });
    const theirs = await makeSeason();
    const { user, membership } = await seedMember(mine.id);
    const other = await seedMember(theirs.id);

    await seedEvent(mine.id, membership.id);
    await seedEvent(theirs.id, other.membership.id);

    const page = await getSeasonFeed({
      seasonId: mine.id,
      viewerUserId: user.id,
      viewerMembershipId: membership.id,
    });

    expect(page.cards).toHaveLength(1);
  });

  it('pages through colliding timestamps without skipping or repeating', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    const { user, membership } = await seedMember(season.id);

    const sameInstant = new Date('2026-09-06T20:00:00Z');
    for (let i = 0; i < 60; i++) {
      await seedEvent(season.id, membership.id, { occurredAt: sameInstant, key: `same-${i}` });
    }

    const seen = new Set<string>();
    let cursor = undefined as Awaited<ReturnType<typeof getSeasonFeed>>['nextCursor'] | undefined;
    let pages = 0;

    do {
      const page = await getSeasonFeed({
        seasonId: season.id,
        viewerUserId: user.id,
        viewerMembershipId: membership.id,
        cursor: cursor ?? undefined,
        limit: 25,
      });
      for (const card of page.cards) {
        expect(seen.has(card.id)).toBe(false);
        seen.add(card.id);
      }
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);

    expect(seen.size).toBe(60);
    expect(pages).toBe(3);
  });

  it('filters muted types per viewer without deleting anything', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    const { user, membership } = await seedMember(season.id);
    const other = await seedMember(season.id);

    await seedEvent(season.id, membership.id, { type: 'BET_PLACED' });
    await seedEvent(season.id, null, { type: 'ALLOWANCE_PAID' });

    await setMutedTypes(user.id, ['ALLOWANCE_PAID']);

    const mine = await getSeasonFeed({
      seasonId: season.id,
      viewerUserId: user.id,
      viewerMembershipId: membership.id,
    });
    expect(mine.cards.map((c) => c.type)).toEqual(['BET_PLACED']);

    const theirs = await getSeasonFeed({
      seasonId: season.id,
      viewerUserId: other.user.id,
      viewerMembershipId: other.membership.id,
    });
    expect(theirs.cards).toHaveLength(2);

    await setMutedTypes(user.id, []);
    const unmuted = await getSeasonFeed({
      seasonId: season.id,
      viewerUserId: user.id,
      viewerMembershipId: membership.id,
    });
    expect(unmuted.cards).toHaveLength(2);
  });

  it('aggregates reactions with a mine flag and counts only live comments', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    const { user, membership } = await seedMember(season.id);
    const other = await seedMember(season.id);
    const event = await seedEvent(season.id, membership.id);

    await db.insert(feedReactions).values([
      { eventId: event.id, membershipId: membership.id, emoji: '🔥' },
      { eventId: event.id, membershipId: other.membership.id, emoji: '🔥' },
      { eventId: event.id, membershipId: other.membership.id, emoji: '💀' },
    ]);

    await db.insert(feedComments).values([
      { eventId: event.id, membershipId: other.membership.id, body: 'bold' },
      { eventId: event.id, membershipId: other.membership.id, body: 'gone', deletedAt: new Date() },
    ]);

    const page = await getSeasonFeed({
      seasonId: season.id,
      viewerUserId: user.id,
      viewerMembershipId: membership.id,
    });

    const card = page.cards[0];
    expect(card.commentCount).toBe(1);

    const fire = card.reactions.find((r) => r.emoji === '🔥');
    expect(fire).toEqual({ emoji: '🔥', count: 2, mine: true });

    const skull = card.reactions.find((r) => r.emoji === '💀');
    expect(skull).toEqual({ emoji: '💀', count: 1, mine: false });
  });

  it('restricts to one member when a subject is given', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    const { user, membership } = await seedMember(season.id);
    const other = await seedMember(season.id);

    await seedEvent(season.id, membership.id);
    await seedEvent(season.id, other.membership.id);

    const page = await getSeasonFeed({
      seasonId: season.id,
      viewerUserId: user.id,
      viewerMembershipId: membership.id,
      subjectMembershipId: other.membership.id,
    });

    expect(page.cards).toHaveLength(1);
    expect(page.cards[0].subject?.membershipId).toBe(other.membership.id);
  });

  it('caps the page size at 50 however large a limit is asked for', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    const { user, membership } = await seedMember(season.id);
    for (let i = 0; i < 55; i++) {
      await seedEvent(season.id, membership.id, { key: `cap-${i}` });
    }

    const page = await getSeasonFeed({
      seasonId: season.id,
      viewerUserId: user.id,
      viewerMembershipId: membership.id,
      limit: 500,
    });

    expect(page.cards).toHaveLength(50);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npm test -- src/server/feed/__tests__/query.test.ts`
Expected: FAIL — cannot resolve `@/server/feed/query`.

- [ ] **Step 3: Write the preferences module**

Create `src/server/feed/preferences.ts`:

```ts
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedPreferences, type FeedEventType } from '@/db/schema';

/** No row means nothing muted, so the table stays empty until somebody changes something. */
export async function getMutedTypes(userId: string): Promise<FeedEventType[]> {
  const [row] = await db
    .select({ mutedTypes: feedPreferences.mutedTypes })
    .from(feedPreferences)
    .where(eq(feedPreferences.userId, userId));

  return row?.mutedTypes ?? [];
}

export async function setMutedTypes(userId: string, types: FeedEventType[]): Promise<void> {
  // De-duplicated so the stored array is a set, which is what the read filter assumes.
  const mutedTypes = [...new Set(types)];

  await db
    .insert(feedPreferences)
    .values({ userId, mutedTypes, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: feedPreferences.userId,
      set: { mutedTypes, updatedAt: new Date() },
    });
}
```

- [ ] **Step 4: Write the query module**

Create `src/server/feed/query.ts`:

```ts
import { and, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  feedComments,
  feedEvents,
  feedReactions,
  seasonMemberships,
  users,
  type FeedEventType,
} from '@/db/schema';
import { getMutedTypes } from './preferences';
import type { FeedEventPayload } from './payload';

export interface FeedCursor {
  occurredAt: Date;
  id: string;
}

export interface FeedCardReaction {
  emoji: string;
  count: number;
  mine: boolean;
}

export interface FeedCard {
  id: string;
  type: FeedEventType;
  occurredAt: Date;
  /** Null only for season-wide events. Joined live, so a rename updates every old card. */
  subject: { membershipId: string; displayName: string; avatarUrl: string | null } | null;
  payload: FeedEventPayload;
  reactions: FeedCardReaction[];
  commentCount: number;
}

export interface GetSeasonFeedOptions {
  seasonId: string;
  viewerUserId: string;
  viewerMembershipId: string;
  /** Set to render one member's history on their profile. */
  subjectMembershipId?: string;
  cursor?: FeedCursor;
  limit?: number;
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 50;

/**
 * One page of a season's feed.
 *
 * Keyset-paginated on (occurred_at, id) rather than OFFSET: the feed grows at the head, and
 * with an offset an event arriving between page 1 and page 2 shifts everything down one and
 * the reader sees a duplicate.
 *
 * Three queries, never N+1 — the page, then reactions and comment counts for exactly the ids
 * on that page.
 */
export async function getSeasonFeed(
  opts: GetSeasonFeedOptions,
): Promise<{ cards: FeedCard[]; nextCursor: FeedCursor | null }> {
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const muted = await getMutedTypes(opts.viewerUserId);

  const conditions = [eq(feedEvents.seasonId, opts.seasonId)];

  if (opts.subjectMembershipId) {
    conditions.push(eq(feedEvents.subjectMembershipId, opts.subjectMembershipId));
  }
  if (muted.length > 0) {
    conditions.push(notInArray(feedEvents.type, muted));
  }
  if (opts.cursor) {
    // Row comparison, so a shared timestamp falls back to the id — the pair is unique.
    conditions.push(
      sql`(${feedEvents.occurredAt}, ${feedEvents.id}) < (${opts.cursor.occurredAt.toISOString()}::timestamptz, ${opts.cursor.id}::uuid)`,
    );
  }

  // limit + 1 is how nextCursor is decided without paying for a COUNT.
  const rows = await db
    .select({
      id: feedEvents.id,
      type: feedEvents.type,
      occurredAt: feedEvents.occurredAt,
      payload: feedEvents.payload,
      subjectMembershipId: feedEvents.subjectMembershipId,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
    })
    .from(feedEvents)
    .leftJoin(seasonMemberships, eq(feedEvents.subjectMembershipId, seasonMemberships.id))
    .leftJoin(users, eq(seasonMemberships.userId, users.id))
    .where(and(...conditions))
    .orderBy(desc(feedEvents.occurredAt), desc(feedEvents.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const ids = page.map((row) => row.id);

  const [reactionRows, commentRows] = await Promise.all([
    ids.length === 0
      ? []
      : db
          .select({
            eventId: feedReactions.eventId,
            emoji: feedReactions.emoji,
            count: sql<number>`count(*)::int`,
            mine: sql<boolean>`bool_or(${feedReactions.membershipId} = ${opts.viewerMembershipId}::uuid)`,
          })
          .from(feedReactions)
          .where(inArray(feedReactions.eventId, ids))
          .groupBy(feedReactions.eventId, feedReactions.emoji),
    ids.length === 0
      ? []
      : db
          .select({ eventId: feedComments.eventId, count: sql<number>`count(*)::int` })
          .from(feedComments)
          .where(and(inArray(feedComments.eventId, ids), isNull(feedComments.deletedAt)))
          .groupBy(feedComments.eventId),
  ]);

  const reactionsByEvent = new Map<string, FeedCardReaction[]>();
  for (const row of reactionRows) {
    const list = reactionsByEvent.get(row.eventId) ?? [];
    list.push({ emoji: row.emoji, count: row.count, mine: row.mine });
    reactionsByEvent.set(row.eventId, list);
  }

  const commentCountByEvent = new Map(commentRows.map((row) => [row.eventId, row.count]));

  const cards: FeedCard[] = page.map((row) => ({
    id: row.id,
    type: row.type,
    occurredAt: row.occurredAt,
    subject:
      row.subjectMembershipId && row.displayName
        ? {
            membershipId: row.subjectMembershipId,
            displayName: row.displayName,
            avatarUrl: row.avatarUrl,
          }
        : null,
    payload: row.payload as FeedEventPayload,
    reactions: reactionsByEvent.get(row.id) ?? [],
    commentCount: commentCountByEvent.get(row.id) ?? 0,
  }));

  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last ? { occurredAt: last.occurredAt, id: last.id } : null;

  return { cards, nextCursor };
}
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npm test -- src/server/feed/__tests__/query.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add src/server/feed/query.ts src/server/feed/preferences.ts src/server/feed/__tests__/query.test.ts
git commit -m "feat: add the paginated season feed query"
```

---

### Task 11: Reactions and comments

**Files:**

- Create: `src/server/feed/social.ts`
- Test: `src/server/feed/__tests__/social.test.ts`

**Interfaces:**

- Consumes: schema from Task 1.
- Produces:
  - `REACTION_EMOJI: readonly string[]` and `isAllowedEmoji(emoji: string): boolean`
  - `class FeedError extends Error` with `code: 'EMOJI_NOT_ALLOWED' | 'EVENT_NOT_FOUND' | 'WRONG_SEASON' | 'COMMENT_EMPTY' | 'COMMENT_TOO_LONG' | 'COMMENT_NOT_FOUND' | 'NOT_ALLOWED'`
  - `toggleReaction(input: { eventId; membershipId; seasonId; emoji }): Promise<{ active: boolean }>`
  - `addComment(input: { eventId; membershipId; seasonId; body }): Promise<{ commentId: string }>`
  - `deleteComment(input: { commentId; actorUserId; actorMembershipId; isAdmin }): Promise<{ deleted: boolean }>`
  - `listComments(eventId: string): Promise<CommentView[]>` where `CommentView = { id; membershipId; displayName; avatarUrl; body; createdAt; deletedAt }`
  - `MAX_COMMENT_LENGTH = 500`

- [ ] **Step 1: Write the failing test**

Create `src/server/feed/__tests__/social.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedComments, feedEvents, feedReactions, seasonMemberships } from '@/db/schema';
import {
  addComment,
  deleteComment,
  FeedError,
  listComments,
  toggleReaction,
} from '@/server/feed/social';
import { resetDb } from '@/test/db';
import { makeSeason, makeUser } from '@/test/factories';

async function seedMember(seasonId: string) {
  const user = await makeUser();
  const [membership] = await db
    .insert(seasonMemberships)
    .values({ userId: user.id, seasonId, balanceCents: 1_000_000n })
    .returning();
  return { user, membership };
}

async function seedEvent(seasonId: string, membershipId: string) {
  const [event] = await db
    .insert(feedEvents)
    .values({
      seasonId,
      type: 'BET_PLACED',
      subjectMembershipId: membershipId,
      payload: {},
      dedupeKey: `k-${Math.random()}`,
      occurredAt: new Date(),
    })
    .returning();
  return event;
}

describe('toggleReaction', () => {
  beforeEach(resetDb);

  it('adds then removes the same emoji', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    const { membership } = await seedMember(season.id);
    const event = await seedEvent(season.id, membership.id);
    const input = {
      eventId: event.id,
      membershipId: membership.id,
      seasonId: season.id,
      emoji: '🔥',
    };

    expect(await toggleReaction(input)).toEqual({ active: true });
    expect(await db.select().from(feedReactions)).toHaveLength(1);

    expect(await toggleReaction(input)).toEqual({ active: false });
    expect(await db.select().from(feedReactions)).toHaveLength(0);
  });

  it('allows two different emoji from the same member', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    const { membership } = await seedMember(season.id);
    const event = await seedEvent(season.id, membership.id);

    await toggleReaction({
      eventId: event.id,
      membershipId: membership.id,
      seasonId: season.id,
      emoji: '🔥',
    });
    await toggleReaction({
      eventId: event.id,
      membershipId: membership.id,
      seasonId: season.id,
      emoji: '💀',
    });

    expect(await db.select().from(feedReactions)).toHaveLength(2);
  });

  it('rejects an emoji outside the allowed set', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    const { membership } = await seedMember(season.id);
    const event = await seedEvent(season.id, membership.id);

    await expect(
      toggleReaction({
        eventId: event.id,
        membershipId: membership.id,
        seasonId: season.id,
        emoji: '🍕',
      }),
    ).rejects.toThrow(FeedError);
    expect(await db.select().from(feedReactions)).toHaveLength(0);
  });

  it('rejects reacting to another season’s event', async () => {
    const mine = await makeSeason({ status: 'ACTIVE' });
    const theirs = await makeSeason();
    const me = await seedMember(mine.id);
    const them = await seedMember(theirs.id);
    const event = await seedEvent(theirs.id, them.membership.id);

    await expect(
      toggleReaction({
        eventId: event.id,
        membershipId: me.membership.id,
        seasonId: mine.id,
        emoji: '🔥',
      }),
    ).rejects.toThrow(/WRONG_SEASON/);
  });
});

describe('addComment', () => {
  beforeEach(resetDb);

  it('stores a trimmed body', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    const { membership } = await seedMember(season.id);
    const event = await seedEvent(season.id, membership.id);

    const { commentId } = await addComment({
      eventId: event.id,
      membershipId: membership.id,
      seasonId: season.id,
      body: '   lock of the year   ',
    });

    const [row] = await db.select().from(feedComments).where(eq(feedComments.id, commentId));
    expect(row.body).toBe('lock of the year');
  });

  it('rejects an empty or whitespace-only body', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    const { membership } = await seedMember(season.id);
    const event = await seedEvent(season.id, membership.id);

    await expect(
      addComment({
        eventId: event.id,
        membershipId: membership.id,
        seasonId: season.id,
        body: '   ',
      }),
    ).rejects.toThrow(/COMMENT_EMPTY/);
  });

  it('rejects a body over 500 characters', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    const { membership } = await seedMember(season.id);
    const event = await seedEvent(season.id, membership.id);

    await expect(
      addComment({
        eventId: event.id,
        membershipId: membership.id,
        seasonId: season.id,
        body: 'x'.repeat(501),
      }),
    ).rejects.toThrow(/COMMENT_TOO_LONG/);
  });
});

describe('deleteComment', () => {
  beforeEach(resetDb);

  it('lets the author soft-delete their own', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    const { user, membership } = await seedMember(season.id);
    const event = await seedEvent(season.id, membership.id);
    const { commentId } = await addComment({
      eventId: event.id,
      membershipId: membership.id,
      seasonId: season.id,
      body: 'mine',
    });

    const result = await deleteComment({
      commentId,
      actorUserId: user.id,
      actorMembershipId: membership.id,
      isAdmin: false,
    });
    expect(result).toEqual({ deleted: true });

    const [row] = await db.select().from(feedComments).where(eq(feedComments.id, commentId));
    expect(row.deletedAt).not.toBeNull();
    expect(row.deletedByUserId).toBe(user.id);
    expect(row.body).toBe('mine'); // soft delete keeps the row
  });

  it('refuses a non-author who is not an admin', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    const author = await seedMember(season.id);
    const bystander = await seedMember(season.id);
    const event = await seedEvent(season.id, author.membership.id);
    const { commentId } = await addComment({
      eventId: event.id,
      membershipId: author.membership.id,
      seasonId: season.id,
      body: 'not yours',
    });

    await expect(
      deleteComment({
        commentId,
        actorUserId: bystander.user.id,
        actorMembershipId: bystander.membership.id,
        isAdmin: false,
      }),
    ).rejects.toThrow(/NOT_ALLOWED/);
  });

  it('lets an admin delete anyone’s and records who did it', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    const author = await seedMember(season.id);
    const admin = await seedMember(season.id);
    const event = await seedEvent(season.id, author.membership.id);
    const { commentId } = await addComment({
      eventId: event.id,
      membershipId: author.membership.id,
      seasonId: season.id,
      body: 'over the line',
    });

    await deleteComment({
      commentId,
      actorUserId: admin.user.id,
      actorMembershipId: admin.membership.id,
      isAdmin: true,
    });

    const [row] = await db.select().from(feedComments).where(eq(feedComments.id, commentId));
    expect(row.deletedByUserId).toBe(admin.user.id);
  });

  it('reports a repeat delete as a no-op rather than erroring', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    const { user, membership } = await seedMember(season.id);
    const event = await seedEvent(season.id, membership.id);
    const { commentId } = await addComment({
      eventId: event.id,
      membershipId: membership.id,
      seasonId: season.id,
      body: 'twice',
    });

    const args = {
      commentId,
      actorUserId: user.id,
      actorMembershipId: membership.id,
      isAdmin: false,
    };
    await deleteComment(args);
    expect(await deleteComment(args)).toEqual({ deleted: false });
  });
});

describe('listComments', () => {
  beforeEach(resetDb);

  it('returns comments oldest first, keeping deleted ones as tombstones', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    const { user, membership } = await seedMember(season.id);
    const event = await seedEvent(season.id, membership.id);

    const first = await addComment({
      eventId: event.id,
      membershipId: membership.id,
      seasonId: season.id,
      body: 'first',
    });
    await addComment({
      eventId: event.id,
      membershipId: membership.id,
      seasonId: season.id,
      body: 'second',
    });
    await deleteComment({
      commentId: first.commentId,
      actorUserId: user.id,
      actorMembershipId: membership.id,
      isAdmin: false,
    });

    const comments = await listComments(event.id);
    expect(comments).toHaveLength(2);
    expect(comments[0].deletedAt).not.toBeNull();
    expect(comments[1].body).toBe('second');
    expect(comments[1].displayName).toBe(user.displayName);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npm test -- src/server/feed/__tests__/social.test.ts`
Expected: FAIL — cannot resolve `@/server/feed/social`.

- [ ] **Step 3: Write the implementation**

Create `src/server/feed/social.ts`:

```ts
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedComments, feedEvents, feedReactions, seasonMemberships, users } from '@/db/schema';

/**
 * Six, fixed, in this order everywhere.
 *
 * An open emoji field means an unbounded GROUP BY per card, a legend nobody can read, and a
 * picker on a phone. Six covers celebration, mockery and respect, which is the entire
 * emotional range of a betting group chat.
 */
export const REACTION_EMOJI = ['🔥', '😂', '💀', '🤝', '🎯', '🤡'] as const;

export const MAX_COMMENT_LENGTH = 500;

export type FeedErrorCode =
  | 'EMOJI_NOT_ALLOWED'
  | 'EVENT_NOT_FOUND'
  | 'WRONG_SEASON'
  | 'COMMENT_EMPTY'
  | 'COMMENT_TOO_LONG'
  | 'COMMENT_NOT_FOUND'
  | 'NOT_ALLOWED';

export class FeedError extends Error {
  constructor(readonly code: FeedErrorCode) {
    super(code);
    this.name = 'FeedError';
  }
}

export function isAllowedEmoji(emoji: string): boolean {
  return (REACTION_EMOJI as readonly string[]).includes(emoji);
}

/** Every interaction confirms the event is in the actor's own season before touching it. */
async function requireEventInSeason(eventId: string, seasonId: string): Promise<void> {
  const [event] = await db
    .select({ seasonId: feedEvents.seasonId })
    .from(feedEvents)
    .where(eq(feedEvents.id, eventId));

  if (!event) throw new FeedError('EVENT_NOT_FOUND');
  if (event.seasonId !== seasonId) throw new FeedError('WRONG_SEASON');
}

export async function toggleReaction(input: {
  eventId: string;
  membershipId: string;
  seasonId: string;
  emoji: string;
}): Promise<{ active: boolean }> {
  if (!isAllowedEmoji(input.emoji)) throw new FeedError('EMOJI_NOT_ALLOWED');
  await requireEventInSeason(input.eventId, input.seasonId);

  const match = and(
    eq(feedReactions.eventId, input.eventId),
    eq(feedReactions.membershipId, input.membershipId),
    eq(feedReactions.emoji, input.emoji),
  );

  const [existing] = await db.select({ id: feedReactions.id }).from(feedReactions).where(match);

  if (existing) {
    // Hard delete — a reaction is not an audit record (D28).
    await db.delete(feedReactions).where(eq(feedReactions.id, existing.id));
    return { active: false };
  }

  await db
    .insert(feedReactions)
    .values({ eventId: input.eventId, membershipId: input.membershipId, emoji: input.emoji })
    .onConflictDoNothing();

  return { active: true };
}

export async function addComment(input: {
  eventId: string;
  membershipId: string;
  seasonId: string;
  body: string;
}): Promise<{ commentId: string }> {
  const body = input.body.trim();
  if (body.length === 0) throw new FeedError('COMMENT_EMPTY');
  if (body.length > MAX_COMMENT_LENGTH) throw new FeedError('COMMENT_TOO_LONG');

  await requireEventInSeason(input.eventId, input.seasonId);

  const [comment] = await db
    .insert(feedComments)
    .values({ eventId: input.eventId, membershipId: input.membershipId, body })
    .returning({ id: feedComments.id });

  return { commentId: comment.id };
}

/**
 * Soft delete: the row stays, the thread keeps its shape, and `deletedByUserId` records
 * whether the author or an admin removed it (D28).
 */
export async function deleteComment(input: {
  commentId: string;
  actorUserId: string;
  actorMembershipId: string;
  isAdmin: boolean;
}): Promise<{ deleted: boolean }> {
  const [comment] = await db
    .select({ membershipId: feedComments.membershipId, deletedAt: feedComments.deletedAt })
    .from(feedComments)
    .where(eq(feedComments.id, input.commentId));

  if (!comment) throw new FeedError('COMMENT_NOT_FOUND');

  const isAuthor = comment.membershipId === input.actorMembershipId;
  if (!isAuthor && !input.isAdmin) throw new FeedError('NOT_ALLOWED');

  // A double-tap on a slow connection is not an error condition.
  if (comment.deletedAt !== null) return { deleted: false };

  await db
    .update(feedComments)
    .set({ deletedAt: new Date(), deletedByUserId: input.actorUserId })
    .where(and(eq(feedComments.id, input.commentId), isNull(feedComments.deletedAt)));

  return { deleted: true };
}

export interface CommentView {
  id: string;
  membershipId: string;
  displayName: string;
  avatarUrl: string | null;
  body: string;
  createdAt: Date;
  deletedAt: Date | null;
}

/** Deleted comments come back as tombstones so the thread reads in order. */
export async function listComments(eventId: string): Promise<CommentView[]> {
  return db
    .select({
      id: feedComments.id,
      membershipId: feedComments.membershipId,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      body: feedComments.body,
      createdAt: feedComments.createdAt,
      deletedAt: feedComments.deletedAt,
    })
    .from(feedComments)
    .innerJoin(seasonMemberships, eq(feedComments.membershipId, seasonMemberships.id))
    .innerJoin(users, eq(seasonMemberships.userId, users.id))
    .where(eq(feedComments.eventId, eventId))
    .orderBy(asc(feedComments.createdAt));
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- src/server/feed/__tests__/social.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/feed/social.ts src/server/feed/__tests__/social.test.ts
git commit -m "feat: add feed reactions and comments"
```

---

### Task 12: The Feed tab

**Files:**

- Modify: `src/components/ui/tab-bar.tsx`
- Create: `src/app/(app)/feed/page.tsx`
- Create: `src/app/(app)/feed/actions.ts`
- Create: `src/app/(app)/feed/feed-card.tsx`
- Create: `src/app/(app)/feed/feed-list.tsx`

**Interfaces:**

- Consumes: `getSeasonFeed`, `FeedCard`, `FeedCursor` (Task 10); `REACTION_EMOJI`, `toggleReaction` (Task 11); `requireApprovedMember`, `requireApprovedMemberOrThrow`.
- Produces:
  - `loadMoreFeedAction(cursor: { occurredAt: string; id: string }): Promise<SerializedFeedPage>`
  - `toggleReactionAction(eventId: string, emoji: string): Promise<{ active: boolean } | { error: string }>`
  - `type SerializedFeedCard` — the same shape as `FeedCard` with `occurredAt` as an ISO string, because `Date` round-trips but the cursor is easier to reason about as a string on both sides.

- [ ] **Step 0: Read the bundled Next docs first**

This version of Next.js differs from your training data. Before writing any of the files in this task, read the App Router guides in `node_modules/next/dist/docs/` and confirm: how server actions are declared and called from a client component, whether `revalidatePath` is still the cache-invalidation API, and what the generated `PageProps` type looks like for a dynamic route (Task 13 needs it). The existing `src/app/(app)/bets/actions.ts` and `src/app/(app)/layout.tsx` are working examples in this repo — follow their conventions over anything you remember.

- [ ] **Step 1: Widen the tab bar to five tabs**

Replace the `TABS` constant and the grid class in `src/components/ui/tab-bar.tsx`:

```ts
const TABS = [
  { href: '/games', label: 'Games' },
  { href: '/feed', label: 'Feed' },
  { href: '/bets', label: 'My Bets' },
  { href: '/standings', label: 'Standings' },
  { href: '/me', label: 'Me' },
] as const;
```

```tsx
    <nav className="sticky bottom-0 z-10 grid grid-cols-5 border-t border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
```

Games stays first: D8 makes the odds board the landing route, and the feed sits one tap away.

- [ ] **Step 2: Write the server actions**

Create `src/app/(app)/feed/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { requireApprovedMemberOrThrow } from '@/server/auth/session';
import { addComment, deleteComment, FeedError, toggleReaction } from '@/server/feed/social';
import { getSeasonFeed, type FeedCard } from '@/server/feed/query';

/**
 * `occurredAt` crosses the action boundary as an ISO string. Dates do survive the boundary,
 * but the cursor is round-tripped through the client and a string has exactly one
 * representation on both sides.
 */
export interface SerializedFeedCard extends Omit<FeedCard, 'occurredAt'> {
  occurredAt: string;
}

export interface SerializedFeedPage {
  cards: SerializedFeedCard[];
  nextCursor: { occurredAt: string; id: string } | null;
}

function serialize(page: Awaited<ReturnType<typeof getSeasonFeed>>): SerializedFeedPage {
  return {
    cards: page.cards.map((card) => ({ ...card, occurredAt: card.occurredAt.toISOString() })),
    nextCursor: page.nextCursor
      ? { occurredAt: page.nextCursor.occurredAt.toISOString(), id: page.nextCursor.id }
      : null,
  };
}

export async function loadMoreFeedAction(cursor: {
  occurredAt: string;
  id: string;
}): Promise<SerializedFeedPage> {
  const member = await requireApprovedMemberOrThrow();

  // The season comes from the session, never from the client — otherwise a crafted request
  // reads another league's feed.
  const page = await getSeasonFeed({
    seasonId: member.seasonId,
    viewerUserId: member.userId,
    viewerMembershipId: member.membershipId,
    cursor: { occurredAt: new Date(cursor.occurredAt), id: cursor.id },
  });

  return serialize(page);
}

export async function toggleReactionAction(
  eventId: string,
  emoji: string,
): Promise<{ active: boolean } | { error: string }> {
  const member = await requireApprovedMemberOrThrow();

  try {
    const result = await toggleReaction({
      eventId,
      membershipId: member.membershipId,
      seasonId: member.seasonId,
      emoji,
    });
    revalidatePath('/feed');
    revalidatePath(`/feed/${eventId}`);
    return result;
  } catch (err) {
    if (err instanceof FeedError) return { error: err.code };
    throw err;
  }
}

export async function addCommentAction(
  eventId: string,
  body: string,
): Promise<{ commentId: string } | { error: string }> {
  const member = await requireApprovedMemberOrThrow();

  try {
    const result = await addComment({
      eventId,
      membershipId: member.membershipId,
      seasonId: member.seasonId,
      body,
    });
    revalidatePath('/feed');
    revalidatePath(`/feed/${eventId}`);
    return result;
  } catch (err) {
    if (err instanceof FeedError) return { error: err.code };
    throw err;
  }
}

export async function deleteCommentAction(
  commentId: string,
  eventId: string,
): Promise<{ deleted: boolean } | { error: string }> {
  const member = await requireApprovedMemberOrThrow();

  try {
    const result = await deleteComment({
      commentId,
      actorUserId: member.userId,
      actorMembershipId: member.membershipId,
      isAdmin: member.role === 'ADMIN',
    });
    revalidatePath(`/feed/${eventId}`);
    revalidatePath('/feed');
    return result;
  } catch (err) {
    if (err instanceof FeedError) return { error: err.code };
    throw err;
  }
}
```

- [ ] **Step 3: Write the card component**

Create `src/app/(app)/feed/feed-card.tsx`. It is a pure presentational component — a server or client parent can render it, so it takes no actions itself except the reaction row, which is passed in as a child:

```tsx
import Link from 'next/link';
import { Money } from '@/components/ui/money';
import type { FeedEventType } from '@/db/schema';
import type {
  AdminAdjustmentPayload,
  AllowancePaidPayload,
  BetPlacedPayload,
  BetSettledPayload,
  BigWinPayload,
  FeedLegSnapshot,
  LeadChangePayload,
  MemberJoinedPayload,
  ParlayHitPayload,
} from '@/server/feed/payload';
import type { SerializedFeedCard } from './actions';

/** "KC −3.5 (−110)" — the pick, as a card reads it. */
function describeLeg(leg: FeedLegSnapshot): string {
  const price = leg.priceAmerican > 0 ? `+${leg.priceAmerican}` : `${leg.priceAmerican}`;

  if (leg.marketType === 'TOTAL') {
    const direction = leg.side === 'OVER' ? 'o' : 'u';
    return `${leg.awayAbbr}/${leg.homeAbbr} ${direction}${leg.line ?? ''} (${price})`;
  }

  const team = leg.side === 'HOME' ? leg.homeAbbr : leg.awayAbbr;
  if (leg.marketType === 'MONEYLINE') return `${team} ML (${price})`;

  const line = leg.line ? Number(leg.line) : 0;
  const signed = line > 0 ? `+${leg.line}` : `${leg.line}`;
  return `${team} ${signed} (${price})`;
}

const OUTCOME_MARK: Record<string, string> = {
  WON: '✓',
  LOST: '✗',
  PUSHED: '—',
  VOIDED: '⊘',
};

function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function Body({ type, payload }: { type: FeedEventType; payload: unknown }) {
  switch (type) {
    case 'BET_PLACED': {
      const bet = payload as BetPlacedPayload;
      return (
        <div className="flex flex-col gap-1">
          <p className="text-sm">
            bet <Money cents={BigInt(bet.stakeCents)} className="font-semibold" /> to win{' '}
            <Money cents={BigInt(bet.potentialPayoutCents)} className="font-semibold" />
          </p>
          <ul className="flex flex-col gap-0.5 text-sm text-zinc-600 dark:text-zinc-300">
            {bet.legs.map((leg, i) => (
              <li key={i}>{describeLeg(leg)}</li>
            ))}
          </ul>
        </div>
      );
    }

    case 'BET_SETTLED': {
      const bet = payload as BetSettledPayload;
      const net = BigInt(bet.netCents);
      const verb =
        bet.outcome === 'WON'
          ? 'won'
          : bet.outcome === 'LOST'
            ? 'lost'
            : bet.outcome === 'PUSHED'
              ? 'pushed'
              : 'had a bet voided';

      return (
        <div className="flex flex-col gap-1">
          <p className="text-sm">
            {verb}{' '}
            {bet.outcome === 'LOST' ? (
              <Money cents={BigInt(bet.stakeCents)} className="font-semibold" />
            ) : (
              <Money cents={BigInt(bet.payoutCents)} className="font-semibold" />
            )}
            {net !== 0n ? (
              <span className={net > 0n ? 'text-emerald-600' : 'text-rose-600'}>
                {' '}
                ({net > 0n ? '+' : ''}
                <Money cents={net} />)
              </span>
            ) : null}
            {bet.correction ? (
              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">
                corrected
              </span>
            ) : null}
          </p>
          <ul className="flex flex-col gap-0.5 text-sm text-zinc-600 dark:text-zinc-300">
            {bet.legs.map((leg, i) => (
              <li key={i}>
                {describeLeg(leg)} {OUTCOME_MARK[bet.legOutcomes[i]] ?? ''}
              </li>
            ))}
          </ul>
        </div>
      );
    }

    case 'MEMBER_JOINED': {
      const joined = payload as MemberJoinedPayload;
      return (
        <p className="text-sm">
          joined with{' '}
          <Money cents={BigInt(joined.startingBankrollCents)} className="font-semibold" />
        </p>
      );
    }

    case 'ALLOWANCE_PAID': {
      const allowance = payload as AllowancePaidPayload;
      return (
        <p className="text-sm">
          Weekly allowance paid ·{' '}
          <Money cents={BigInt(allowance.amountCents)} className="font-semibold" /> to{' '}
          {allowance.memberCount} {allowance.memberCount === 1 ? 'member' : 'members'}
        </p>
      );
    }

    case 'ADMIN_ADJUSTMENT': {
      const adjustment = payload as AdminAdjustmentPayload;
      const amount = BigInt(adjustment.amountCents);
      return (
        <p className="text-sm">
          <span className={amount > 0n ? 'text-emerald-600' : 'text-rose-600'}>
            {amount > 0n ? '+' : ''}
            <Money cents={amount} className="font-semibold" />
          </span>{' '}
          by admin {adjustment.adminDisplayName} — “{adjustment.note}”
        </p>
      );
    }

    case 'MILESTONE_LEAD_CHANGE': {
      const lead = payload as LeadChangePayload;
      return (
        <p className="text-sm">
          <span className="font-semibold">takes the lead</span> ·{' '}
          <Money cents={BigInt(lead.balanceCents)} /> (+
          <Money cents={BigInt(lead.marginCents)} />
          {lead.previousLeaderDisplayName ? ` over ${lead.previousLeaderDisplayName}` : ''})
        </p>
      );
    }

    case 'MILESTONE_BIG_WIN': {
      const win = payload as BigWinPayload;
      return (
        <p className="text-sm">
          cashed{' '}
          <span className="font-semibold">{(win.multipleBasisPoints / 10_000).toFixed(1)}×</span> ·{' '}
          <Money cents={BigInt(win.stakeCents)} /> → <Money cents={BigInt(win.payoutCents)} />
        </p>
      );
    }

    case 'MILESTONE_PARLAY_HIT': {
      const hit = payload as ParlayHitPayload;
      return (
        <p className="text-sm">
          hit a <span className="font-semibold">{hit.legCount}-leg parlay</span> ·{' '}
          <Money cents={BigInt(hit.payoutCents)} />
        </p>
      );
    }

    default:
      return null;
  }
}

export function FeedCardView({
  card,
  reactionRow,
}: {
  card: SerializedFeedCard;
  reactionRow?: React.ReactNode;
}) {
  return (
    <article className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <header className="flex items-baseline justify-between gap-2">
        {card.subject ? (
          <Link
            href={`/members/${card.subject.membershipId}`}
            className="truncate text-sm font-semibold hover:underline"
          >
            {card.subject.displayName}
          </Link>
        ) : (
          <span className="truncate text-sm font-semibold text-zinc-500">The league</span>
        )}
        <span className="shrink-0 text-xs text-zinc-400">{relativeTime(card.occurredAt)}</span>
      </header>

      <Body type={card.type} payload={card.payload} />

      <footer className="flex items-center justify-between gap-3 pt-1">
        {reactionRow ?? <span />}
        <Link href={`/feed/${card.id}`} className="text-xs text-zinc-500 hover:underline">
          {card.commentCount === 0
            ? 'Comment'
            : `${card.commentCount} ${card.commentCount === 1 ? 'comment' : 'comments'}`}
        </Link>
      </footer>
    </article>
  );
}
```

- [ ] **Step 4: Write the client list with the reaction row**

Create `src/app/(app)/feed/feed-list.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { REACTION_EMOJI } from '@/server/feed/social';
import { FeedCardView } from './feed-card';
import { loadMoreFeedAction, toggleReactionAction, type SerializedFeedPage } from './actions';

function ReactionRow({
  card,
  onToggle,
}: {
  card: SerializedFeedPage['cards'][number];
  onToggle: (emoji: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {REACTION_EMOJI.map((emoji) => {
        const existing = card.reactions.find((r) => r.emoji === emoji);
        const count = existing?.count ?? 0;
        const mine = existing?.mine ?? false;

        return (
          <button
            key={emoji}
            type="button"
            onClick={() => onToggle(emoji)}
            aria-pressed={mine}
            className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
              mine
                ? 'border-zinc-900 bg-zinc-100 dark:border-zinc-100 dark:bg-zinc-800'
                : 'border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900'
            }`}
          >
            {emoji}
            {count > 0 ? <span className="ml-1 tabular-nums">{count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function FeedList({ initial }: { initial: SerializedFeedPage }) {
  const [cards, setCards] = useState(initial.cards);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [pending, startTransition] = useTransition();

  function loadMore() {
    if (!cursor) return;
    startTransition(async () => {
      const next = await loadMoreFeedAction(cursor);
      setCards((current) => [...current, ...next.cards]);
      setCursor(next.nextCursor);
    });
  }

  function toggle(eventId: string, emoji: string) {
    // Optimistic: the reaction row is the one place in the app where a round trip would be
    // felt, and the worst case is a count that corrects itself on the next render.
    setCards((current) =>
      current.map((card) => {
        if (card.id !== eventId) return card;

        const existing = card.reactions.find((r) => r.emoji === emoji);
        const reactions = existing
          ? card.reactions
              .map((r) =>
                r.emoji === emoji
                  ? { ...r, count: r.mine ? r.count - 1 : r.count + 1, mine: !r.mine }
                  : r,
              )
              .filter((r) => r.count > 0)
          : [...card.reactions, { emoji, count: 1, mine: true }];

        return { ...card, reactions };
      }),
    );

    startTransition(async () => {
      await toggleReactionAction(eventId, emoji);
    });
  }

  return (
    <div className="flex flex-col gap-2 px-4 py-4">
      {cards.map((card) => (
        <FeedCardView
          key={card.id}
          card={card}
          reactionRow={<ReactionRow card={card} onToggle={(emoji) => toggle(card.id, emoji)} />}
        />
      ))}

      {cursor ? (
        <button
          type="button"
          onClick={loadMore}
          disabled={pending}
          className="mt-2 rounded-xl border border-zinc-200 py-2 text-sm font-medium disabled:opacity-50 dark:border-zinc-800"
        >
          {pending ? 'Loading…' : 'Load more'}
        </button>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Write the feed page**

Create `src/app/(app)/feed/page.tsx`:

```tsx
import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
import { requireApprovedMember } from '@/server/auth/session';
import { getSeasonFeed } from '@/server/feed/query';
import { FeedList } from './feed-list';

export default async function FeedPage() {
  const member = await requireApprovedMember();

  const page = await getSeasonFeed({
    seasonId: member.seasonId,
    viewerUserId: member.userId,
    viewerMembershipId: member.membershipId,
  });

  const serialized = {
    cards: page.cards.map((card) => ({ ...card, occurredAt: card.occurredAt.toISOString() })),
    nextCursor: page.nextCursor
      ? { occurredAt: page.nextCursor.occurredAt.toISOString(), id: page.nextCursor.id }
      : null,
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-end px-4 pt-3">
        <Link href="/me/feed-preferences" className="text-xs text-zinc-500 hover:underline">
          Filters
        </Link>
      </div>

      {serialized.cards.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          body="Bets, settlements and milestones show up here as they happen."
        />
      ) : (
        <FeedList initial={serialized} />
      )}
    </div>
  );
}
```

- [ ] **Step 6: Prove the routes compile**

Run: `npm run build`
Expected: PASS, with `/feed` listed as a route (`ƒ /feed`). This is the gate that matters here — it compiles the server/client boundary for real, which is where the mistakes in this task live (a server-only import pulled into `feed-list.tsx`, an action that isn't actually serializable).

_Local only, skip in the cloud environment:_ `npm run dev`, then sign in and open `http://localhost:3000/feed` — place a bet from the Games tab, confirm a card appears, and confirm a reaction toggle survives a reload. Sign-in needs real Google credentials, so this is not runnable in the cloud environment. Do not treat it as a blocker; `npm run build` plus the Task 10 and 11 test suites cover the same ground.

- [ ] **Step 7: Verify and commit**

Run: `npm run verify`
Expected: PASS.

```bash
git add src/components/ui/tab-bar.tsx 'src/app/(app)/feed/'
git commit -m "feat: add the feed tab"
```

---

### Task 13: Event detail and the comment thread

**Files:**

- Create: `src/app/(app)/feed/[eventId]/page.tsx`
- Create: `src/app/(app)/feed/[eventId]/comment-thread.tsx`
- Create: `src/server/feed/__tests__/single-event.test.ts`
- Modify: `src/server/feed/query.ts` — add `getFeedEvent`

**Interfaces:**

- Consumes: `listComments`, `deleteCommentAction`, `addCommentAction`, `FeedCardView`.
- Produces: `getFeedEvent(opts: { eventId: string; seasonId: string; viewerUserId: string; viewerMembershipId: string }): Promise<FeedCard | null>` — returns null when the event does not exist **or** belongs to another season, so the page cannot distinguish the two and cannot be used to probe for ids.

- [ ] **Step 1: Write the failing test**

Create `src/server/feed/__tests__/single-event.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { feedEvents, seasonMemberships } from '@/db/schema';
import { getFeedEvent } from '@/server/feed/query';
import { resetDb } from '@/test/db';
import { makeSeason, makeUser } from '@/test/factories';

async function seed() {
  const season = await makeSeason({ status: 'ACTIVE' });
  const user = await makeUser();
  const [membership] = await db
    .insert(seasonMemberships)
    .values({ userId: user.id, seasonId: season.id, balanceCents: 1_000_000n })
    .returning();
  const [event] = await db
    .insert(feedEvents)
    .values({
      seasonId: season.id,
      type: 'BET_PLACED',
      subjectMembershipId: membership.id,
      payload: { betType: 'SINGLE' },
      dedupeKey: 'single-event',
      occurredAt: new Date(),
    })
    .returning();
  return { season, user, membership, event };
}

describe('getFeedEvent', () => {
  beforeEach(resetDb);

  it('returns the card for an event in the viewer’s season', async () => {
    const { season, user, membership, event } = await seed();

    const card = await getFeedEvent({
      eventId: event.id,
      seasonId: season.id,
      viewerUserId: user.id,
      viewerMembershipId: membership.id,
    });

    expect(card?.id).toBe(event.id);
    expect(card?.subject?.displayName).toBe(user.displayName);
  });

  it('returns null for another season’s event, indistinguishable from missing', async () => {
    const { user, membership, event } = await seed();
    const otherSeason = await makeSeason();

    const card = await getFeedEvent({
      eventId: event.id,
      seasonId: otherSeason.id,
      viewerUserId: user.id,
      viewerMembershipId: membership.id,
    });

    expect(card).toBeNull();
  });

  it('ignores the viewer’s mutes — a card reached by link still opens', async () => {
    const { season, user, membership, event } = await seed();
    const { setMutedTypes } = await import('@/server/feed/preferences');
    await setMutedTypes(user.id, ['BET_PLACED']);

    const card = await getFeedEvent({
      eventId: event.id,
      seasonId: season.id,
      viewerUserId: user.id,
      viewerMembershipId: membership.id,
    });

    expect(card?.id).toBe(event.id);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npm test -- src/server/feed/__tests__/single-event.test.ts`
Expected: FAIL — `getFeedEvent` is not exported.

- [ ] **Step 3: Add `getFeedEvent` to the query module**

Append to `src/server/feed/query.ts`:

```ts
/**
 * One card by id, scoped to the viewer's season.
 *
 * Returns null both when the event does not exist and when it belongs to another season, so
 * the detail page cannot be used to probe for valid ids. Mutes are deliberately NOT applied:
 * a muted type should stay out of the feed, but a card someone linked you to should still open.
 */
export async function getFeedEvent(opts: {
  eventId: string;
  seasonId: string;
  viewerUserId: string;
  viewerMembershipId: string;
}): Promise<FeedCard | null> {
  const [row] = await db
    .select({
      id: feedEvents.id,
      type: feedEvents.type,
      occurredAt: feedEvents.occurredAt,
      payload: feedEvents.payload,
      subjectMembershipId: feedEvents.subjectMembershipId,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
    })
    .from(feedEvents)
    .leftJoin(seasonMemberships, eq(feedEvents.subjectMembershipId, seasonMemberships.id))
    .leftJoin(users, eq(seasonMemberships.userId, users.id))
    .where(and(eq(feedEvents.id, opts.eventId), eq(feedEvents.seasonId, opts.seasonId)));

  if (!row) return null;

  const [reactionRows, commentRows] = await Promise.all([
    db
      .select({
        emoji: feedReactions.emoji,
        count: sql<number>`count(*)::int`,
        mine: sql<boolean>`bool_or(${feedReactions.membershipId} = ${opts.viewerMembershipId}::uuid)`,
      })
      .from(feedReactions)
      .where(eq(feedReactions.eventId, opts.eventId))
      .groupBy(feedReactions.emoji),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(feedComments)
      .where(and(eq(feedComments.eventId, opts.eventId), isNull(feedComments.deletedAt))),
  ]);

  return {
    id: row.id,
    type: row.type,
    occurredAt: row.occurredAt,
    subject:
      row.subjectMembershipId && row.displayName
        ? {
            membershipId: row.subjectMembershipId,
            displayName: row.displayName,
            avatarUrl: row.avatarUrl,
          }
        : null,
    payload: row.payload as FeedEventPayload,
    reactions: reactionRows.map((r) => ({ emoji: r.emoji, count: r.count, mine: r.mine })),
    commentCount: commentRows[0]?.count ?? 0,
  };
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test -- src/server/feed/__tests__/single-event.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the comment thread client component**

Create `src/app/(app)/feed/[eventId]/comment-thread.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { MAX_COMMENT_LENGTH } from '@/server/feed/social';
import { addCommentAction, deleteCommentAction } from '../actions';

export interface ThreadComment {
  id: string;
  membershipId: string;
  displayName: string;
  body: string;
  createdAt: string;
  deleted: boolean;
  canDelete: boolean;
}

export function CommentThread({
  eventId,
  comments,
}: {
  eventId: string;
  comments: ThreadComment[];
}) {
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ERRORS: Record<string, string> = {
    COMMENT_EMPTY: 'Say something first.',
    COMMENT_TOO_LONG: `Keep it under ${MAX_COMMENT_LENGTH} characters.`,
    NOT_ALLOWED: 'Not your comment.',
  };

  function submit() {
    const trimmed = body.trim();
    if (trimmed.length === 0) {
      setError(ERRORS.COMMENT_EMPTY);
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await addCommentAction(eventId, trimmed);
      if ('error' in result) {
        setError(ERRORS[result.error] ?? 'Could not post that.');
        return;
      }
      setBody('');
    });
  }

  function remove(commentId: string) {
    startTransition(async () => {
      const result = await deleteCommentAction(commentId, eventId);
      if ('error' in result) setError(ERRORS[result.error] ?? 'Could not delete that.');
    });
  }

  return (
    <section className="flex flex-col gap-3 px-4 pb-6">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Comments</h2>

      {comments.length === 0 ? (
        <p className="text-sm text-zinc-500">Nobody has said anything yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {comments.map((comment) => (
            <li
              key={comment.id}
              className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950"
            >
              {comment.deleted ? (
                <p className="text-sm italic text-zinc-400">Comment removed</p>
              ) : (
                <>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold">{comment.displayName}</span>
                    {comment.canDelete ? (
                      <button
                        type="button"
                        onClick={() => remove(comment.id)}
                        disabled={pending}
                        className="text-xs text-zinc-400 hover:text-rose-600 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                  <p className="whitespace-pre-wrap text-sm">{comment.body}</p>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={MAX_COMMENT_LENGTH}
          rows={3}
          placeholder="Say something"
          className="rounded-xl border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950"
        />
        {error ? <p className="text-xs text-rose-600">{error}</p> : null}
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="self-end rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? 'Posting…' : 'Post'}
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Write the detail page**

Create `src/app/(app)/feed/[eventId]/page.tsx`. Confirm the `params` shape against the bundled docs before writing — in this version it is awaited, and the generated `PageProps` type is preferred over a hand-written one:

```tsx
import { notFound } from 'next/navigation';
import { requireApprovedMember } from '@/server/auth/session';
import { getFeedEvent } from '@/server/feed/query';
import { listComments } from '@/server/feed/social';
import { FeedCardView } from '../feed-card';
import { CommentThread, type ThreadComment } from './comment-thread';

export default async function FeedEventPage({ params }: PageProps<'/feed/[eventId]'>) {
  const { eventId } = await params;
  const member = await requireApprovedMember();

  const card = await getFeedEvent({
    eventId,
    seasonId: member.seasonId,
    viewerUserId: member.userId,
    viewerMembershipId: member.membershipId,
  });

  // Another season's event is indistinguishable from a missing one, on purpose.
  if (!card) notFound();

  const comments = await listComments(eventId);

  const thread: ThreadComment[] = comments.map((comment) => ({
    id: comment.id,
    membershipId: comment.membershipId,
    displayName: comment.displayName,
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
    deleted: comment.deletedAt !== null,
    canDelete:
      comment.deletedAt === null &&
      (comment.membershipId === member.membershipId || member.role === 'ADMIN'),
  }));

  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="px-4">
        <FeedCardView card={{ ...card, occurredAt: card.occurredAt.toISOString() }} />
      </div>
      <CommentThread eventId={eventId} comments={thread} />
    </div>
  );
}
```

- [ ] **Step 7: Prove the route compiles**

Run: `npm run build`
Expected: PASS, with `ƒ /feed/[eventId]` in the route list.

_Local only, skip in the cloud environment:_ open a card from `/feed`, post a comment, delete it, and confirm it renders as "Comment removed" rather than disappearing; then sign in as a second non-admin user and confirm the Delete control is absent on somebody else's comment. Both behaviors are already asserted server-side by the Task 11 tests (`deleteComment` soft-deletes and keeps the row; a non-author non-admin is rejected), so the cloud environment loses the visual confirmation only, not the coverage.

- [ ] **Step 8: Verify and commit**

Run: `npm run verify`
Expected: PASS.

```bash
git add 'src/app/(app)/feed/' src/server/feed/query.ts src/server/feed/__tests__/single-event.test.ts
git commit -m "feat: add the feed event detail screen with comments"
```

---

### Task 14: Member profiles

**Files:**

- Create: `src/server/feed/stats.ts`
- Create: `src/app/(app)/members/[membershipId]/page.tsx`
- Modify: `src/app/(app)/standings/page.tsx`
- Test: `src/server/feed/__tests__/stats.test.ts`

**Interfaces:**

- Consumes: `computeMemberStats` (Task 3), `getSeasonFeed` (Task 10).
- Produces: `getMemberProfile(opts: { membershipId: string; seasonId: string }): Promise<MemberProfile | null>` where `MemberProfile = { membershipId; userId; displayName; avatarUrl; status; balanceCents; rank; stats: MemberStats }`.

- [ ] **Step 1: Write the failing test**

Create `src/server/feed/__tests__/stats.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { games, seasonMemberships } from '@/db/schema';
import { placeBet } from '@/server/bets/place';
import { settleGame } from '@/server/bets/settle';
import { getMemberProfile } from '@/server/feed/stats';
import { resetDb } from '@/test/db';
import { makeMembership, seedBettableGame } from '@/server/bets/__tests__/helpers';
import { makeUser } from '@/test/factories';

describe('getMemberProfile', () => {
  beforeEach(resetDb);

  it('reports a settled win in the stats block', async () => {
    const { membership, user, seasonId } = await makeMembership();
    const game = await seedBettableGame();

    await placeBet({
      userId: user.id,
      type: 'SINGLE',
      stakeCents: 10_000n,
      legs: [{ selectionId: game.moneyline.home, line: null, priceAmerican: -110 }],
      clientRequestId: randomUUID(),
    });

    await db
      .update(games)
      .set({ status: 'FINAL', homeScore: 27, awayScore: 20 })
      .where(eq(games.id, game.game.id));
    await settleGame(game.game.id);

    const profile = await getMemberProfile({ membershipId: membership.id, seasonId });

    expect(profile?.displayName).toBe(user.displayName);
    expect(profile?.stats.won).toBe(1);
    expect(profile?.stats.netCents).toBe(9_091n);
    expect(profile?.stats.currentStreak).toEqual({ kind: 'W', length: 1 });
    expect(profile?.rank).toBe(1);
  });

  it('ranks by balance within the season', async () => {
    const { membership, seasonId } = await makeMembership(1_000_000n);
    const richer = await makeUser();
    await db
      .insert(seasonMemberships)
      .values({ userId: richer.id, seasonId, balanceCents: 2_000_000n });

    const profile = await getMemberProfile({ membershipId: membership.id, seasonId });
    expect(profile?.rank).toBe(2);
  });

  it('returns null for a membership in another season', async () => {
    const { membership } = await makeMembership();
    const other = await makeMembership();

    const profile = await getMemberProfile({
      membershipId: membership.id,
      seasonId: other.seasonId,
    });
    expect(profile).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npm test -- src/server/feed/__tests__/stats.test.ts`
Expected: FAIL — cannot resolve `@/server/feed/stats`.

- [ ] **Step 3: Write the loader**

Create `src/server/feed/stats.ts`:

```ts
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { bets, ledgerEntries, seasonMemberships, users } from '@/db/schema';
import { computeMemberStats, type BetOutcomeRow, type MemberStats } from '@/domain/stats';

export interface MemberProfile {
  membershipId: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  status: 'PENDING' | 'APPROVED' | 'DISABLED';
  balanceCents: bigint;
  rank: number;
  stats: MemberStats;
}

/**
 * One member's profile, scoped to a season.
 *
 * Returns null when the membership is not in the given season, so a crafted URL cannot read
 * across leagues.
 *
 * The per-bet payout is summed from the ledger rather than stored on the bet: a bet's payout
 * is whatever its settlement entries say, and re-settlement (D15) appends reversals rather
 * than rewriting them. Summing everything except BET_PLACED gives the net returned, which is
 * exactly what `computeMemberStats` wants.
 */
export async function getMemberProfile(opts: {
  membershipId: string;
  seasonId: string;
}): Promise<MemberProfile | null> {
  const [row] = await db
    .select({
      membershipId: seasonMemberships.id,
      userId: users.id,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      status: users.status,
      balanceCents: seasonMemberships.balanceCents,
    })
    .from(seasonMemberships)
    .innerJoin(users, eq(seasonMemberships.userId, users.id))
    .where(
      and(
        eq(seasonMemberships.id, opts.membershipId),
        eq(seasonMemberships.seasonId, opts.seasonId),
      ),
    );

  if (!row) return null;

  const [{ ahead }] = await db
    .select({ ahead: sql<number>`count(*)::int` })
    .from(seasonMemberships)
    .where(
      and(
        eq(seasonMemberships.seasonId, opts.seasonId),
        sql`${seasonMemberships.balanceCents} > ${row.balanceCents}`,
      ),
    );

  const betRows = await db
    .select({
      status: bets.status,
      stakeCents: bets.stakeCents,
      settledAt: bets.settledAt,
      returnedCents: sql<string>`COALESCE((
        SELECT SUM(${ledgerEntries.amountCents})
        FROM ${ledgerEntries}
        WHERE ${ledgerEntries.betId} = ${bets.id}
          AND ${ledgerEntries.type} <> 'BET_PLACED'
      ), 0)`,
    })
    .from(bets)
    .where(eq(bets.membershipId, opts.membershipId));

  const outcomes: BetOutcomeRow[] = betRows.map((bet) => ({
    status: bet.status,
    stakeCents: bet.stakeCents,
    payoutCents: BigInt(bet.returnedCents),
    settledAt: bet.settledAt,
  }));

  return {
    ...row,
    rank: ahead + 1,
    stats: computeMemberStats(outcomes),
  };
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `npm test -- src/server/feed/__tests__/stats.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the profile page**

Create `src/app/(app)/members/[membershipId]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Money } from '@/components/ui/money';
import { requireApprovedMember } from '@/server/auth/session';
import { getSeasonFeed } from '@/server/feed/query';
import { getMemberProfile } from '@/server/feed/stats';
import { FeedCardView } from '../../feed/feed-card';

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <span className="text-xs uppercase tracking-wide text-zinc-500">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{children}</span>
    </div>
  );
}

export default async function MemberProfilePage({ params }: PageProps<'/members/[membershipId]'>) {
  const { membershipId } = await params;
  const member = await requireApprovedMember();

  const profile = await getMemberProfile({ membershipId, seasonId: member.seasonId });
  if (!profile) notFound();

  const history = await getSeasonFeed({
    seasonId: member.seasonId,
    viewerUserId: member.userId,
    viewerMembershipId: member.membershipId,
    subjectMembershipId: membershipId,
    limit: 20,
  });

  const { stats } = profile;
  const roi = stats.roiBasisPoints === null ? '—' : `${(stats.roiBasisPoints / 100).toFixed(1)}%`;
  const streak =
    stats.currentStreak.kind === 'NONE'
      ? '—'
      : `${stats.currentStreak.kind}${stats.currentStreak.length}`;

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">{profile.displayName}</h1>
          <span className="text-xs text-zinc-500">Rank #{profile.rank}</span>
        </div>
        <div className="flex items-center gap-2">
          {profile.status === 'DISABLED' ? <Badge>Disabled</Badge> : null}
          <Money cents={profile.balanceCents} className="text-base font-semibold" />
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Record">
          {stats.won}-{stats.lost}
          {stats.pushed > 0 ? `-${stats.pushed}` : ''}
        </Stat>
        <Stat label="ROI">{roi}</Stat>
        <Stat label="Net">
          <Money cents={stats.netCents} />
        </Stat>
        <Stat label="Streak">{streak}</Stat>
        <Stat label="Biggest win">
          <Money cents={stats.biggestWinCents} />
        </Stat>
        <Stat label="Pending">
          {stats.pending} · <Money cents={stats.pendingStakeCents} />
        </Stat>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Recent</h2>
        {history.cards.length === 0 ? (
          <p className="text-sm text-zinc-500">No activity yet.</p>
        ) : (
          history.cards.map((card) => (
            <FeedCardView
              key={card.id}
              card={{ ...card, occurredAt: card.occurredAt.toISOString() }}
            />
          ))
        )}
      </section>
    </div>
  );
}
```

If `src/components/ui/badge.tsx` does not export a component that takes children this way, read it first and match its actual API rather than changing it.

- [ ] **Step 6: Link standings rows to profiles**

In `src/app/(app)/standings/page.tsx`, add the import and wrap the name in a link. Keep every other line as it is:

```tsx
import Link from 'next/link';
```

```tsx
<Link
  href={`/members/${row.membershipId}`}
  className="flex-1 truncate text-sm font-medium hover:underline"
>
  {row.displayName}
</Link>
```

- [ ] **Step 7: Verify and commit**

Run: `npm run verify`
Expected: PASS.

```bash
git add src/server/feed/stats.ts src/server/feed/__tests__/stats.test.ts 'src/app/(app)/members/' 'src/app/(app)/standings/page.tsx'
git commit -m "feat: add member profiles with season statistics"
```

---

### Task 15: Feed preferences screen

**Files:**

- Create: `src/app/(app)/me/feed-preferences/page.tsx`
- Create: `src/app/(app)/me/feed-preferences/preferences-form.tsx`
- Modify: `src/app/(app)/me/page.tsx`

**Interfaces:**

- Consumes: `getMutedTypes`, `setMutedTypes` (Task 10).
- Produces: `saveFeedPreferencesAction(mutedTypes: FeedEventType[]): Promise<{ saved: true }>`.

- [ ] **Step 1: Write the page's server action and page**

Create `src/app/(app)/me/feed-preferences/page.tsx`:

```tsx
import { revalidatePath } from 'next/cache';
import type { FeedEventType } from '@/db/schema';
import { requireApprovedMember, requireApprovedMemberOrThrow } from '@/server/auth/session';
import { getMutedTypes, setMutedTypes } from '@/server/feed/preferences';
import { PreferencesForm, type PreferenceOption } from './preferences-form';

/** Every type a member can mute, with copy that says what they'd stop seeing. */
const OPTIONS: PreferenceOption[] = [
  { type: 'BET_PLACED', label: 'Bets placed', description: 'When somebody places a bet' },
  { type: 'BET_SETTLED', label: 'Bets settled', description: 'How everyone’s bets resolved' },
  { type: 'MEMBER_JOINED', label: 'New members', description: 'When somebody joins the season' },
  { type: 'ALLOWANCE_PAID', label: 'Weekly allowance', description: 'The weekly allowance card' },
  {
    type: 'ADMIN_ADJUSTMENT',
    label: 'Admin adjustments',
    description: 'Balance changes made by an admin',
  },
  {
    type: 'MILESTONE_LEAD_CHANGE',
    label: 'Lead changes',
    description: 'When the standings lead changes hands',
  },
  { type: 'MILESTONE_BIG_WIN', label: 'Big wins', description: 'Payouts of 10× or better' },
  {
    type: 'MILESTONE_PARLAY_HIT',
    label: 'Parlay hits',
    description: 'Parlays of four legs or more cashing',
  },
];

async function saveFeedPreferencesAction(mutedTypes: FeedEventType[]): Promise<{ saved: true }> {
  'use server';

  const member = await requireApprovedMemberOrThrow();
  await setMutedTypes(member.userId, mutedTypes);
  revalidatePath('/feed');
  revalidatePath('/me/feed-preferences');
  return { saved: true };
}

export default async function FeedPreferencesPage() {
  const member = await requireApprovedMember();
  const muted = await getMutedTypes(member.userId);

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Feed filters</h1>
        <p className="text-sm text-zinc-500">
          Turn anything off to hide it from your feed. Nothing is deleted — turning it back on
          brings the history with it.
        </p>
      </header>

      <PreferencesForm options={OPTIONS} muted={muted} onSave={saveFeedPreferencesAction} />
    </div>
  );
}
```

If the bundled docs say an inline `'use server'` function cannot be passed to a client component as a prop in this version, move `saveFeedPreferencesAction` into `src/app/(app)/feed/actions.ts` alongside the others and import it in the client component directly. Check before assuming.

- [ ] **Step 2: Write the form**

Create `src/app/(app)/me/feed-preferences/preferences-form.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import type { FeedEventType } from '@/db/schema';

export interface PreferenceOption {
  type: FeedEventType;
  label: string;
  description: string;
}

export function PreferencesForm({
  options,
  muted,
  onSave,
}: {
  options: PreferenceOption[];
  muted: FeedEventType[];
  onSave: (mutedTypes: FeedEventType[]) => Promise<{ saved: true }>;
}) {
  const [mutedSet, setMutedSet] = useState(() => new Set(muted));
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function toggle(type: FeedEventType) {
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
      await onSave([...mutedSet]);
      setSaved(true);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {options.map((option) => {
        const shown = !mutedSet.has(option.type);
        return (
          <label
            key={option.type}
            className="flex items-start gap-3 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950"
          >
            <input
              type="checkbox"
              checked={shown}
              onChange={() => toggle(option.type)}
              className="mt-0.5"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{option.label}</span>
              <span className="text-xs text-zinc-500">{option.description}</span>
            </span>
          </label>
        );
      })}

      <div className="flex items-center justify-end gap-3 pt-2">
        {saved ? <span className="text-xs text-emerald-600">Saved</span> : null}
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Link it from the Me tab**

Read `src/app/(app)/me/page.tsx` and add a link near the top of the page, matching whatever heading structure is already there:

```tsx
<Link href="/me/feed-preferences" className="text-xs text-zinc-500 hover:underline">
  Feed filters
</Link>
```

- [ ] **Step 4: Prove it compiles, verify and commit**

Run: `npm run build`
Expected: PASS, with `ƒ /me/feed-preferences` in the route list. This is also where an inline `'use server'` function passed as a prop will fail if this Next version disallows it — if it does, move the action into `src/app/(app)/feed/actions.ts` as Step 1 noted.

_Local only, skip in the cloud environment:_ uncheck "Weekly allowance", save, and confirm the allowance card disappears from `/feed`, then re-check it and confirm it comes back. The Task 10 muting test already asserts exactly this round trip against the database.

Run: `npm run verify`
Expected: PASS.

```bash
git add 'src/app/(app)/me/'
git commit -m "feat: add per-member feed filters"
```

---

### Task 16: End-to-end coverage and documentation

**Files:**

- Modify: `src/server/__tests__/end-to-end.test.ts`
- Modify: `docs/README.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/specs/2026-08-17-social-layer-design.md` — status line

**Interfaces:**

- Consumes: everything above. Produces nothing new.

- [ ] **Step 1: Read the existing end-to-end test**

Open `src/server/__tests__/end-to-end.test.ts` and find where it has finished placing and settling bets and is asserting balances. The feed assertions go there, in the same test, so they run against exactly the same state the money assertions do.

- [ ] **Step 2: Add the feed assertions**

Append to that test, adapting the variable names to whatever the file already uses:

```ts
// The feed is a read model over the same events the ledger recorded. If these two ever
// disagree, one of them is lying.
const events = await db
  .select({ type: feedEvents.type, betId: feedEvents.betId })
  .from(feedEvents)
  .orderBy(asc(feedEvents.occurredAt), asc(feedEvents.id));

const types = events.map((event) => event.type);
expect(types).toContain('BET_PLACED');
expect(types).toContain('BET_SETTLED');

// Every settled bet got exactly one card, and every card points at a real bet.
const placedCards = events.filter((event) => event.type === 'BET_PLACED');
expect(new Set(placedCards.map((card) => card.betId)).size).toBe(placedCards.length);
expect(placedCards.every((card) => card.betId !== null)).toBe(true);
```

with these added to the file's imports:

```ts
import { feedEvents } from '@/db/schema';
```

- [ ] **Step 3: Run the full suite**

Run: `npm run verify`
Expected: PASS. Note the final test-file and test counts from the output — the docs update quotes them.

- [ ] **Step 4: Update the spec's status line**

In `docs/specs/2026-08-17-social-layer-design.md`, change:

```markdown
**Status:** Specified, not built
```

to:

```markdown
**Status:** Built
```

- [ ] **Step 5: Update the roadmap and the docs index**

In `docs/roadmap.md`, change subsystem 2's status cell from `[Specified](specs/2026-08-17-social-layer-design.md) — not built` to `[Built](specs/2026-08-17-social-layer-design.md)`.

In `docs/README.md`, extend the "Where things stand" section with what subsystem 2 added — the feed and its eight event types, reactions and comments, member profiles, per-viewer filters — and update the quoted test counts to whatever Step 3 reported. Keep the existing prose about subsystem 1 intact; add to it rather than rewriting it.

- [ ] **Step 6: Add any decisions made along the way**

If implementing this plan forced a choice the spec did not anticipate — the way D18 came out of subsystem 1's build — add an entry to `docs/decisions.md` with the next number after D29, dated, saying what was chosen and what was rejected. Do not edit an existing entry; the log only grows.

- [ ] **Step 7: Final verify and commit**

Run: `npm run verify`
Expected: PASS.

```bash
git add src/server/__tests__/end-to-end.test.ts docs/
git commit -m "test: assert the feed's event sequence end to end"
git push -u origin claude/subsystem-2-plan-27h377
```

---

## Self-Review

Checked against the spec, section by section:

| Spec section                                          | Covered by                      |
| ----------------------------------------------------- | ------------------------------- |
| `feed_events` table, indexes, dedupe keys             | Task 1                          |
| Payload types, money-as-string                        | Task 2                          |
| `emitFeedEvent` mirroring `postEntry`                 | Task 2                          |
| `feed_reactions`, allowed emoji set                   | Tasks 1, 11                     |
| `feed_comments`, soft delete, author/admin rules      | Tasks 1, 11                     |
| `feed_preferences`, read-time muting                  | Tasks 1, 10                     |
| Profile statistics and their definitions              | Tasks 3, 14                     |
| Milestone thresholds                                  | Task 4                          |
| `BET_PLACED` emission                                 | Task 5                          |
| `BET_SETTLED` + big win + parlay hit                  | Task 6                          |
| Correction cards on re-settlement                     | Task 7                          |
| `MEMBER_JOINED`, `ALLOWANCE_PAID`, `ADMIN_ADJUSTMENT` | Task 8                          |
| Lead-change detection and its three rules             | Task 9                          |
| Keyset pagination, three-query read                   | Task 10                         |
| Five-tab bar, feed screen                             | Task 12                         |
| Event detail and comment thread                       | Task 13                         |
| Member profile, standings links                       | Task 14                         |
| Feed preferences screen                               | Task 15                         |
| Every test in the spec's Testing section              | Tasks 1–16, one per listed case |

**Environment verified:** the setup in [Environment setup](#environment-setup) was executed in the Claude Code cloud environment on 2026-08-17 — `npm ci`, a locally started Postgres 16 (no Docker), `npm run db:migrate:test`, `npm run verify` at 26 files / 222 tests passing, and `npm run build` compiling all 17 existing routes. Every task in this plan is executable there. The only thing that is not is signing into the running app, because sign-in is Google OAuth with no dev bypass; Tasks 12–15 substitute `npm run build` for their browser steps and say so.

**Known open item for the implementer:** the bundled Next.js documentation could not be read when this plan was written, because `node_modules` was not yet installed at that point. Tasks 12–15 use the conventions the existing code in this repo demonstrates (`LayoutProps<'/'>`-style generated route types, `'use server'` action files, `revalidatePath`), and each UI task begins by telling you to confirm those conventions against `node_modules/next/dist/docs/`. If a convention differs, follow the docs and adjust the code shown here — the shapes of the data and the server functions are what matter and those are settled.
