# Peer-to-Peer Bets (Subsystem 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let two members bet each other directly — one offers terms, the other accepts, both stakes are escrowed in credits, and the winner takes the pot. Wagers attach either to a market the engine already grades or to a freeform description the two parties settle themselves, with admins arbitrating when they disagree.

**Architecture:** One new table, `p2p_wagers`, owning its own lifecycle. It reuses the _machinery_ — `postEntry` for money, `emitFeedEvent` for cards, `gradeLeg` and `gradeCustomLeg` for market-backed verdicts, the `settle` and `reconcile` cron routes for background work — while sharing no table with `bets`. `bets`, `bet_legs`, `placeBet`, `settleGame` and `resettleBet` are **not modified at all**, so this subsystem cannot regress the money paths subsystems 1 and 3 stand on. Escrow adds three ledger entry types and one nullable column; everything else is additive.

**Tech Stack:** Next.js 16.3.1 (App Router, React 19.2.8, Server Components + server actions), TypeScript 5, Drizzle ORM 0.45 on Postgres 16, Vitest 4, Tailwind 4.

**Read first:** [`docs/specs/2026-08-19-peer-to-peer-bets-design.md`](../specs/2026-08-19-peer-to-peer-bets-design.md) is the spec this plan implements. [`docs/decisions.md`](../decisions.md) D40–D48 explain why each choice was made; D5, D10, D15, D17, D21, D25, D37 explain the properties of the existing engine this must not break. You do not need to read the subsystem 1–3 specs to execute this plan, but they are the reference if something about the existing engine is unclear.

---

## Global Constraints

- **This is NOT the Next.js you know.** Per `AGENTS.md`, this version has breaking changes from your training data. Before writing any UI code (Tasks 15–18), read the relevant guide in `node_modules/next/dist/docs/`. In particular confirm how `params` and `searchParams` are typed and awaited in dynamic routes and how server actions are declared. The existing code uses generated route types — `src/app/(app)/bets/page.tsx` takes `PageProps<'/bets'>` — so a dynamic page uses `PageProps<'/wagers/[wagerId]'>` rather than a hand-written props type.
- **All money is integer cents as `bigint`** ([D17](../decisions.md#d17--all-money-is-integer-cents)). No floating-point value touches a balance. Ratios are integer basis points.
- **`bigint` is not serializable** across a server action boundary or into JSON. Cents cross those boundaries as decimal strings (`"95450"`) and are re-parsed with `BigInt()`. This is already the convention in `src/app/(app)/bets/actions.ts` and in every feed payload ([D25](../decisions.md#d25--money-inside-a-feed-payload-is-a-decimal-string)).
- **Every peer-to-peer wager moves `CREDITS`, never `CASH`** ([D40](../decisions.md#d40--every-peer-to-peer-wager-moves-credits-including-the-market-backed-kind)). There is no branch anywhere in this subsystem that selects a currency. If you find yourself writing one, stop — the absence of that branch is the guarantee.
- **Do not modify `bets`, `bet_legs`, `placeBet`, `settleGame`, `settleFinalGames` or `resettleBet`.** They are read-only for this plan. `settleBetsForLegs` in `src/server/bets/grade-legs.ts` is also read-only — a wager is not a bet and must not enter that path ([D42](../decisions.md#d42--a-wager-is-its-own-table-not-two-bets-and-not-a-two-person-custom-event)).
- **`gradeLeg`, `gradeCustomLeg`, `gradeParlay`, `settledPayoutCents` and everything in `src/domain/odds.ts` are read-only.** Market-backed verdicts call them unchanged.
- **Every ledger write and every feed write carries a deterministic idempotency/dedupe key.** Running any job twice must move no extra money and create no extra feed events.
- **Authorization is server-side on every request**, never by hiding UI. Use the existing `requireApprovedMember()` (pages, redirects), `requireApprovedMemberOrThrow()` (server actions, throws), and `requireAdmin()` (admin pages) from `src/server/auth/session.ts`.
- **Verification command:** `npm run verify` (typecheck + lint + test). It must pass before the final commit of every task. **Three pre-existing lint _warnings_ exist** and are not yours to fix: `src/server/bets/grade-legs.ts:3` unused `betLegs`, `src/server/feed/__tests__/leaders.test.ts:28` unused `seasonId`, `src/server/feed/__tests__/money-emission.test.ts:33` unused `_`. Zero lint **errors** is the bar.
- **Baseline:** `npm run verify` passes at **59 test files / 411 tests** before Task 1. Every existing test must still pass, with its behavior unchanged, after every task.
- **Commit after every task**, with a `feat:` / `fix:` / `test:` / `docs:` prefix matching the existing history style.
- **UI polish is deferred by decision of the project owner.** Tasks 15–18 must be correct, server-side authorized, and complete enough to exercise every path the services expose. They do not need to be finished design — match the existing screens' Tailwind idiom, reuse `src/components/ui/{badge,empty-state,money}.tsx`, keep the markup plain, and do not spend task budget on layout experiments.

---

## Environment setup

Run this once at the start of the session, before Task 1. **These commands were executed and verified in this Claude Code cloud environment on 2026-08-19:** `npm ci` succeeds through the proxy, and `npm run verify` passes clean at **59 files / 411 tests** against the database this sets up.

**Docker is not available.** The `docker` CLI is installed but no daemon is running, so `npm run db:up`, `npm run db:down` and `npm run db:reset` all fail. Do not try to start the daemon — a full Postgres 16 cluster is already installed locally, which is what the commands below use instead. The only difference from the compose file is the port: **5432**, not 5433.

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

Expected from the last command: **59 test files, 411 tests, all passing**, with 0 lint errors and the 3 pre-existing warnings listed above. If that does not hold, stop and fix the environment before starting Task 1 — every task gates on `npm run verify`, and you cannot tell your own regression from a broken setup.

All three `.env` files are covered by `.gitignore` (`.env*`), so they will not be committed. **Re-run `npm run db:migrate:test` after every task that adds a migration** (Tasks 1, 2, 4).

**The running app cannot be signed into here.** Sign-in is Google OAuth only ([D20](../decisions.md#d20--auth-google-only-apple-dropped)) with no dev bypass, so `npm run dev` serves the app but you cannot get past `/sign-in` without real Google credentials. Tasks 15–18 therefore mark their browser steps as local-only and give a substitute gate that does work here: `npm run build`, which compiles every route for real and is what catches server/client boundary mistakes — the actual risk in those tasks.

---

## File Structure

**New files**

| Path                                               | Responsibility                                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/db/schema/p2p.ts`                             | `p2p_wagers` table and its three enums                                                                   |
| `src/domain/p2p.ts`                                | Pure: `verdictForLegStatus`, `potCents`, `agreedVerdict`, `isDisputed`, `isOverdue`, `computeHeadToHead` |
| `src/server/p2p/types.ts`                          | Input/result/error types shared by the wager services                                                    |
| `src/server/p2p/offer.ts`                          | `offerWager`, `cancelOffer`, `declineWager`                                                              |
| `src/server/p2p/accept.ts`                         | `acceptWager`                                                                                            |
| `src/server/p2p/settle-wager.ts`                   | `settleWagerInTx` — the one payout path, shared by claim, sweep and arbitration                          |
| `src/server/p2p/claim.ts`                          | `claimWinner`, `proposeCancel`                                                                           |
| `src/server/p2p/sweep.ts`                          | `sweepP2PWagers` — expire, settle market-backed, flag overdue                                            |
| `src/server/p2p/arbitrate.ts`                      | `arbitrateWager`                                                                                         |
| `src/server/p2p/query.ts`                          | Board, detail and head-to-head reads                                                                     |
| `src/app/(app)/wagers/page.tsx`                    | The wagers board                                                                                         |
| `src/app/(app)/wagers/actions.ts`                  | Server actions: offer, accept, decline, cancel, claim, propose-cancel                                    |
| `src/app/(app)/wagers/new/page.tsx`                | Offer-a-wager screen                                                                                     |
| `src/app/(app)/wagers/new/wager-form.tsx`          | Client component: kind toggle, opponent picker, stakes                                                   |
| `src/app/(app)/wagers/[wagerId]/page.tsx`          | Wager detail with the viewer's available actions                                                         |
| `src/app/(app)/wagers/[wagerId]/wager-actions.tsx` | Client component: accept / decline / cancel / claim / propose-cancel                                     |
| `src/app/admin/wagers/page.tsx`                    | Arbitration queue: disputed and overdue                                                                  |
| `src/app/admin/wagers/actions.ts`                  | Server action: arbitrate                                                                                 |
| `src/server/p2p/__tests__/*.test.ts`               | One test file per service                                                                                |
| `src/domain/__tests__/p2p.test.ts`                 | Pure-function tests, no database                                                                         |

**Modified files**

| Path                                            | Change                                                                        |
| ----------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/db/schema/index.ts`                        | Export `./p2p`                                                                |
| `src/db/schema/money.ts`                        | Three new `ledger_entry_type` values; `ledger_entries.p2p_wager_id`           |
| `src/db/schema/social.ts`                       | Five new `feed_event_type` values                                             |
| `src/server/feed/payload.ts`                    | Five new payload interfaces, added to the `FeedEventPayload` union            |
| `src/server/money/reconcile.ts`                 | Add `reconcileEscrow` beside `reconcileBalances`                              |
| `src/app/api/cron/settle/route.ts`              | Call `sweepP2PWagers`                                                         |
| `src/app/api/cron/reconcile/route.ts`           | Call `reconcileEscrow`                                                        |
| `src/test/db.ts`                                | Truncate `p2p_wagers`                                                         |
| `src/test/factories.ts`                         | `makeCreditedMembership`, `makeWager` helpers                                 |
| `src/components/ui/tab-bar.tsx`                 | No change to the tab list — comment updated to record why (D-note in Task 15) |
| `src/app/(app)/bets/page.tsx`                   | Bets \| Wagers segmented control                                              |
| `src/app/(app)/feed/feed-card.tsx`              | Render the five new card types                                                |
| `src/app/(app)/members/[membershipId]/page.tsx` | Head-to-head block                                                            |
| `src/server/__tests__/end-to-end.test.ts`       | The peer-to-peer arc                                                          |
| `docs/README.md`, `docs/roadmap.md`             | Mark subsystem 4 built                                                        |

## Task order and why

Tasks 1–4 are vocabulary: the table, the ledger's new entry types, the pure functions, and the feed's new card types. None of them can move money and all four are independently testable. Tasks 5–7 are the offer/accept half of the lifecycle — after Task 7 credits can be escrowed and released, which is the first point the escrow invariant is real. Task 8 builds the single payout path, and Tasks 9–12 are its four callers (claim, mutual cancel, sweep, arbitration). Task 13 adds the check that proves the whole thing conserves credits. Task 14 is reads. Tasks 15–18 are UI. Task 19 proves the arc end to end.

**Do not build Task 9 before Task 8.** `claimWinner` calls `settleWagerInTx`; writing the payout inline in claim and extracting it later produces two payout paths, and the second one is where the drift will be.

---

### Task 1: The `p2p_wagers` table

**Files:**

- Create: `src/db/schema/p2p.ts`
- Modify: `src/db/schema/index.ts`, `src/test/db.ts`, `src/test/factories.ts`
- Test: `src/db/__tests__/p2p-schema.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces:
  - `p2pWagers` table, and the enums `p2pWagerKind`, `p2pWagerStatus`, `p2pVerdict`
  - Types `P2PWagerKind = 'MARKET' | 'FREEFORM'`, `P2PWagerStatus = 'OFFERED' | 'ACCEPTED' | 'SETTLED' | 'VOIDED' | 'CANCELED' | 'EXPIRED'`, `P2PVerdict = 'OFFERER' | 'ACCEPTOR' | 'VOID'`
  - `makeCreditedMembership(creditsCents?, seasonId?)` and `makeWager(opts)` in `src/test/factories.ts`

- [ ] **Step 1: Write the failing test**

Create `src/db/__tests__/p2p-schema.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { p2pWagers } from '@/db/schema';
import { resetDb } from '@/test/db';
import { makeCreditedMembership } from '@/test/factories';

describe('p2p_wagers schema', () => {
  beforeEach(resetDb);

  it('stores a freeform offer with both stakes and no acceptor', async () => {
    const offerer = await makeCreditedMembership(100_000n);

    const [row] = await db
      .insert(p2pWagers)
      .values({
        seasonId: offerer.seasonId,
        kind: 'FREEFORM',
        offererMembershipId: offerer.membership.id,
        offererStakeCents: 50_000n,
        acceptorStakeCents: 20_000n,
        description: 'Jake cannot name ten starting quarterbacks',
        expiresAt: new Date('2026-09-01T00:00:00Z'),
        resolvesBy: new Date('2026-09-08T00:00:00Z'),
      })
      .returning();

    expect(row.status).toBe('OFFERED');
    expect(row.kind).toBe('FREEFORM');
    expect(row.acceptorMembershipId).toBeNull();
    expect(row.opponentMembershipId).toBeNull();
    expect(row.verdict).toBeNull();
    expect(row.offererClaim).toBeNull();
    expect(row.acceptorClaim).toBeNull();
    expect(row.offererCancelProposed).toBe(false);
    expect(row.acceptorCancelProposed).toBe(false);
    expect(row.settlementAttempts).toBe(0);
    expect(row.offererStakeCents).toBe(50_000n);
    expect(row.acceptorStakeCents).toBe(20_000n);
  });

  it('rejects a FREEFORM wager that carries a selection', async () => {
    const offerer = await makeCreditedMembership(100_000n);

    await expect(
      db.insert(p2pWagers).values({
        seasonId: offerer.seasonId,
        kind: 'FREEFORM',
        offererMembershipId: offerer.membership.id,
        offererStakeCents: 1_000n,
        acceptorStakeCents: 1_000n,
        description: 'something',
        // A selection id that does not exist is fine — the CHECK fires before the FK.
        selectionId: '00000000-0000-4000-8000-000000000000',
        expiresAt: new Date('2026-09-01T00:00:00Z'),
        resolvesBy: new Date('2026-09-08T00:00:00Z'),
      }),
    ).rejects.toThrow(/p2p_wagers_kind_shape/);
  });

  it('rejects a MARKET wager with no selection', async () => {
    const offerer = await makeCreditedMembership(100_000n);

    await expect(
      db.insert(p2pWagers).values({
        seasonId: offerer.seasonId,
        kind: 'MARKET',
        offererMembershipId: offerer.membership.id,
        offererStakeCents: 1_000n,
        acceptorStakeCents: 1_000n,
        expiresAt: new Date('2026-09-01T00:00:00Z'),
        resolvesBy: new Date('2026-09-08T00:00:00Z'),
      }),
    ).rejects.toThrow(/p2p_wagers_kind_shape/);
  });

  it('rejects a non-positive stake', async () => {
    const offerer = await makeCreditedMembership(100_000n);

    await expect(
      db.insert(p2pWagers).values({
        seasonId: offerer.seasonId,
        kind: 'FREEFORM',
        offererMembershipId: offerer.membership.id,
        offererStakeCents: 0n,
        acceptorStakeCents: 1_000n,
        description: 'something',
        expiresAt: new Date('2026-09-01T00:00:00Z'),
        resolvesBy: new Date('2026-09-08T00:00:00Z'),
      }),
    ).rejects.toThrow(/p2p_wagers_positive_stakes/);
  });

  it('round-trips a settled wager with a verdict', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const acceptor = await makeCreditedMembership(100_000n, offerer.seasonId);

    const [row] = await db
      .insert(p2pWagers)
      .values({
        seasonId: offerer.seasonId,
        kind: 'FREEFORM',
        status: 'SETTLED',
        offererMembershipId: offerer.membership.id,
        acceptorMembershipId: acceptor.membership.id,
        offererStakeCents: 50_000n,
        acceptorStakeCents: 20_000n,
        description: 'a settled bet',
        expiresAt: new Date('2026-09-01T00:00:00Z'),
        resolvesBy: new Date('2026-09-08T00:00:00Z'),
        offererClaim: 'OFFERER',
        acceptorClaim: 'OFFERER',
        verdict: 'OFFERER',
        settlementAttempts: 1,
      })
      .returning();

    const [read] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, row.id));
    expect(read.verdict).toBe('OFFERER');
    expect(read.acceptorMembershipId).toBe(acceptor.membership.id);
    expect(read.settlementAttempts).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/db/__tests__/p2p-schema.test.ts`
Expected: FAIL — `p2pWagers` is not exported from `@/db/schema`, and `makeCreditedMembership` is not exported from `@/test/factories`.

- [ ] **Step 3: Create the schema file**

Create `src/db/schema/p2p.ts`:

```ts
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { seasonMemberships, seasons, users } from './identity';
import { selections } from './sports';

export const p2pWagerKind = pgEnum('p2p_wager_kind', ['MARKET', 'FREEFORM']);
export const p2pWagerStatus = pgEnum('p2p_wager_status', [
  'OFFERED',
  'ACCEPTED',
  'SETTLED',
  'VOIDED',
  'CANCELED',
  'EXPIRED',
]);
export const p2pVerdict = pgEnum('p2p_verdict', ['OFFERER', 'ACCEPTOR', 'VOID']);

export type P2PWagerKind = (typeof p2pWagerKind.enumValues)[number];
export type P2PWagerStatus = (typeof p2pWagerStatus.enumValues)[number];
export type P2PVerdict = (typeof p2pVerdict.enumValues)[number];

/**
 * A direct wager between two members (D42).
 *
 * Deliberately not two rows in `bets`: a bet carries a price and a potential payout, and a
 * wager has neither — its terms are two explicit stakes and the pot is their sum (D41).
 * Keeping it separate is also what stops `settleGame`'s pending-leg sweep from ever finding
 * a wager and trying to pay it from the house's side of the table.
 *
 * `opponentMembershipId` null means the offer is open to the season; set means it is a
 * challenge only that member may accept.
 *
 * `settlementAttempts` is `bets.settlement_attempts` under another name and for the same
 * reason: an admin correction must write idempotency keys that cannot collide with the
 * payout it is correcting (D15).
 *
 * There is no `DISPUTED` or `OVERDUE` status and no `pot_cents` column. Disputed is *both
 * claims set and unequal*, overdue is *past `resolvesBy` with no agreed verdict*, and the pot
 * is the sum of the two stakes — all three are derived, because a stored copy is a second
 * place for the same fact to live and disagree from (D44).
 */
export const p2pWagers = pgTable(
  'p2p_wagers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => seasons.id),
    kind: p2pWagerKind('kind').notNull(),
    status: p2pWagerStatus('status').notNull().default('OFFERED'),

    offererMembershipId: uuid('offerer_membership_id')
      .notNull()
      .references(() => seasonMemberships.id),
    acceptorMembershipId: uuid('acceptor_membership_id').references(() => seasonMemberships.id),
    /** Null = open to the season. Set = a directed challenge. */
    opponentMembershipId: uuid('opponent_membership_id').references(() => seasonMemberships.id),

    offererStakeCents: bigint('offerer_stake_cents', { mode: 'bigint' }).notNull(),
    acceptorStakeCents: bigint('acceptor_stake_cents', { mode: 'bigint' }).notNull(),

    /** MARKET only. The offerer holds this selection; the acceptor holds its negation. */
    selectionId: uuid('selection_id').references(() => selections.id),
    /** Frozen at offer, exactly as bet_legs.line_at_placement is frozen at placement (D10). */
    lineAtOffer: numeric('line_at_offer', { precision: 5, scale: 2 }),
    /** FREEFORM only. */
    description: text('description'),

    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    resolvesBy: timestamp('resolves_by', { withTimezone: true }).notNull(),

    offererClaim: p2pVerdict('offerer_claim'),
    acceptorClaim: p2pVerdict('acceptor_claim'),
    offererCancelProposed: boolean('offerer_cancel_proposed').notNull().default(false),
    acceptorCancelProposed: boolean('acceptor_cancel_proposed').notNull().default(false),

    verdict: p2pVerdict('verdict'),
    settlementAttempts: integer('settlement_attempts').notNull().default(0),
    resolvedByUserId: uuid('resolved_by_user_id').references(() => users.id),
    resolutionNote: text('resolution_note'),

    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'p2p_wagers_kind_shape',
      sql`(${t.kind} = 'MARKET' AND ${t.selectionId} IS NOT NULL AND ${t.description} IS NULL)
       OR (${t.kind} = 'FREEFORM' AND ${t.selectionId} IS NULL AND ${t.description} IS NOT NULL)`,
    ),
    check(
      'p2p_wagers_positive_stakes',
      sql`${t.offererStakeCents} > 0 AND ${t.acceptorStakeCents} > 0`,
    ),
    index('p2p_wagers_season_status_idx').on(t.seasonId, t.status),
    index('p2p_wagers_offerer_idx').on(t.offererMembershipId),
    index('p2p_wagers_acceptor_idx').on(t.acceptorMembershipId),
    index('p2p_wagers_selection_idx').on(t.selectionId),
    // Both sweeps run every ten minutes forever; the partial indexes keep them off the
    // settled bulk of the table, exactly as bet_legs_pending_idx does for settlement.
    index('p2p_wagers_open_idx')
      .on(t.expiresAt)
      .where(sql`${t.status} = 'OFFERED'`),
    index('p2p_wagers_live_idx')
      .on(t.resolvesBy)
      .where(sql`${t.status} = 'ACCEPTED'`),
  ],
);
```

- [ ] **Step 4: Export it from the schema barrel**

In `src/db/schema/index.ts`, add the export. The file must read:

```ts
export * from './currency';
export * from './events';
export * from './identity';
export * from './sports';
export * from './betting';
export * from './money';
export * from './social';
export * from './p2p';
```

- [ ] **Step 5: Add the truncate to the test reset**

`src/test/db.ts` must truncate the new table or every test after the first leaks rows into the next. Replace the `TRUNCATE` list so `p2p_wagers` comes **before** `selections`, `season_memberships` and `seasons` (it references all three):

```ts
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

export async function resetDb(): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE feed_reactions, feed_comments, feed_events, feed_preferences, ledger_entries, p2p_wagers, bet_legs, bets, odds_snapshots, selections, markets, games, custom_event_disputes, custom_events, events, teams, season_memberships, seasons, users RESTART IDENTITY CASCADE`,
  );
}
```

- [ ] **Step 6: Add the test factories**

Append to `src/test/factories.ts`. Note the existing `makeMembership` in that file returns _only_ the membership and always creates its own season; these tests need the user and season id too, and need credits, so this is a new helper rather than a change to the old one.

First extend the imports at the top of the file to include what the new helpers use:

```ts
import { db } from '@/db/client';
import {
  customEvents,
  events,
  markets,
  p2pWagers,
  seasonMemberships,
  seasons,
  selections,
  users,
} from '@/db/schema';
import type { P2PWagerKind, P2PWagerStatus } from '@/db/schema';
```

Then append:

```ts
/**
 * A membership in an ACTIVE season with a credits balance, which is what every P2P test
 * needs. The balance is set directly rather than through the ledger — the grant path has its
 * own coverage, and a test that wants ledger-consistent credits should post its own entries.
 */
export async function makeCreditedMembership(creditsCents = 100_000n, seasonId?: string) {
  const user = await makeUser();
  const season = seasonId
    ? { id: seasonId }
    : await makeSeason({ status: 'ACTIVE', startingCreditsCents: creditsCents });
  const [membership] = await db
    .insert(seasonMemberships)
    .values({
      userId: user.id,
      seasonId: season.id,
      balanceCents: 1_000_000n,
      creditsBalanceCents: creditsCents,
    })
    .returning();
  return { membership, user, seasonId: season.id };
}

export async function makeWager(opts: {
  seasonId: string;
  offererMembershipId: string;
  acceptorMembershipId?: string;
  opponentMembershipId?: string;
  kind?: P2PWagerKind;
  status?: P2PWagerStatus;
  offererStakeCents?: bigint;
  acceptorStakeCents?: bigint;
  selectionId?: string;
  lineAtOffer?: string | null;
  description?: string;
  expiresAt?: Date;
  resolvesBy?: Date;
}) {
  const kind = opts.kind ?? 'FREEFORM';
  const [wager] = await db
    .insert(p2pWagers)
    .values({
      seasonId: opts.seasonId,
      kind,
      status: opts.status ?? 'OFFERED',
      offererMembershipId: opts.offererMembershipId,
      acceptorMembershipId: opts.acceptorMembershipId,
      opponentMembershipId: opts.opponentMembershipId,
      offererStakeCents: opts.offererStakeCents ?? 10_000n,
      acceptorStakeCents: opts.acceptorStakeCents ?? 10_000n,
      selectionId: kind === 'MARKET' ? opts.selectionId : undefined,
      lineAtOffer: kind === 'MARKET' ? (opts.lineAtOffer ?? null) : null,
      description: kind === 'FREEFORM' ? (opts.description ?? 'a test wager') : undefined,
      expiresAt: opts.expiresAt ?? new Date(Date.now() + 86_400_000),
      resolvesBy: opts.resolvesBy ?? new Date(Date.now() + 7 * 86_400_000),
    })
    .returning();
  return wager;
}
```

- [ ] **Step 7: Generate and apply the migration**

```bash
npm run db:generate
npm run db:migrate:test
```

Expected: one new migration file under `drizzle/`, and `migrations applied`.

Open the generated SQL and confirm it contains `CREATE TABLE "p2p_wagers"`, the three `CREATE TYPE` statements, and both `CONSTRAINT "p2p_wagers_kind_shape"` and `CONSTRAINT "p2p_wagers_positive_stakes"`. If the CHECK constraints are missing, drizzle-kit did not pick them up — fix the schema file rather than hand-editing the SQL.

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run src/db/__tests__/p2p-schema.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 9: Verify and commit**

```bash
npm run verify
git add -A
git commit -m "feat: add the p2p_wagers table"
```

Expected from `npm run verify`: 60 test files, 416 tests, 0 lint errors.

---

### Task 2: Ledger vocabulary for escrow

**Files:**

- Modify: `src/db/schema/money.ts`
- Test: `src/server/money/__tests__/p2p-entries.test.ts`

**Interfaces:**

- Consumes: `p2pWagers` (Task 1), `postEntry` (existing, unmodified).
- Produces: `ledger_entry_type` values `P2P_ESCROW`, `P2P_WON`, `P2P_REFUND`; `ledgerEntries.p2pWagerId`; `PostEntryInput.p2pWagerId`.

The only change to `postEntry` is passing one more optional column through to the insert. Its locking, its balance check, and its idempotency behaviour are untouched.

- [ ] **Step 1: Write the failing test**

Create `src/server/money/__tests__/p2p-entries.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { ledgerEntries, seasonMemberships } from '@/db/schema';
import { postEntry } from '@/server/money/ledger';
import { resetDb } from '@/test/db';
import { makeCreditedMembership, makeWager } from '@/test/factories';

async function credits(membershipId: string) {
  const [row] = await db
    .select({ credits: seasonMemberships.creditsBalanceCents })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, membershipId));
  return row.credits;
}

describe('p2p ledger entries', () => {
  beforeEach(resetDb);

  it('escrows credits and attributes the entry to the wager', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const wager = await makeWager({
      seasonId: offerer.seasonId,
      offererMembershipId: offerer.membership.id,
    });

    const posted = await db.transaction((tx) =>
      postEntry(tx, {
        membershipId: offerer.membership.id,
        amountCents: -10_000n,
        type: 'P2P_ESCROW',
        currency: 'CREDITS',
        idempotencyKey: `p2p:${wager.id}:escrow:offerer`,
        p2pWagerId: wager.id,
      }),
    );

    expect(posted.applied).toBe(true);
    expect(posted.balanceCents).toBe(90_000n);
    expect(await credits(offerer.membership.id)).toBe(90_000n);

    const [entry] = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.p2pWagerId, wager.id));
    expect(entry.type).toBe('P2P_ESCROW');
    expect(entry.currency).toBe('CREDITS');
    expect(entry.betId).toBeNull();
  });

  it('pays the pot with P2P_WON and refunds with P2P_REFUND', async () => {
    const winner = await makeCreditedMembership(100_000n);
    const wager = await makeWager({
      seasonId: winner.seasonId,
      offererMembershipId: winner.membership.id,
    });

    await db.transaction((tx) =>
      postEntry(tx, {
        membershipId: winner.membership.id,
        amountCents: 30_000n,
        type: 'P2P_WON',
        currency: 'CREDITS',
        idempotencyKey: `p2p:${wager.id}:settled:1:won`,
        p2pWagerId: wager.id,
      }),
    );

    await db.transaction((tx) =>
      postEntry(tx, {
        membershipId: winner.membership.id,
        amountCents: 5_000n,
        type: 'P2P_REFUND',
        currency: 'CREDITS',
        idempotencyKey: `p2p:${wager.id}:settled:1:refund:${winner.membership.id}`,
        p2pWagerId: wager.id,
      }),
    );

    expect(await credits(winner.membership.id)).toBe(135_000n);

    const types = await db
      .select({ type: ledgerEntries.type })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.p2pWagerId, wager.id));
    expect(types.map((t) => t.type).sort()).toEqual(['P2P_REFUND', 'P2P_WON']);
  });

  it('is idempotent: replaying an escrow key moves nothing', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const wager = await makeWager({
      seasonId: offerer.seasonId,
      offererMembershipId: offerer.membership.id,
    });

    const key = `p2p:${wager.id}:escrow:offerer`;
    const input = {
      membershipId: offerer.membership.id,
      amountCents: -10_000n,
      type: 'P2P_ESCROW' as const,
      currency: 'CREDITS' as const,
      idempotencyKey: key,
      p2pWagerId: wager.id,
    };

    await db.transaction((tx) => postEntry(tx, input));
    const second = await db.transaction((tx) => postEntry(tx, input));

    expect(second.applied).toBe(false);
    expect(await credits(offerer.membership.id)).toBe(90_000n);

    const rows = await db
      .select()
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.p2pWagerId, wager.id), eq(ledgerEntries.idempotencyKey, key)));
    expect(rows).toHaveLength(1);
  });

  it('refuses an escrow larger than the credits balance', async () => {
    const offerer = await makeCreditedMembership(5_000n);
    const wager = await makeWager({
      seasonId: offerer.seasonId,
      offererMembershipId: offerer.membership.id,
    });

    await expect(
      db.transaction((tx) =>
        postEntry(tx, {
          membershipId: offerer.membership.id,
          amountCents: -10_000n,
          type: 'P2P_ESCROW',
          currency: 'CREDITS',
          idempotencyKey: `p2p:${wager.id}:escrow:offerer`,
          p2pWagerId: wager.id,
        }),
      ),
    ).rejects.toThrow(/INSUFFICIENT_FUNDS|cannot absorb/);

    expect(await credits(offerer.membership.id)).toBe(5_000n);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/money/__tests__/p2p-entries.test.ts`
Expected: FAIL — `'P2P_ESCROW'` is not assignable to `LedgerEntryType`, and `p2pWagerId` is not a property of `PostEntryInput`.

- [ ] **Step 3: Extend the ledger schema**

In `src/db/schema/money.ts`, add the three entry types to the enum and the wager foreign key to the table. The enum becomes:

```ts
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
  'P2P_ESCROW',
  'P2P_WON',
  'P2P_REFUND',
]);
```

Add the import and the column. At the top of the file:

```ts
import { p2pWagers } from './p2p';
```

and inside the `ledgerEntries` column list, directly after `betId`:

```ts
    /**
     * The wager this movement belongs to, for escrow, payout and refund entries. Sits
     * beside `betId` rather than replacing it: a wager is not a bet (D42), and an entry
     * carries at most one of the two.
     */
    p2pWagerId: uuid('p2p_wager_id').references(() => p2pWagers.id),
```

**Import cycle check:** `money.ts` now imports `p2p.ts`, and `p2p.ts` imports `identity.ts` and `sports.ts` — neither of which imports `money.ts`. There is no cycle. Do **not** make `p2p.ts` import from `money.ts`.

- [ ] **Step 4: Pass the column through `postEntry`**

In `src/server/money/ledger.ts`, add one field to `PostEntryInput`, directly after `betId`:

```ts
  /** The wager this movement belongs to, for P2P escrow, payout and refund entries. */
  p2pWagerId?: string;
```

and one line to the `.values({ ... })` object in the insert, directly after `betId: input.betId,`:

```ts
      p2pWagerId: input.p2pWagerId,
```

Nothing else in this file changes. The lock, the balance check, the `onConflictDoNothing` and the cache update all stay exactly as they are.

- [ ] **Step 5: Generate and apply the migration**

```bash
npm run db:generate
npm run db:migrate:test
```

Confirm the generated SQL contains three `ALTER TYPE "public"."ledger_entry_type" ADD VALUE` statements and one `ALTER TABLE "ledger_entries" ADD COLUMN "p2p_wager_id"`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/server/money/__tests__/p2p-entries.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 7: Verify and commit**

```bash
npm run verify
git add -A
git commit -m "feat: add escrow entry types and the wager key to the ledger"
```

---

### Task 3: The pure domain functions

**Files:**

- Create: `src/domain/p2p.ts`
- Test: `src/domain/__tests__/p2p.test.ts`

**Interfaces:**

- Consumes: `P2PVerdict`, `P2PWagerStatus` (Task 1). `SettledLegStatus` from `@/domain/grading` (existing).
- Produces:
  - `verdictForLegStatus(status: 'WON' | 'LOST' | 'PUSHED' | 'VOIDED'): P2PVerdict`
  - `potCents(offererStakeCents: bigint, acceptorStakeCents: bigint): bigint`
  - `agreedVerdict(claims: ClaimState): P2PVerdict | null`
  - `isDisputed(claims: ClaimState): boolean`
  - `isOverdue(w: { resolvesBy: Date } & ClaimState, now: Date): boolean`
  - `computeHeadToHead(rows: HeadToHeadRow[], memberA: string, memberB: string): HeadToHead`
  - Interfaces `ClaimState`, `HeadToHeadRow`, `HeadToHead`

This task touches no database. Every function is a pure function of its arguments, which is what makes the verdict rules exhaustively testable without seeding a season.

- [ ] **Step 1: Write the failing test**

Create `src/domain/__tests__/p2p.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  agreedVerdict,
  computeHeadToHead,
  isDisputed,
  isOverdue,
  potCents,
  verdictForLegStatus,
  type HeadToHeadRow,
} from '@/domain/p2p';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const C = 'cccccccc-0000-4000-8000-000000000003';

describe('verdictForLegStatus', () => {
  it('maps a winning selection to the offerer', () => {
    expect(verdictForLegStatus('WON')).toBe('OFFERER');
  });

  it('maps a losing selection to the acceptor, who held the negation', () => {
    expect(verdictForLegStatus('LOST')).toBe('ACCEPTOR');
  });

  it('voids a push — neither side was right', () => {
    expect(verdictForLegStatus('PUSHED')).toBe('VOID');
  });

  it('voids a voided leg — the event died', () => {
    expect(verdictForLegStatus('VOIDED')).toBe('VOID');
  });
});

describe('potCents', () => {
  it('sums two asymmetric stakes', () => {
    expect(potCents(50_000n, 20_000n)).toBe(70_000n);
  });

  it('sums two equal stakes', () => {
    expect(potCents(10_000n, 10_000n)).toBe(20_000n);
  });
});

describe('agreedVerdict', () => {
  it('returns the verdict when both parties say the same thing', () => {
    expect(agreedVerdict({ offererClaim: 'OFFERER', acceptorClaim: 'OFFERER' })).toBe('OFFERER');
    expect(agreedVerdict({ offererClaim: 'ACCEPTOR', acceptorClaim: 'ACCEPTOR' })).toBe('ACCEPTOR');
  });

  it('treats a mutual VOID claim as an agreement to refund', () => {
    expect(agreedVerdict({ offererClaim: 'VOID', acceptorClaim: 'VOID' })).toBe('VOID');
  });

  it('returns null when they disagree', () => {
    expect(agreedVerdict({ offererClaim: 'OFFERER', acceptorClaim: 'ACCEPTOR' })).toBeNull();
  });

  it('returns null when only one has claimed', () => {
    expect(agreedVerdict({ offererClaim: 'OFFERER', acceptorClaim: null })).toBeNull();
    expect(agreedVerdict({ offererClaim: null, acceptorClaim: 'OFFERER' })).toBeNull();
    expect(agreedVerdict({ offererClaim: null, acceptorClaim: null })).toBeNull();
  });
});

describe('isDisputed', () => {
  it('is true only when both claims are set and differ', () => {
    expect(isDisputed({ offererClaim: 'OFFERER', acceptorClaim: 'ACCEPTOR' })).toBe(true);
    expect(isDisputed({ offererClaim: 'OFFERER', acceptorClaim: 'VOID' })).toBe(true);
  });

  it('is false on agreement, and false while a claim is missing', () => {
    expect(isDisputed({ offererClaim: 'OFFERER', acceptorClaim: 'OFFERER' })).toBe(false);
    expect(isDisputed({ offererClaim: 'OFFERER', acceptorClaim: null })).toBe(false);
    expect(isDisputed({ offererClaim: null, acceptorClaim: null })).toBe(false);
  });
});

describe('isOverdue', () => {
  const past = new Date('2026-08-01T00:00:00Z');
  const future = new Date('2026-12-01T00:00:00Z');
  const now = new Date('2026-09-01T00:00:00Z');

  it('is overdue past the date with no claims', () => {
    expect(isOverdue({ resolvesBy: past, offererClaim: null, acceptorClaim: null }, now)).toBe(
      true,
    );
  });

  it('is overdue past the date with only one claim', () => {
    expect(isOverdue({ resolvesBy: past, offererClaim: 'OFFERER', acceptorClaim: null }, now)).toBe(
      true,
    );
  });

  it('is overdue past the date when the two disagree', () => {
    expect(
      isOverdue({ resolvesBy: past, offererClaim: 'OFFERER', acceptorClaim: 'ACCEPTOR' }, now),
    ).toBe(true);
  });

  it('is not overdue once both agree, however late', () => {
    expect(isOverdue({ resolvesBy: past, offererClaim: 'VOID', acceptorClaim: 'VOID' }, now)).toBe(
      false,
    );
  });

  it('is not overdue before the date', () => {
    expect(isOverdue({ resolvesBy: future, offererClaim: null, acceptorClaim: null }, now)).toBe(
      false,
    );
  });
});

describe('computeHeadToHead', () => {
  function row(over: Partial<HeadToHeadRow> = {}): HeadToHeadRow {
    return {
      offererMembershipId: A,
      acceptorMembershipId: B,
      status: 'SETTLED',
      verdict: 'OFFERER',
      offererStakeCents: 50_000n,
      acceptorStakeCents: 20_000n,
      ...over,
    };
  }

  it('credits the offerer the acceptor stake when the offerer wins', () => {
    const h2h = computeHeadToHead([row()], A, B);
    expect(h2h).toEqual({
      settled: 1,
      aWon: 1,
      bWon: 0,
      voided: 0,
      netCentsForA: 20_000n,
    });
  });

  it('debits the offerer their own stake when the acceptor wins', () => {
    const h2h = computeHeadToHead([row({ verdict: 'ACCEPTOR' })], A, B);
    expect(h2h).toEqual({
      settled: 1,
      aWon: 0,
      bWon: 1,
      voided: 0,
      netCentsForA: -50_000n,
    });
  });

  it('is symmetric — swapping the members negates the net', () => {
    const forA = computeHeadToHead([row()], A, B);
    const forB = computeHeadToHead([row()], B, A);
    expect(forB.netCentsForA).toBe(-forA.netCentsForA);
    expect(forB.aWon).toBe(forA.bWon);
  });

  it('scores a wager where A is the acceptor', () => {
    const h2h = computeHeadToHead(
      [row({ offererMembershipId: B, acceptorMembershipId: A, verdict: 'ACCEPTOR' })],
      A,
      B,
    );
    // A accepted, A won, so A takes B's offerer stake of 50,000.
    expect(h2h).toEqual({ settled: 1, aWon: 1, bWon: 0, voided: 0, netCentsForA: 50_000n });
  });

  it('counts a void without moving the net', () => {
    const h2h = computeHeadToHead([row({ status: 'VOIDED', verdict: 'VOID' })], A, B);
    expect(h2h).toEqual({ settled: 0, aWon: 0, bWon: 0, voided: 1, netCentsForA: 0n });
  });

  it('ignores wagers that never happened', () => {
    const rows = [
      row({ status: 'CANCELED', verdict: null }),
      row({ status: 'EXPIRED', verdict: null }),
      row({ status: 'OFFERED', verdict: null, acceptorMembershipId: null }),
      row({ status: 'ACCEPTED', verdict: null }),
    ];
    expect(computeHeadToHead(rows, A, B)).toEqual({
      settled: 0,
      aWon: 0,
      bWon: 0,
      voided: 0,
      netCentsForA: 0n,
    });
  });

  it('ignores wagers not between exactly these two members', () => {
    const rows = [row({ acceptorMembershipId: C }), row({ offererMembershipId: C })];
    expect(computeHeadToHead(rows, A, B)).toEqual({
      settled: 0,
      aWon: 0,
      bWon: 0,
      voided: 0,
      netCentsForA: 0n,
    });
  });

  it('accumulates a run of wagers in both directions', () => {
    const rows = [
      row({ verdict: 'OFFERER' }), // A +20,000
      row({ verdict: 'ACCEPTOR' }), // A -50,000
      row({ offererMembershipId: B, acceptorMembershipId: A, verdict: 'ACCEPTOR' }), // A +50,000
      row({ status: 'VOIDED', verdict: 'VOID' }), // 0
    ];
    expect(computeHeadToHead(rows, A, B)).toEqual({
      settled: 3,
      aWon: 2,
      bWon: 1,
      voided: 1,
      netCentsForA: 20_000n,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/domain/__tests__/p2p.test.ts`
Expected: FAIL — cannot resolve `@/domain/p2p`.

- [ ] **Step 3: Write the implementation**

Create `src/domain/p2p.ts`:

```ts
import type { P2PVerdict, P2PWagerStatus } from '@/db/schema';

/**
 * Pure rules for peer-to-peer wagers. No I/O, no database, no clock of its own — `now` is
 * always passed in.
 *
 * The type imports above are types only, which is why this stays a leaf: `@/db/schema`
 * contributes no runtime code to this module. `custom-grading.ts` imports `Currency` and
 * `EventKind` the same way.
 */

export interface ClaimState {
  offererClaim: P2PVerdict | null;
  acceptorClaim: P2PVerdict | null;
}

/**
 * The offerer holds the selection; the acceptor holds its negation. So a wager's verdict is
 * a total mapping over the leg status the engine already computes — `gradeLeg` for a game,
 * `gradeCustomLeg` for a custom market. No new grading logic enters the system.
 *
 * PUSHED and VOIDED both refund: in one case nobody was right, in the other the event never
 * happened. Neither is a win for either party.
 */
export function verdictForLegStatus(status: 'WON' | 'LOST' | 'PUSHED' | 'VOIDED'): P2PVerdict {
  if (status === 'WON') return 'OFFERER';
  if (status === 'LOST') return 'ACCEPTOR';
  return 'VOID';
}

/** The winner takes both stakes. Derived, never stored — one fact, one home. */
export function potCents(offererStakeCents: bigint, acceptorStakeCents: bigint): bigint {
  return offererStakeCents + acceptorStakeCents;
}

/**
 * The verdict the two parties have agreed on, or null if they have not.
 *
 * A mutual `VOID` is a real agreement: two members who decide the bet was unresolvable
 * settle it as a refund without ever involving an admin (D47).
 */
export function agreedVerdict(claims: ClaimState): P2PVerdict | null {
  if (claims.offererClaim === null || claims.acceptorClaim === null) return null;
  return claims.offererClaim === claims.acceptorClaim ? claims.offererClaim : null;
}

/**
 * Both parties have spoken and they disagree.
 *
 * Derived rather than stored (D44). A stored flag would survive a party revising their
 * claim, leaving the wager parked in an admin queue it no longer belongs in.
 */
export function isDisputed(claims: ClaimState): boolean {
  return (
    claims.offererClaim !== null &&
    claims.acceptorClaim !== null &&
    claims.offererClaim !== claims.acceptorClaim
  );
}

/**
 * Past the resolve-by date with no agreed verdict — which covers silence from one side and
 * an outright disagreement alike. Both need an admin; the queue does not care which it is.
 */
export function isOverdue(w: { resolvesBy: Date } & ClaimState, now: Date): boolean {
  return w.resolvesBy.getTime() < now.getTime() && agreedVerdict(w) === null;
}

export interface HeadToHeadRow {
  offererMembershipId: string;
  acceptorMembershipId: string | null;
  status: P2PWagerStatus;
  verdict: P2PVerdict | null;
  offererStakeCents: bigint;
  acceptorStakeCents: bigint;
}

export interface HeadToHead {
  /** Wagers that produced a winner. Voids are counted separately, not here. */
  settled: number;
  aWon: number;
  bWon: number;
  voided: number;
  /** Positive means A is up on B, in credits. */
  netCentsForA: bigint;
}

/**
 * The head-to-head record between two members (D48).
 *
 * Only `SETTLED` and `VOIDED` wagers count — a `CANCELED` or `EXPIRED` offer never happened,
 * and an `OFFERED` or `ACCEPTED` one has not happened yet. Derived at read time, with no
 * stored counter to drift out of agreement with the rows, exactly as `computeMemberStats`
 * derives profile statistics.
 */
export function computeHeadToHead(
  rows: HeadToHeadRow[],
  memberA: string,
  memberB: string,
): HeadToHead {
  const result: HeadToHead = { settled: 0, aWon: 0, bWon: 0, voided: 0, netCentsForA: 0n };

  for (const row of rows) {
    if (row.acceptorMembershipId === null) continue;

    const pair =
      (row.offererMembershipId === memberA && row.acceptorMembershipId === memberB) ||
      (row.offererMembershipId === memberB && row.acceptorMembershipId === memberA);
    if (!pair) continue;

    if (row.status === 'VOIDED') {
      result.voided += 1;
      continue;
    }
    if (row.status !== 'SETTLED') continue;
    if (row.verdict === null) continue;
    if (row.verdict === 'VOID') {
      result.voided += 1;
      continue;
    }

    const aIsOfferer = row.offererMembershipId === memberA;
    const aWon = row.verdict === (aIsOfferer ? 'OFFERER' : 'ACCEPTOR');

    result.settled += 1;
    if (aWon) {
      result.aWon += 1;
      // A takes what B put up: B's stake, on whichever side B was.
      result.netCentsForA += aIsOfferer ? row.acceptorStakeCents : row.offererStakeCents;
    } else {
      result.bWon += 1;
      // A loses what A put up.
      result.netCentsForA -= aIsOfferer ? row.offererStakeCents : row.acceptorStakeCents;
    }
  }

  return result;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/domain/__tests__/p2p.test.ts`
Expected: PASS, 25 tests.

- [ ] **Step 5: Verify and commit**

```bash
npm run verify
git add -A
git commit -m "feat: add pure verdict, dispute and head-to-head rules"
```

---

### Task 4: Feed vocabulary for wagers

**Files:**

- Modify: `src/db/schema/social.ts`, `src/server/feed/payload.ts`
- Test: `src/server/feed/__tests__/p2p-payload.test.ts`

**Interfaces:**

- Consumes: `emitFeedEvent` (existing, unmodified).
- Produces: `feed_event_type` values `P2P_OFFERED`, `P2P_ACCEPTED`, `P2P_SETTLED`, `P2P_DISPUTED`, `P2P_VOIDED`; payload interfaces `P2POfferedPayload`, `P2PAcceptedPayload`, `P2PSettledPayload`, `P2PDisputedPayload`, `P2PVoidedPayload`, all added to the `FeedEventPayload` union.

Payload conventions are the existing ones and are not negotiable: money is a decimal string ([D25](../decisions.md#d25--money-inside-a-feed-payload-is-a-decimal-string)), and **display names are not stored in the payload** — they are joined live from `users` at read time so a rename updates every historical card. The one exception this codebase already makes is an admin's name on an action they took, which `AdminAdjustmentPayload` and `CustomEventVoidedPayload` both carry; `P2PVoidedPayload` follows that precedent for the arbitrating admin.

- [ ] **Step 1: Write the failing test**

Create `src/server/feed/__tests__/p2p-payload.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedEvents } from '@/db/schema';
import { emitFeedEvent } from '@/server/feed/emit';
import type {
  P2PAcceptedPayload,
  P2PDisputedPayload,
  P2POfferedPayload,
  P2PSettledPayload,
  P2PVoidedPayload,
} from '@/server/feed/payload';
import { resetDb } from '@/test/db';
import { makeCreditedMembership, makeWager } from '@/test/factories';

describe('p2p feed payloads', () => {
  beforeEach(resetDb);

  it('round-trips an offered card with money as strings', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const wager = await makeWager({
      seasonId: offerer.seasonId,
      offererMembershipId: offerer.membership.id,
    });

    const payload: P2POfferedPayload = {
      wagerId: wager.id,
      kind: 'FREEFORM',
      offererStakeCents: '50000',
      acceptorStakeCents: '20000',
      potCents: '70000',
      description: 'Jake cannot name ten starting quarterbacks',
      subject: null,
      directed: false,
      expiresAt: '2026-09-01T00:00:00.000Z',
    };

    await db.transaction((tx) =>
      emitFeedEvent(tx, {
        seasonId: offerer.seasonId,
        type: 'P2P_OFFERED',
        subjectMembershipId: offerer.membership.id,
        dedupeKey: `p2p:${wager.id}:offered`,
        payload,
        occurredAt: new Date('2026-08-20T00:00:00Z'),
      }),
    );

    const [card] = await db.select().from(feedEvents).where(eq(feedEvents.type, 'P2P_OFFERED'));

    expect(card.dedupeKey).toBe(`p2p:${wager.id}:offered`);
    expect(card.payload).toMatchObject({ potCents: '70000', directed: false });
    expect(typeof (card.payload as P2POfferedPayload).potCents).toBe('string');
  });

  it('is deduped: emitting the same offered key twice writes one row', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const wager = await makeWager({
      seasonId: offerer.seasonId,
      offererMembershipId: offerer.membership.id,
    });

    const payload: P2POfferedPayload = {
      wagerId: wager.id,
      kind: 'FREEFORM',
      offererStakeCents: '10000',
      acceptorStakeCents: '10000',
      potCents: '20000',
      description: 'a test wager',
      subject: null,
      directed: false,
      expiresAt: '2026-09-01T00:00:00.000Z',
    };

    const emit = () =>
      db.transaction((tx) =>
        emitFeedEvent(tx, {
          seasonId: offerer.seasonId,
          type: 'P2P_OFFERED',
          subjectMembershipId: offerer.membership.id,
          dedupeKey: `p2p:${wager.id}:offered`,
          payload,
        }),
      );

    const first = await emit();
    const second = await emit();

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(await db.select().from(feedEvents)).toHaveLength(1);
  });

  it('accepts every one of the five new types', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const acceptor = await makeCreditedMembership(100_000n, offerer.seasonId);
    const wager = await makeWager({
      seasonId: offerer.seasonId,
      offererMembershipId: offerer.membership.id,
      acceptorMembershipId: acceptor.membership.id,
      status: 'ACCEPTED',
    });

    const accepted: P2PAcceptedPayload = {
      wagerId: wager.id,
      kind: 'FREEFORM',
      potCents: '20000',
      offererStakeCents: '10000',
      acceptorStakeCents: '10000',
      subject: 'a test wager',
    };
    const settled: P2PSettledPayload = {
      wagerId: wager.id,
      kind: 'FREEFORM',
      verdict: 'OFFERER',
      potCents: '20000',
      subject: 'a test wager',
      attempt: 1,
      correction: false,
      byArbitration: false,
    };
    const disputed: P2PDisputedPayload = {
      wagerId: wager.id,
      subject: 'a test wager',
      attempt: 1,
    };
    const voided: P2PVoidedPayload = {
      wagerId: wager.id,
      subject: 'a test wager',
      reason: 'MUTUAL_CANCEL',
      refundedCents: '20000',
      attempt: 1,
      note: null,
      adminDisplayName: null,
    };

    await db.transaction(async (tx) => {
      await emitFeedEvent(tx, {
        seasonId: offerer.seasonId,
        type: 'P2P_ACCEPTED',
        subjectMembershipId: acceptor.membership.id,
        dedupeKey: `p2p:${wager.id}:accepted`,
        payload: accepted,
      });
      await emitFeedEvent(tx, {
        seasonId: offerer.seasonId,
        type: 'P2P_SETTLED',
        subjectMembershipId: offerer.membership.id,
        dedupeKey: `p2p:${wager.id}:settled:1`,
        payload: settled,
      });
      await emitFeedEvent(tx, {
        seasonId: offerer.seasonId,
        type: 'P2P_DISPUTED',
        subjectMembershipId: acceptor.membership.id,
        dedupeKey: `p2p:${wager.id}:disputed:1`,
        payload: disputed,
      });
      await emitFeedEvent(tx, {
        seasonId: offerer.seasonId,
        type: 'P2P_VOIDED',
        dedupeKey: `p2p:${wager.id}:voided:1`,
        payload: voided,
      });
    });

    const rows = await db.select().from(feedEvents);
    expect(rows.map((r) => r.type).sort()).toEqual([
      'P2P_ACCEPTED',
      'P2P_DISPUTED',
      'P2P_SETTLED',
      'P2P_VOIDED',
    ]);
    // A void belongs to the wager, not to either member.
    expect(rows.find((r) => r.type === 'P2P_VOIDED')!.subjectMembershipId).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/feed/__tests__/p2p-payload.test.ts`
Expected: FAIL — `'P2P_OFFERED'` is not assignable to `FeedEventType`, and the payload types do not exist.

- [ ] **Step 3: Extend the feed event enum**

In `src/db/schema/social.ts`, append the five values to `feedEventType`. The enum becomes:

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
  'P2P_OFFERED',
  'P2P_ACCEPTED',
  'P2P_SETTLED',
  'P2P_DISPUTED',
  'P2P_VOIDED',
]);
```

**Append, never reorder.** `feed_preferences.muted_types` is an array of this enum stored in the database; reordering the values would silently remap every member's existing mutes.

- [ ] **Step 4: Add the payload types**

Append to `src/server/feed/payload.ts`, before the `FeedEventPayload` union:

```ts
/**
 * A wager's one-line subject: the freeform description, or a rendering of the selection for
 * a market-backed wager ("KC -3.5 vs BUF"). Frozen at write time like every other payload
 * fact, so a later line move cannot rewrite what the card said.
 */
export interface P2POfferedPayload {
  wagerId: string;
  kind: 'MARKET' | 'FREEFORM';
  offererStakeCents: string;
  acceptorStakeCents: string;
  potCents: string;
  /** The freeform text, for a FREEFORM wager. Null for MARKET. */
  description: string | null;
  /** The rendered selection, for a MARKET wager. Null for FREEFORM. */
  subject: string | null;
  /** True when the offer names an opponent rather than being open to the season. */
  directed: boolean;
  expiresAt: string;
}

export interface P2PAcceptedPayload {
  wagerId: string;
  kind: 'MARKET' | 'FREEFORM';
  potCents: string;
  offererStakeCents: string;
  acceptorStakeCents: string;
  /** The description or the rendered selection, whichever this wager has. */
  subject: string;
}

export interface P2PSettledPayload {
  wagerId: string;
  kind: 'MARKET' | 'FREEFORM';
  verdict: 'OFFERER' | 'ACCEPTOR' | 'VOID';
  potCents: string;
  subject: string;
  attempt: number;
  /** True from the second attempt onward — an admin correcting an earlier settlement. */
  correction: boolean;
  /** True when an admin decided it rather than the two parties agreeing. */
  byArbitration: boolean;
}

export interface P2PDisputedPayload {
  wagerId: string;
  subject: string;
  attempt: number;
}

/** Why both stakes came back. Determines the card's wording and nothing else. */
export type P2PVoidReason = 'MUTUAL_CANCEL' | 'EVENT_DEAD' | 'ARBITRATED' | 'AGREED_VOID';

export interface P2PVoidedPayload {
  wagerId: string;
  subject: string;
  reason: P2PVoidReason;
  refundedCents: string;
  attempt: number;
  /** The arbitration note, when an admin decided it. Null otherwise. */
  note: string | null;
  /** Set only for ARBITRATED, matching how CustomEventVoidedPayload names the admin. */
  adminDisplayName: string | null;
}
```

Then add the five to the union at the bottom of the file. Find the existing `FeedEventPayload` union and extend it — it must end up including every one of these five names alongside the thirteen already there.

- [ ] **Step 5: Generate and apply the migration**

```bash
npm run db:generate
npm run db:migrate:test
```

Confirm the generated SQL contains five `ALTER TYPE "public"."feed_event_type" ADD VALUE` statements and nothing else.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/server/feed/__tests__/p2p-payload.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 7: Verify and commit**

```bash
npm run verify
git add -A
git commit -m "feat: add peer-to-peer feed card types and payloads"
```

---

### Task 5: Offering a wager

**Files:**

- Create: `src/server/p2p/types.ts`, `src/server/p2p/subject.ts`, `src/server/p2p/offer.ts`
- Test: `src/server/p2p/__tests__/offer.test.ts`

**Interfaces:**

- Consumes: `p2pWagers` (Task 1), `postEntry` with `p2pWagerId` (Task 2), `potCents` (Task 3), `P2POfferedPayload` (Task 4).
- Produces:
  - `offerWager(input: OfferWagerInput): Promise<OfferWagerResult>`
  - `OfferWagerInput = { actorUserId: string; kind: P2PWagerKind; opponentMembershipId?: string | null; offererStakeCents: bigint; acceptorStakeCents: bigint; selectionId?: string; description?: string; expiresAt: Date; resolvesBy: Date; now?: Date }`
  - `OfferWagerResult = { ok: true; wagerId: string; creditsBalanceCents: bigint } | { ok: false; error: OfferWagerError }`
  - `OfferWagerError` codes: `NOT_A_MEMBER`, `INVALID_STAKE`, `INSUFFICIENT_CREDITS`, `OPPONENT_IS_SELF`, `OPPONENT_NOT_IN_SEASON`, `INVALID_WINDOW`, `WRONG_KIND_FIELDS`, `SELECTION_NOT_FOUND`, `MARKET_NOT_OPEN`, `EVENT_ALREADY_STARTED`
  - `renderSubject(...)` in `subject.ts` — the one place a wager's one-line description is built

- [ ] **Step 1: Write the failing test**

Create `src/server/p2p/__tests__/offer.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedEvents, ledgerEntries, p2pWagers, seasonMemberships } from '@/db/schema';
import { offerWager } from '@/server/p2p/offer';
import { resetDb } from '@/test/db';
import { makeCreditedMembership } from '@/test/factories';
import { seedBettableGame } from '@/server/bets/__tests__/helpers';

const SOON = () => new Date(Date.now() + 3_600_000);
const LATER = () => new Date(Date.now() + 7 * 86_400_000);

async function credits(membershipId: string) {
  const [row] = await db
    .select({ credits: seasonMemberships.creditsBalanceCents })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, membershipId));
  return row.credits;
}

function freeform(actorUserId: string, over: Record<string, unknown> = {}) {
  return {
    actorUserId,
    kind: 'FREEFORM' as const,
    offererStakeCents: 50_000n,
    acceptorStakeCents: 20_000n,
    description: 'Jake cannot name ten starting quarterbacks',
    expiresAt: SOON(),
    resolvesBy: LATER(),
    ...over,
  };
}

describe('offerWager', () => {
  beforeEach(resetDb);

  it('escrows the offerer stake at offer and opens the wager', async () => {
    const offerer = await makeCreditedMembership(100_000n);

    const result = await offerWager(freeform(offerer.user.id));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.creditsBalanceCents).toBe(50_000n);
    expect(await credits(offerer.membership.id)).toBe(50_000n);

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, result.wagerId));
    expect(wager.status).toBe('OFFERED');
    expect(wager.kind).toBe('FREEFORM');
    expect(wager.offererMembershipId).toBe(offerer.membership.id);
    expect(wager.acceptorMembershipId).toBeNull();
    expect(wager.opponentMembershipId).toBeNull();

    const [entry] = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.p2pWagerId, result.wagerId));
    expect(entry.type).toBe('P2P_ESCROW');
    expect(entry.currency).toBe('CREDITS');
    expect(entry.amountCents).toBe(-50_000n);
    expect(entry.idempotencyKey).toBe(`p2p:${result.wagerId}:escrow:offerer`);
  });

  it('posts one P2P_OFFERED card carrying the pot', async () => {
    const offerer = await makeCreditedMembership(100_000n);

    const result = await offerWager(freeform(offerer.user.id));
    if (!result.ok) throw new Error('expected the offer to succeed');

    const [card] = await db.select().from(feedEvents).where(eq(feedEvents.type, 'P2P_OFFERED'));
    expect(card.dedupeKey).toBe(`p2p:${result.wagerId}:offered`);
    expect(card.subjectMembershipId).toBe(offerer.membership.id);
    expect(card.payload).toMatchObject({
      wagerId: result.wagerId,
      kind: 'FREEFORM',
      offererStakeCents: '50000',
      acceptorStakeCents: '20000',
      potCents: '70000',
      directed: false,
    });
  });

  it('records a directed challenge against the named opponent', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const opponent = await makeCreditedMembership(100_000n, offerer.seasonId);

    const result = await offerWager(
      freeform(offerer.user.id, { opponentMembershipId: opponent.membership.id }),
    );
    if (!result.ok) throw new Error('expected the offer to succeed');

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, result.wagerId));
    expect(wager.opponentMembershipId).toBe(opponent.membership.id);

    const [card] = await db.select().from(feedEvents).where(eq(feedEvents.type, 'P2P_OFFERED'));
    expect(card.payload).toMatchObject({ directed: true });
  });

  it('freezes the line on a market-backed wager', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const game = await seedBettableGame();

    const result = await offerWager({
      actorUserId: offerer.user.id,
      kind: 'MARKET',
      selectionId: game.spread.home,
      offererStakeCents: 10_000n,
      acceptorStakeCents: 10_000n,
      expiresAt: SOON(),
      resolvesBy: LATER(),
    });
    if (!result.ok) throw new Error('expected the offer to succeed');

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, result.wagerId));
    expect(wager.kind).toBe('MARKET');
    expect(wager.selectionId).toBe(game.spread.home);
    expect(wager.lineAtOffer).toBe('-3.50');
    expect(wager.description).toBeNull();
  });

  it('refuses a stake the offerer cannot cover', async () => {
    const offerer = await makeCreditedMembership(10_000n);

    const result = await offerWager(freeform(offerer.user.id));

    expect(result).toEqual({
      ok: false,
      error: { code: 'INSUFFICIENT_CREDITS', availableCents: 10_000n },
    });
    expect(await db.select().from(p2pWagers)).toHaveLength(0);
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });

  it('refuses a non-positive stake on either side', async () => {
    const offerer = await makeCreditedMembership(100_000n);

    expect(await offerWager(freeform(offerer.user.id, { offererStakeCents: 0n }))).toEqual({
      ok: false,
      error: { code: 'INVALID_STAKE', side: 'OFFERER' },
    });
    expect(await offerWager(freeform(offerer.user.id, { acceptorStakeCents: -1n }))).toEqual({
      ok: false,
      error: { code: 'INVALID_STAKE', side: 'ACCEPTOR' },
    });
    expect(await db.select().from(p2pWagers)).toHaveLength(0);
  });

  it('refuses to challenge yourself', async () => {
    const offerer = await makeCreditedMembership(100_000n);

    const result = await offerWager(
      freeform(offerer.user.id, { opponentMembershipId: offerer.membership.id }),
    );

    expect(result).toEqual({ ok: false, error: { code: 'OPPONENT_IS_SELF' } });
  });

  it('refuses an opponent from another season', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const stranger = await makeCreditedMembership(100_000n);

    const result = await offerWager(
      freeform(offerer.user.id, { opponentMembershipId: stranger.membership.id }),
    );

    expect(result).toEqual({ ok: false, error: { code: 'OPPONENT_NOT_IN_SEASON' } });
  });

  it('refuses a resolve-by that lands before the offer expires', async () => {
    const offerer = await makeCreditedMembership(100_000n);

    const result = await offerWager(
      freeform(offerer.user.id, {
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
        resolvesBy: new Date(Date.now() + 3_600_000),
      }),
    );

    expect(result).toEqual({ ok: false, error: { code: 'INVALID_WINDOW' } });
  });

  it('refuses an expiry already in the past', async () => {
    const offerer = await makeCreditedMembership(100_000n);

    const result = await offerWager(
      freeform(offerer.user.id, { expiresAt: new Date(Date.now() - 1_000) }),
    );

    expect(result).toEqual({ ok: false, error: { code: 'INVALID_WINDOW' } });
  });

  it('refuses a FREEFORM wager with a blank description', async () => {
    const offerer = await makeCreditedMembership(100_000n);

    const result = await offerWager(freeform(offerer.user.id, { description: '   ' }));

    expect(result).toEqual({ ok: false, error: { code: 'WRONG_KIND_FIELDS' } });
  });

  it('refuses a MARKET wager whose game has already started', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const game = await seedBettableGame({ startsAt: new Date(Date.now() - 3_600_000) });

    const result = await offerWager({
      actorUserId: offerer.user.id,
      kind: 'MARKET',
      selectionId: game.moneyline.home,
      offererStakeCents: 10_000n,
      acceptorStakeCents: 10_000n,
      expiresAt: SOON(),
      resolvesBy: LATER(),
    });

    expect(result).toEqual({ ok: false, error: { code: 'EVENT_ALREADY_STARTED' } });
  });

  it('refuses a MARKET wager on a suspended market', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const game = await seedBettableGame();
    const { markets, selections } = await import('@/db/schema');
    const [sel] = await db
      .select({ marketId: selections.marketId })
      .from(selections)
      .where(eq(selections.id, game.moneyline.home));
    await db.update(markets).set({ status: 'SUSPENDED' }).where(eq(markets.id, sel.marketId));

    const result = await offerWager({
      actorUserId: offerer.user.id,
      kind: 'MARKET',
      selectionId: game.moneyline.home,
      offererStakeCents: 10_000n,
      acceptorStakeCents: 10_000n,
      expiresAt: SOON(),
      resolvesBy: LATER(),
    });

    expect(result).toEqual({ ok: false, error: { code: 'MARKET_NOT_OPEN' } });
  });

  it('refuses an offer from someone with no membership in an active season', async () => {
    const { makeUser } = await import('@/test/factories');
    const stranger = await makeUser();

    const result = await offerWager(freeform(stranger.id));

    expect(result).toEqual({ ok: false, error: { code: 'NOT_A_MEMBER' } });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/p2p/__tests__/offer.test.ts`
Expected: FAIL — cannot resolve `@/server/p2p/offer`.

- [ ] **Step 3: Write the shared types**

Create `src/server/p2p/types.ts`:

```ts
import type { P2PVerdict, P2PWagerKind, P2PWagerStatus } from '@/db/schema';

export type { P2PVerdict, P2PWagerKind, P2PWagerStatus };

export interface OfferWagerInput {
  actorUserId: string;
  kind: P2PWagerKind;
  /** Null or omitted means the offer is open to the season. */
  opponentMembershipId?: string | null;
  offererStakeCents: bigint;
  acceptorStakeCents: bigint;
  /** MARKET only. */
  selectionId?: string;
  /** FREEFORM only. */
  description?: string;
  expiresAt: Date;
  resolvesBy: Date;
  now?: Date;
}

export type OfferWagerError =
  | { code: 'NOT_A_MEMBER' }
  | { code: 'INVALID_STAKE'; side: 'OFFERER' | 'ACCEPTOR' }
  | { code: 'INSUFFICIENT_CREDITS'; availableCents: bigint }
  | { code: 'OPPONENT_IS_SELF' }
  | { code: 'OPPONENT_NOT_IN_SEASON' }
  | { code: 'INVALID_WINDOW' }
  | { code: 'WRONG_KIND_FIELDS' }
  | { code: 'SELECTION_NOT_FOUND' }
  | { code: 'MARKET_NOT_OPEN' }
  | { code: 'EVENT_ALREADY_STARTED' };

export type OfferWagerResult =
  | { ok: true; wagerId: string; creditsBalanceCents: bigint }
  | { ok: false; error: OfferWagerError };

export interface CancelOfferInput {
  wagerId: string;
  actorUserId: string;
  now?: Date;
}

export type CancelOfferError =
  | { code: 'WAGER_NOT_FOUND' }
  | { code: 'WAGER_NOT_OPEN'; status: P2PWagerStatus }
  | { code: 'NOT_AUTHORIZED' };

export type CancelOfferResult =
  { ok: true; refundedCents: bigint } | { ok: false; error: CancelOfferError };

export interface AcceptWagerInput {
  wagerId: string;
  actorUserId: string;
  now?: Date;
}

export type AcceptWagerError =
  | { code: 'WAGER_NOT_FOUND' }
  | { code: 'WAGER_NOT_OPEN'; status: P2PWagerStatus }
  | { code: 'OFFER_EXPIRED' }
  | { code: 'NOT_A_MEMBER' }
  | { code: 'NOT_THE_INVITED_OPPONENT' }
  | { code: 'CANNOT_ACCEPT_OWN_OFFER' }
  | { code: 'INSUFFICIENT_CREDITS'; availableCents: bigint };

export type AcceptWagerResult =
  | { ok: true; wagerId: string; creditsBalanceCents: bigint }
  | { ok: false; error: AcceptWagerError };

export interface ClaimWinnerInput {
  wagerId: string;
  actorUserId: string;
  verdict: P2PVerdict;
  now?: Date;
}

export type ClaimError =
  | { code: 'WAGER_NOT_FOUND' }
  | { code: 'WAGER_NOT_ACCEPTED'; status: P2PWagerStatus }
  | { code: 'NOT_A_PARTY' };

export type ClaimWinnerResult =
  | {
      ok: true;
      /** AWAITING_OTHER: recorded, nothing else happened yet. */
      outcome: 'AWAITING_OTHER' | 'SETTLED' | 'DISPUTED';
      verdict: P2PVerdict | null;
      paidCents: bigint;
    }
  | { ok: false; error: ClaimError };

export interface ProposeCancelInput {
  wagerId: string;
  actorUserId: string;
  now?: Date;
}

export type ProposeCancelResult =
  | { ok: true; outcome: 'AWAITING_OTHER' | 'VOIDED'; refundedCents: bigint }
  | { ok: false; error: ClaimError };

export interface ArbitrateWagerInput {
  wagerId: string;
  actorUserId: string;
  verdict: P2PVerdict;
  /** Mandatory. An arbitration moves money, so it says who and why (D15). */
  note: string;
  now?: Date;
}

export type ArbitrateError =
  | { code: 'WAGER_NOT_FOUND' }
  | { code: 'NOTE_REQUIRED' }
  | { code: 'NOT_ARBITRABLE'; status: P2PWagerStatus };

export type ArbitrateWagerResult =
  { ok: true; attempt: number; paidCents: bigint } | { ok: false; error: ArbitrateError };
```

- [ ] **Step 4: Write the subject renderer**

A wager's one-line subject appears in four feed payloads and on three screens. Building it in one place keeps those seven renderings identical.

Create `src/server/p2p/subject.ts`:

```ts
import { eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Tx } from '@/db/client';
import { db } from '@/db/client';
import { events, games, markets, selections, teams } from '@/db/schema';

const homeTeams = alias(teams, 'p2p_home_teams');
const awayTeams = alias(teams, 'p2p_away_teams');

export interface SelectionSubject {
  marketId: string;
  marketStatus: string;
  marketType: string;
  eventId: string;
  eventKind: 'GAME' | 'CUSTOM';
  eventStartsAt: Date;
  line: string | null;
  /** The rendered one-liner: "KC -3.50 vs BUF", or "Test Cup — Who wins? Falcons". */
  subject: string;
}

/**
 * Loads a selection and renders the one line that describes it.
 *
 * Joins through `events` rather than `games`, so a custom-event selection is not silently
 * dropped by an inner join that has no matching `games` row — the same kind-aware shape
 * `place.ts` uses in `loadSelections`.
 */
export async function loadSelectionSubject(
  selectionId: string,
  reader: Tx | typeof db = db,
): Promise<SelectionSubject | null> {
  const [row] = await reader
    .select({
      marketId: markets.id,
      marketStatus: markets.status,
      marketType: markets.type,
      marketTitle: markets.title,
      eventId: events.id,
      eventKind: events.kind,
      eventTitle: events.title,
      eventStartsAt: events.startsAt,
      side: selections.side,
      label: selections.label,
      line: selections.line,
      homeAbbr: homeTeams.abbreviation,
      awayAbbr: awayTeams.abbreviation,
    })
    .from(selections)
    .innerJoin(markets, eq(selections.marketId, markets.id))
    .innerJoin(events, eq(markets.eventId, events.id))
    .leftJoin(games, eq(games.eventId, events.id))
    .leftJoin(homeTeams, eq(games.homeTeamId, homeTeams.id))
    .leftJoin(awayTeams, eq(games.awayTeamId, awayTeams.id))
    .where(eq(selections.id, selectionId));

  if (!row) return null;

  return {
    marketId: row.marketId,
    marketStatus: row.marketStatus,
    marketType: row.marketType,
    eventId: row.eventId,
    eventKind: row.eventKind,
    eventStartsAt: row.eventStartsAt,
    line: row.line,
    subject: renderSubject(row),
  };
}

export function renderSubject(row: {
  eventKind: 'GAME' | 'CUSTOM';
  eventTitle: string;
  marketTitle: string | null;
  marketType: string;
  side: string | null;
  label: string | null;
  line: string | null;
  homeAbbr: string | null;
  awayAbbr: string | null;
}): string {
  if (row.eventKind === 'CUSTOM') {
    return `${row.eventTitle} — ${row.marketTitle ?? ''}: ${row.label ?? ''}`.trim();
  }

  const matchup = `${row.awayAbbr ?? '?'} @ ${row.homeAbbr ?? '?'}`;

  if (row.marketType === 'MONEYLINE') {
    const team = row.side === 'HOME' ? row.homeAbbr : row.awayAbbr;
    return `${team ?? '?'} ML — ${matchup}`;
  }
  if (row.marketType === 'SPREAD') {
    const team = row.side === 'HOME' ? row.homeAbbr : row.awayAbbr;
    return `${team ?? '?'} ${row.line ?? ''} — ${matchup}`;
  }
  // TOTAL
  return `${row.side === 'OVER' ? 'Over' : 'Under'} ${row.line ?? ''} — ${matchup}`;
}
```

- [ ] **Step 5: Write the offer service**

Create `src/server/p2p/offer.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { p2pWagers, seasonMemberships, seasons } from '@/db/schema';
import { potCents } from '@/domain/p2p';
import { emitFeedEvent } from '@/server/feed/emit';
import type { P2POfferedPayload } from '@/server/feed/payload';
import { postEntry } from '@/server/money/ledger';
import { loadSelectionSubject } from './subject';
import type { OfferWagerError, OfferWagerInput, OfferWagerResult } from './types';

/** Thrown to unwind the transaction; carries the validation error back out. */
class OfferRejected extends Error {
  constructor(readonly error: OfferWagerError) {
    super(error.code);
    this.name = 'OfferRejected';
  }
}

/**
 * Opens a wager and escrows the offerer's stake in the same transaction (D46).
 *
 * Escrowing here rather than at acceptance is what makes a live offer always good: an
 * acceptance can never fail because the offerer has since spent down. It also means the
 * refund path is exercised by cancellation and expiry, not just by settlement.
 */
export async function offerWager(input: OfferWagerInput): Promise<OfferWagerResult> {
  const now = input.now ?? new Date();

  // Cheap shape checks first, before paying for a transaction that cannot commit.
  if (input.offererStakeCents <= 0n) {
    return { ok: false, error: { code: 'INVALID_STAKE', side: 'OFFERER' } };
  }
  if (input.acceptorStakeCents <= 0n) {
    return { ok: false, error: { code: 'INVALID_STAKE', side: 'ACCEPTOR' } };
  }
  if (
    input.expiresAt.getTime() <= now.getTime() ||
    input.resolvesBy.getTime() < input.expiresAt.getTime()
  ) {
    return { ok: false, error: { code: 'INVALID_WINDOW' } };
  }

  const description = input.description?.trim() ?? '';
  if (input.kind === 'FREEFORM' && (description.length === 0 || input.selectionId)) {
    return { ok: false, error: { code: 'WRONG_KIND_FIELDS' } };
  }
  if (input.kind === 'MARKET' && (!input.selectionId || description.length > 0)) {
    return { ok: false, error: { code: 'WRONG_KIND_FIELDS' } };
  }

  try {
    return await db.transaction(async (tx) => {
      const [activeSeason] = await tx
        .select({ id: seasons.id })
        .from(seasons)
        .where(eq(seasons.status, 'ACTIVE'));
      if (!activeSeason) throw new OfferRejected({ code: 'NOT_A_MEMBER' });

      // The lock is taken before the balance is read, so a concurrent offer blocks here and
      // then re-reads the committed balance rather than the one it started with.
      const [membership] = await tx
        .select({
          id: seasonMemberships.id,
          creditsBalanceCents: seasonMemberships.creditsBalanceCents,
        })
        .from(seasonMemberships)
        .where(
          and(
            eq(seasonMemberships.userId, input.actorUserId),
            eq(seasonMemberships.seasonId, activeSeason.id),
          ),
        )
        .for('update');
      if (!membership) throw new OfferRejected({ code: 'NOT_A_MEMBER' });

      if (membership.creditsBalanceCents < input.offererStakeCents) {
        throw new OfferRejected({
          code: 'INSUFFICIENT_CREDITS',
          availableCents: membership.creditsBalanceCents,
        });
      }

      const opponentId = input.opponentMembershipId ?? null;
      if (opponentId !== null) {
        if (opponentId === membership.id) throw new OfferRejected({ code: 'OPPONENT_IS_SELF' });
        const [opponent] = await tx
          .select({ id: seasonMemberships.id })
          .from(seasonMemberships)
          .where(
            and(
              eq(seasonMemberships.id, opponentId),
              eq(seasonMemberships.seasonId, activeSeason.id),
            ),
          );
        if (!opponent) throw new OfferRejected({ code: 'OPPONENT_NOT_IN_SEASON' });
      }

      let lineAtOffer: string | null = null;
      let subject: string | null = null;

      if (input.kind === 'MARKET') {
        const loaded = await loadSelectionSubject(input.selectionId!, tx);
        if (!loaded) throw new OfferRejected({ code: 'SELECTION_NOT_FOUND' });
        if (loaded.marketStatus !== 'OPEN') throw new OfferRejected({ code: 'MARKET_NOT_OPEN' });
        if (loaded.eventStartsAt.getTime() <= now.getTime()) {
          throw new OfferRejected({ code: 'EVENT_ALREADY_STARTED' });
        }
        // The offer window must close before the event does, or an acceptance could land
        // after the result is known.
        if (input.expiresAt.getTime() > loaded.eventStartsAt.getTime()) {
          throw new OfferRejected({ code: 'INVALID_WINDOW' });
        }
        lineAtOffer = loaded.line;
        subject = loaded.subject;
      }

      const [wager] = await tx
        .insert(p2pWagers)
        .values({
          seasonId: activeSeason.id,
          kind: input.kind,
          offererMembershipId: membership.id,
          opponentMembershipId: opponentId,
          offererStakeCents: input.offererStakeCents,
          acceptorStakeCents: input.acceptorStakeCents,
          selectionId: input.kind === 'MARKET' ? input.selectionId : undefined,
          lineAtOffer,
          description: input.kind === 'FREEFORM' ? description : undefined,
          expiresAt: input.expiresAt,
          resolvesBy: input.resolvesBy,
        })
        .returning({ id: p2pWagers.id });

      const posted = await postEntry(tx, {
        membershipId: membership.id,
        amountCents: -input.offererStakeCents,
        type: 'P2P_ESCROW',
        currency: 'CREDITS',
        idempotencyKey: `p2p:${wager.id}:escrow:offerer`,
        p2pWagerId: wager.id,
      });

      const payload: P2POfferedPayload = {
        wagerId: wager.id,
        kind: input.kind,
        offererStakeCents: input.offererStakeCents.toString(),
        acceptorStakeCents: input.acceptorStakeCents.toString(),
        potCents: potCents(input.offererStakeCents, input.acceptorStakeCents).toString(),
        description: input.kind === 'FREEFORM' ? description : null,
        subject,
        directed: opponentId !== null,
        expiresAt: input.expiresAt.toISOString(),
      };

      await emitFeedEvent(tx, {
        seasonId: activeSeason.id,
        type: 'P2P_OFFERED',
        subjectMembershipId: membership.id,
        dedupeKey: `p2p:${wager.id}:offered`,
        payload,
        occurredAt: now,
      });

      return { ok: true as const, wagerId: wager.id, creditsBalanceCents: posted.balanceCents };
    });
  } catch (err) {
    if (err instanceof OfferRejected) return { ok: false, error: err.error };
    throw err;
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/server/p2p/__tests__/offer.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 7: Verify and commit**

```bash
npm run verify
git add -A
git commit -m "feat: offer a wager and escrow the offerer stake"
```

---

### Task 6: Withdrawing an offer

**Files:**

- Modify: `src/server/p2p/offer.ts`
- Test: `src/server/p2p/__tests__/cancel-offer.test.ts`

**Interfaces:**

- Consumes: `offerWager` (Task 5), `postEntry` (Task 2).
- Produces:
  - `cancelOffer(input: CancelOfferInput): Promise<CancelOfferResult>` — the offerer withdraws
  - `declineWager(input: CancelOfferInput): Promise<CancelOfferResult>` — the named opponent refuses

Both end the offer and refund the escrow; they differ only in who is allowed to call them. `declineWager` applies only to a directed offer — there is nobody with standing to decline an open one, and ignoring it is what expiry is for.

**No feed card is posted by either.** A withdrawn or refused offer is a non-event, and twelve members abandoning offers would bury the feed — the same instinct D26 applied to the weekly allowance. Both remain visible on the wager and in the offerer's ledger.

- [ ] **Step 1: Write the failing test**

Create `src/server/p2p/__tests__/cancel-offer.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedEvents, ledgerEntries, p2pWagers, seasonMemberships } from '@/db/schema';
import { cancelOffer, declineWager, offerWager } from '@/server/p2p/offer';
import { resetDb } from '@/test/db';
import { makeCreditedMembership } from '@/test/factories';

async function credits(membershipId: string) {
  const [row] = await db
    .select({ credits: seasonMemberships.creditsBalanceCents })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, membershipId));
  return row.credits;
}

async function openOffer(actorUserId: string, opponentMembershipId?: string) {
  const result = await offerWager({
    actorUserId,
    kind: 'FREEFORM',
    opponentMembershipId,
    offererStakeCents: 50_000n,
    acceptorStakeCents: 20_000n,
    description: 'a test wager',
    expiresAt: new Date(Date.now() + 3_600_000),
    resolvesBy: new Date(Date.now() + 7 * 86_400_000),
  });
  if (!result.ok) throw new Error(`expected the offer to succeed: ${JSON.stringify(result)}`);
  return result.wagerId;
}

describe('cancelOffer', () => {
  beforeEach(resetDb);

  it('refunds the escrow and closes the offer', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const wagerId = await openOffer(offerer.user.id);
    expect(await credits(offerer.membership.id)).toBe(50_000n);

    const result = await cancelOffer({ wagerId, actorUserId: offerer.user.id });

    expect(result).toEqual({ ok: true, refundedCents: 50_000n });
    expect(await credits(offerer.membership.id)).toBe(100_000n);

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.status).toBe('CANCELED');

    const [refund] = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.type, 'P2P_REFUND'));
    expect(refund.amountCents).toBe(50_000n);
    expect(refund.currency).toBe('CREDITS');
    expect(refund.idempotencyKey).toBe(`p2p:${wagerId}:refund:canceled:${offerer.membership.id}`);
  });

  it('posts no feed card — a withdrawn offer is a non-event', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const wagerId = await openOffer(offerer.user.id);

    await cancelOffer({ wagerId, actorUserId: offerer.user.id });

    const types = await db.select({ type: feedEvents.type }).from(feedEvents);
    expect(types.map((t) => t.type)).toEqual(['P2P_OFFERED']);
  });

  it('is idempotent: cancelling twice refunds once', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const wagerId = await openOffer(offerer.user.id);

    await cancelOffer({ wagerId, actorUserId: offerer.user.id });
    const second = await cancelOffer({ wagerId, actorUserId: offerer.user.id });

    expect(second).toEqual({
      ok: false,
      error: { code: 'WAGER_NOT_OPEN', status: 'CANCELED' },
    });
    expect(await credits(offerer.membership.id)).toBe(100_000n);
    expect(
      await db.select().from(ledgerEntries).where(eq(ledgerEntries.type, 'P2P_REFUND')),
    ).toHaveLength(1);
  });

  it('refuses anyone who is not the offerer', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const other = await makeCreditedMembership(100_000n, offerer.seasonId);
    const wagerId = await openOffer(offerer.user.id);

    const result = await cancelOffer({ wagerId, actorUserId: other.user.id });

    expect(result).toEqual({ ok: false, error: { code: 'NOT_AUTHORIZED' } });
    expect(await credits(offerer.membership.id)).toBe(50_000n);
  });

  it('reports a missing wager', async () => {
    const offerer = await makeCreditedMembership(100_000n);

    const result = await cancelOffer({
      wagerId: '00000000-0000-4000-8000-000000000000',
      actorUserId: offerer.user.id,
    });

    expect(result).toEqual({ ok: false, error: { code: 'WAGER_NOT_FOUND' } });
  });
});

describe('declineWager', () => {
  beforeEach(resetDb);

  it('lets the named opponent refuse, refunding the offerer', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const opponent = await makeCreditedMembership(100_000n, offerer.seasonId);
    const wagerId = await openOffer(offerer.user.id, opponent.membership.id);

    const result = await declineWager({ wagerId, actorUserId: opponent.user.id });

    expect(result).toEqual({ ok: true, refundedCents: 50_000n });
    expect(await credits(offerer.membership.id)).toBe(100_000n);

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.status).toBe('CANCELED');
  });

  it('refuses a member who was not the one challenged', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const opponent = await makeCreditedMembership(100_000n, offerer.seasonId);
    const bystander = await makeCreditedMembership(100_000n, offerer.seasonId);
    const wagerId = await openOffer(offerer.user.id, opponent.membership.id);

    const result = await declineWager({ wagerId, actorUserId: bystander.user.id });

    expect(result).toEqual({ ok: false, error: { code: 'NOT_AUTHORIZED' } });
  });

  it('refuses to decline an open offer — nobody has standing', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const other = await makeCreditedMembership(100_000n, offerer.seasonId);
    const wagerId = await openOffer(offerer.user.id);

    const result = await declineWager({ wagerId, actorUserId: other.user.id });

    expect(result).toEqual({ ok: false, error: { code: 'NOT_AUTHORIZED' } });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/p2p/__tests__/cancel-offer.test.ts`
Expected: FAIL — `cancelOffer` and `declineWager` are not exported from `@/server/p2p/offer`.

- [ ] **Step 3: Implement both**

Append to `src/server/p2p/offer.ts`. Add `seasonMemberships` to the existing imports if it is not already there (it is), and add these two exports:

```ts
/**
 * Ends an unaccepted offer and refunds the escrow.
 *
 * `who` decides who is allowed: the offerer withdrawing, or the named opponent refusing.
 * Both do exactly the same thing to the row and to the ledger, so they share one body — the
 * only difference worth having is the authorization check.
 */
async function closeOffer(
  input: CancelOfferInput,
  who: 'OFFERER' | 'OPPONENT',
): Promise<CancelOfferResult> {
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const [wager] = await tx
      .select()
      .from(p2pWagers)
      .where(eq(p2pWagers.id, input.wagerId))
      .for('update');

    if (!wager) return { ok: false as const, error: { code: 'WAGER_NOT_FOUND' as const } };
    if (wager.status !== 'OFFERED') {
      return {
        ok: false as const,
        error: { code: 'WAGER_NOT_OPEN' as const, status: wager.status },
      };
    }

    const [membership] = await tx
      .select({ id: seasonMemberships.id })
      .from(seasonMemberships)
      .where(
        and(
          eq(seasonMemberships.userId, input.actorUserId),
          eq(seasonMemberships.seasonId, wager.seasonId),
        ),
      );
    if (!membership) return { ok: false as const, error: { code: 'NOT_AUTHORIZED' as const } };

    const permitted =
      who === 'OFFERER'
        ? membership.id === wager.offererMembershipId
        : // Only a directed offer can be declined: an open offer has no one with standing,
          // and ignoring it is what expiry is for.
          wager.opponentMembershipId !== null && membership.id === wager.opponentMembershipId;
    if (!permitted) return { ok: false as const, error: { code: 'NOT_AUTHORIZED' as const } };

    await tx
      .update(p2pWagers)
      .set({ status: 'CANCELED', settledAt: now })
      .where(eq(p2pWagers.id, wager.id));

    await postEntry(tx, {
      membershipId: wager.offererMembershipId,
      amountCents: wager.offererStakeCents,
      type: 'P2P_REFUND',
      currency: 'CREDITS',
      idempotencyKey: `p2p:${wager.id}:refund:canceled:${wager.offererMembershipId}`,
      p2pWagerId: wager.id,
    });

    // No feed card. A withdrawn or refused offer is a non-event (D26's instinct); it stays
    // visible on the wager itself and in the offerer's ledger.
    return { ok: true as const, refundedCents: wager.offererStakeCents };
  });
}

/** The offerer withdraws their own unaccepted offer. */
export function cancelOffer(input: CancelOfferInput): Promise<CancelOfferResult> {
  return closeOffer(input, 'OFFERER');
}

/** The challenged member refuses a directed offer. */
export function declineWager(input: CancelOfferInput): Promise<CancelOfferResult> {
  return closeOffer(input, 'OPPONENT');
}
```

Extend the type import at the top of `offer.ts` to bring in the two new names:

```ts
import type {
  CancelOfferInput,
  CancelOfferResult,
  OfferWagerError,
  OfferWagerInput,
  OfferWagerResult,
} from './types';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/server/p2p/__tests__/cancel-offer.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Verify and commit**

```bash
npm run verify
git add -A
git commit -m "feat: withdraw and decline an unaccepted offer"
```

---

### Task 7: Accepting a wager

**Files:**

- Create: `src/server/p2p/accept.ts`
- Test: `src/server/p2p/__tests__/accept.test.ts`

**Interfaces:**

- Consumes: `offerWager` (Task 5), `postEntry` (Task 2), `potCents` (Task 3), `P2PAcceptedPayload` (Task 4), `loadSelectionSubject` (Task 5).
- Produces: `acceptWager(input: AcceptWagerInput): Promise<AcceptWagerResult>`

The lock plus the `status = 'OFFERED'` re-check is the whole concurrency story: it is what makes an open offer acceptable by exactly one member no matter how many people tap at once. It is the same pattern `resolveCustomEvent` uses to serialize two people hitting Resolve.

- [ ] **Step 1: Write the failing test**

Create `src/server/p2p/__tests__/accept.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedEvents, ledgerEntries, p2pWagers, seasonMemberships } from '@/db/schema';
import { acceptWager } from '@/server/p2p/accept';
import { offerWager } from '@/server/p2p/offer';
import { resetDb } from '@/test/db';
import { makeCreditedMembership } from '@/test/factories';

async function credits(membershipId: string) {
  const [row] = await db
    .select({ credits: seasonMemberships.creditsBalanceCents })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, membershipId));
  return row.credits;
}

async function openOffer(actorUserId: string, over: Record<string, unknown> = {}) {
  const result = await offerWager({
    actorUserId,
    kind: 'FREEFORM',
    offererStakeCents: 50_000n,
    acceptorStakeCents: 20_000n,
    description: 'a test wager',
    expiresAt: new Date(Date.now() + 3_600_000),
    resolvesBy: new Date(Date.now() + 7 * 86_400_000),
    ...over,
  });
  if (!result.ok) throw new Error(`expected the offer to succeed: ${JSON.stringify(result)}`);
  return result.wagerId;
}

describe('acceptWager', () => {
  beforeEach(resetDb);

  it('escrows the acceptor stake and marks the wager accepted', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const acceptor = await makeCreditedMembership(100_000n, offerer.seasonId);
    const wagerId = await openOffer(offerer.user.id);

    const result = await acceptWager({ wagerId, actorUserId: acceptor.user.id });

    expect(result).toMatchObject({ ok: true, wagerId, creditsBalanceCents: 80_000n });
    expect(await credits(acceptor.membership.id)).toBe(80_000n);
    // The offerer's stake left at offer and has not moved again.
    expect(await credits(offerer.membership.id)).toBe(50_000n);

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.status).toBe('ACCEPTED');
    expect(wager.acceptorMembershipId).toBe(acceptor.membership.id);
    expect(wager.acceptedAt).not.toBeNull();

    const escrows = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.type, 'P2P_ESCROW'));
    expect(escrows).toHaveLength(2);
    expect(escrows.map((e) => e.idempotencyKey).sort()).toEqual([
      `p2p:${wagerId}:escrow:acceptor`,
      `p2p:${wagerId}:escrow:offerer`,
    ]);
  });

  it('posts one P2P_ACCEPTED card naming the pot', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const acceptor = await makeCreditedMembership(100_000n, offerer.seasonId);
    const wagerId = await openOffer(offerer.user.id);

    await acceptWager({ wagerId, actorUserId: acceptor.user.id });

    const [card] = await db.select().from(feedEvents).where(eq(feedEvents.type, 'P2P_ACCEPTED'));
    expect(card.dedupeKey).toBe(`p2p:${wagerId}:accepted`);
    expect(card.subjectMembershipId).toBe(acceptor.membership.id);
    expect(card.payload).toMatchObject({ wagerId, potCents: '70000', subject: 'a test wager' });
  });

  it('lets exactly one of two simultaneous acceptors win', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const a = await makeCreditedMembership(100_000n, offerer.seasonId);
    const b = await makeCreditedMembership(100_000n, offerer.seasonId);
    const wagerId = await openOffer(offerer.user.id);

    const [first, second] = await Promise.all([
      acceptWager({ wagerId, actorUserId: a.user.id }),
      acceptWager({ wagerId, actorUserId: b.user.id }),
    ]);

    const wins = [first, second].filter((r) => r.ok);
    const losses = [first, second].filter((r) => !r.ok);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    expect(losses[0]).toMatchObject({
      ok: false,
      error: { code: 'WAGER_NOT_OPEN', status: 'ACCEPTED' },
    });

    // Exactly one acceptor escrow was written, so exactly one member was charged.
    const escrows = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.idempotencyKey, `p2p:${wagerId}:escrow:acceptor`));
    expect(escrows).toHaveLength(1);

    const balances = [await credits(a.membership.id), await credits(b.membership.id)].sort();
    expect(balances).toEqual([80_000n, 100_000n]);
  });

  it('refuses the offerer accepting their own offer', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const wagerId = await openOffer(offerer.user.id);

    const result = await acceptWager({ wagerId, actorUserId: offerer.user.id });

    expect(result).toEqual({ ok: false, error: { code: 'CANNOT_ACCEPT_OWN_OFFER' } });
  });

  it('refuses anyone but the named opponent on a directed offer', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const opponent = await makeCreditedMembership(100_000n, offerer.seasonId);
    const bystander = await makeCreditedMembership(100_000n, offerer.seasonId);
    const wagerId = await openOffer(offerer.user.id, {
      opponentMembershipId: opponent.membership.id,
    });

    const denied = await acceptWager({ wagerId, actorUserId: bystander.user.id });
    expect(denied).toEqual({ ok: false, error: { code: 'NOT_THE_INVITED_OPPONENT' } });

    const allowed = await acceptWager({ wagerId, actorUserId: opponent.user.id });
    expect(allowed.ok).toBe(true);
  });

  it('refuses an acceptor who cannot cover their stake', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const acceptor = await makeCreditedMembership(5_000n, offerer.seasonId);
    const wagerId = await openOffer(offerer.user.id);

    const result = await acceptWager({ wagerId, actorUserId: acceptor.user.id });

    expect(result).toEqual({
      ok: false,
      error: { code: 'INSUFFICIENT_CREDITS', availableCents: 5_000n },
    });

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.status).toBe('OFFERED');
  });

  it('refuses an offer whose expiry has passed', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const acceptor = await makeCreditedMembership(100_000n, offerer.seasonId);
    const wagerId = await openOffer(offerer.user.id);

    const result = await acceptWager({
      wagerId,
      actorUserId: acceptor.user.id,
      now: new Date(Date.now() + 2 * 3_600_000),
    });

    expect(result).toEqual({ ok: false, error: { code: 'OFFER_EXPIRED' } });
    expect(await credits(acceptor.membership.id)).toBe(100_000n);
  });

  it('refuses a member of another season', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const wagerId = await openOffer(offerer.user.id);
    const stranger = await makeCreditedMembership(100_000n);

    const result = await acceptWager({ wagerId, actorUserId: stranger.user.id });

    expect(result).toEqual({ ok: false, error: { code: 'NOT_A_MEMBER' } });
  });

  it('reports a missing wager', async () => {
    const acceptor = await makeCreditedMembership(100_000n);

    const result = await acceptWager({
      wagerId: '00000000-0000-4000-8000-000000000000',
      actorUserId: acceptor.user.id,
    });

    expect(result).toEqual({ ok: false, error: { code: 'WAGER_NOT_FOUND' } });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/p2p/__tests__/accept.test.ts`
Expected: FAIL — cannot resolve `@/server/p2p/accept`.

- [ ] **Step 3: Write the implementation**

Create `src/server/p2p/accept.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { p2pWagers, seasonMemberships } from '@/db/schema';
import { potCents } from '@/domain/p2p';
import { emitFeedEvent } from '@/server/feed/emit';
import type { P2PAcceptedPayload } from '@/server/feed/payload';
import { postEntry } from '@/server/money/ledger';
import { loadSelectionSubject } from './subject';
import type { AcceptWagerInput, AcceptWagerResult } from './types';

/**
 * Takes the other side of an offer and escrows the acceptor's stake.
 *
 * The `FOR UPDATE` lock on the wager row, followed by re-reading `status` from the locked
 * row, is what makes an open offer acceptable by exactly one member: a second caller blocks
 * on the lock, then wakes to find the status already moved to ACCEPTED and is rejected. Do
 * not replace it with a read-then-update — the gap between the two is the bug.
 */
export async function acceptWager(input: AcceptWagerInput): Promise<AcceptWagerResult> {
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const [wager] = await tx
      .select()
      .from(p2pWagers)
      .where(eq(p2pWagers.id, input.wagerId))
      .for('update');

    if (!wager) return { ok: false as const, error: { code: 'WAGER_NOT_FOUND' as const } };
    if (wager.status !== 'OFFERED') {
      return {
        ok: false as const,
        error: { code: 'WAGER_NOT_OPEN' as const, status: wager.status },
      };
    }
    if (wager.expiresAt.getTime() <= now.getTime()) {
      return { ok: false as const, error: { code: 'OFFER_EXPIRED' as const } };
    }

    const [membership] = await tx
      .select({
        id: seasonMemberships.id,
        creditsBalanceCents: seasonMemberships.creditsBalanceCents,
      })
      .from(seasonMemberships)
      .where(
        and(
          eq(seasonMemberships.userId, input.actorUserId),
          eq(seasonMemberships.seasonId, wager.seasonId),
        ),
      )
      .for('update');

    if (!membership) return { ok: false as const, error: { code: 'NOT_A_MEMBER' as const } };
    if (membership.id === wager.offererMembershipId) {
      return { ok: false as const, error: { code: 'CANNOT_ACCEPT_OWN_OFFER' as const } };
    }
    if (wager.opponentMembershipId !== null && wager.opponentMembershipId !== membership.id) {
      return { ok: false as const, error: { code: 'NOT_THE_INVITED_OPPONENT' as const } };
    }
    if (membership.creditsBalanceCents < wager.acceptorStakeCents) {
      return {
        ok: false as const,
        error: {
          code: 'INSUFFICIENT_CREDITS' as const,
          availableCents: membership.creditsBalanceCents,
        },
      };
    }

    await tx
      .update(p2pWagers)
      .set({ status: 'ACCEPTED', acceptorMembershipId: membership.id, acceptedAt: now })
      .where(eq(p2pWagers.id, wager.id));

    const posted = await postEntry(tx, {
      membershipId: membership.id,
      amountCents: -wager.acceptorStakeCents,
      type: 'P2P_ESCROW',
      currency: 'CREDITS',
      idempotencyKey: `p2p:${wager.id}:escrow:acceptor`,
      p2pWagerId: wager.id,
    });

    const subject =
      wager.kind === 'FREEFORM'
        ? (wager.description ?? '')
        : ((await loadSelectionSubject(wager.selectionId!, tx))?.subject ?? '');

    const payload: P2PAcceptedPayload = {
      wagerId: wager.id,
      kind: wager.kind,
      potCents: potCents(wager.offererStakeCents, wager.acceptorStakeCents).toString(),
      offererStakeCents: wager.offererStakeCents.toString(),
      acceptorStakeCents: wager.acceptorStakeCents.toString(),
      subject,
    };

    await emitFeedEvent(tx, {
      seasonId: wager.seasonId,
      type: 'P2P_ACCEPTED',
      subjectMembershipId: membership.id,
      dedupeKey: `p2p:${wager.id}:accepted`,
      payload,
      occurredAt: now,
    });

    return {
      ok: true as const,
      wagerId: wager.id,
      creditsBalanceCents: posted.balanceCents,
    };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/server/p2p/__tests__/accept.test.ts`
Expected: PASS, 9 tests.

The concurrency test is the one worth re-reading if it flakes. It must fail exactly one of the two calls; if it ever passes both, the lock is not being taken and the escrow invariant is already broken.

- [ ] **Step 5: Verify and commit**

```bash
npm run verify
git add -A
git commit -m "feat: accept a wager and escrow the acceptor stake"
```

---

### Task 8: The single payout path

**Files:**

- Create: `src/server/p2p/settle-wager.ts`
- Test: `src/server/p2p/__tests__/settle-wager.test.ts`

**Interfaces:**

- Consumes: `postEntry` (Task 2), `potCents` (Task 3), `P2PSettledPayload` / `P2PVoidedPayload` / `P2PVoidReason` (Task 4), `loadSelectionSubject` (Task 5).
- Produces:
  - `settleWagerInTx(tx: Tx, opts: SettleWagerOptions): Promise<SettleWagerSummary>`
  - `SettleWagerOptions = { wagerId: string; verdict: P2PVerdict; settledAt: Date; reason: P2PVoidReason; byArbitration: boolean; actorUserId?: string; note?: string }`
  - `SettleWagerSummary = { attempt: number; paidCents: bigint; winnerMembershipId: string | null }`

This is the **only** place a wager pays out. `claimWinner`, `proposeCancel`, `sweepP2PWagers` and `arbitrateWager` all call it. Writing the payout inline in any of those four and extracting it later produces a second payout path, and the second one is where the drift will be.

It takes a `tx` rather than opening its own, for the reason `emitFeedEvent` does: the payout must commit or roll back with whatever decided it.

**It assumes the caller already holds the row lock.** Every caller takes `SELECT ... FOR UPDATE` on the wager before calling in.

**Re-settlement is handled here, not by the caller.** If the wager is already `SETTLED`, this writes `SETTLEMENT_REVERSAL` entries undoing every entry the previous attempt wrote, then pays the new verdict at `attempt + 1` (D15).

- [ ] **Step 1: Write the failing test**

Create `src/server/p2p/__tests__/settle-wager.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedEvents, ledgerEntries, p2pWagers, seasonMemberships } from '@/db/schema';
import { settleWagerInTx } from '@/server/p2p/settle-wager';
import { acceptWager } from '@/server/p2p/accept';
import { offerWager } from '@/server/p2p/offer';
import { resetDb } from '@/test/db';
import { makeCreditedMembership } from '@/test/factories';

async function credits(membershipId: string) {
  const [row] = await db
    .select({ credits: seasonMemberships.creditsBalanceCents })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, membershipId));
  return row.credits;
}

/** An accepted wager: offerer stakes 50,000, acceptor stakes 20,000, pot is 70,000. */
async function accepted() {
  const offerer = await makeCreditedMembership(100_000n);
  const acceptor = await makeCreditedMembership(100_000n, offerer.seasonId);

  const offered = await offerWager({
    actorUserId: offerer.user.id,
    kind: 'FREEFORM',
    offererStakeCents: 50_000n,
    acceptorStakeCents: 20_000n,
    description: 'a test wager',
    expiresAt: new Date(Date.now() + 3_600_000),
    resolvesBy: new Date(Date.now() + 7 * 86_400_000),
  });
  if (!offered.ok) throw new Error('expected the offer to succeed');

  const taken = await acceptWager({ wagerId: offered.wagerId, actorUserId: acceptor.user.id });
  if (!taken.ok) throw new Error('expected the acceptance to succeed');

  return { offerer, acceptor, wagerId: offered.wagerId };
}

function settle(wagerId: string, verdict: 'OFFERER' | 'ACCEPTOR' | 'VOID', over = {}) {
  return db.transaction((tx) =>
    settleWagerInTx(tx, {
      wagerId,
      verdict,
      settledAt: new Date('2026-09-10T00:00:00Z'),
      reason: 'AGREED_VOID',
      byArbitration: false,
      ...over,
    }),
  );
}

describe('settleWagerInTx', () => {
  beforeEach(resetDb);

  it('pays the whole pot to the offerer', async () => {
    const { offerer, acceptor, wagerId } = await accepted();

    const summary = await settle(wagerId, 'OFFERER');

    expect(summary).toMatchObject({ attempt: 1, paidCents: 70_000n });
    expect(summary.winnerMembershipId).toBe(offerer.membership.id);

    // Started 100,000, escrowed 50,000, took the 70,000 pot.
    expect(await credits(offerer.membership.id)).toBe(120_000n);
    // Started 100,000, escrowed 20,000, got nothing back.
    expect(await credits(acceptor.membership.id)).toBe(80_000n);

    const [won] = await db.select().from(ledgerEntries).where(eq(ledgerEntries.type, 'P2P_WON'));
    expect(won.membershipId).toBe(offerer.membership.id);
    expect(won.amountCents).toBe(70_000n);
    expect(won.currency).toBe('CREDITS');
    expect(won.idempotencyKey).toBe(`p2p:${wagerId}:settled:1:won`);

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.status).toBe('SETTLED');
    expect(wager.verdict).toBe('OFFERER');
    expect(wager.settlementAttempts).toBe(1);
  });

  it('pays the whole pot to the acceptor', async () => {
    const { offerer, acceptor, wagerId } = await accepted();

    await settle(wagerId, 'ACCEPTOR');

    expect(await credits(acceptor.membership.id)).toBe(150_000n);
    expect(await credits(offerer.membership.id)).toBe(50_000n);
  });

  it('refunds each stake to its owner on VOID', async () => {
    const { offerer, acceptor, wagerId } = await accepted();

    const summary = await settle(wagerId, 'VOID');

    expect(summary).toMatchObject({ attempt: 1, paidCents: 70_000n, winnerMembershipId: null });
    expect(await credits(offerer.membership.id)).toBe(100_000n);
    expect(await credits(acceptor.membership.id)).toBe(100_000n);

    const refunds = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.type, 'P2P_REFUND'));
    expect(refunds).toHaveLength(2);
    expect(refunds.map((r) => r.amountCents).sort()).toEqual([20_000n, 50_000n]);

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.status).toBe('VOIDED');
  });

  it('posts a P2P_SETTLED card on a decided wager', async () => {
    const { wagerId } = await accepted();

    await settle(wagerId, 'OFFERER');

    const [card] = await db.select().from(feedEvents).where(eq(feedEvents.type, 'P2P_SETTLED'));
    expect(card.dedupeKey).toBe(`p2p:${wagerId}:settled:1`);
    expect(card.payload).toMatchObject({
      wagerId,
      verdict: 'OFFERER',
      potCents: '70000',
      attempt: 1,
      correction: false,
      byArbitration: false,
    });
  });

  it('posts a P2P_VOIDED card instead when nobody won', async () => {
    const { wagerId } = await accepted();

    await settle(wagerId, 'VOID', { reason: 'MUTUAL_CANCEL' });

    expect(
      await db.select().from(feedEvents).where(eq(feedEvents.type, 'P2P_SETTLED')),
    ).toHaveLength(0);
    const [card] = await db.select().from(feedEvents).where(eq(feedEvents.type, 'P2P_VOIDED'));
    expect(card.subjectMembershipId).toBeNull();
    expect(card.dedupeKey).toBe(`p2p:${wagerId}:voided:1`);
    expect(card.payload).toMatchObject({ reason: 'MUTUAL_CANCEL', refundedCents: '70000' });
  });

  it('reverses attempt 1 before paying attempt 2', async () => {
    const { offerer, acceptor, wagerId } = await accepted();

    await settle(wagerId, 'OFFERER');
    expect(await credits(offerer.membership.id)).toBe(120_000n);

    const summary = await settle(wagerId, 'ACCEPTOR', {
      byArbitration: true,
      note: 'the video shows otherwise',
      actorUserId: offerer.user.id,
    });

    expect(summary.attempt).toBe(2);
    // The offerer's 70,000 is taken back; the acceptor is paid the pot instead.
    expect(await credits(offerer.membership.id)).toBe(50_000n);
    expect(await credits(acceptor.membership.id)).toBe(150_000n);

    const reversals = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.type, 'SETTLEMENT_REVERSAL'));
    expect(reversals).toHaveLength(1);
    expect(reversals[0].amountCents).toBe(-70_000n);
    expect(reversals[0].idempotencyKey).toBe(`p2p:${wagerId}:reversal:2:${offerer.membership.id}`);

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.verdict).toBe('ACCEPTOR');
    expect(wager.settlementAttempts).toBe(2);
    expect(wager.resolutionNote).toBe('the video shows otherwise');
  });

  it('marks a corrected settlement as a correction on its card', async () => {
    const { offerer, wagerId } = await accepted();

    await settle(wagerId, 'OFFERER');
    await settle(wagerId, 'ACCEPTOR', {
      byArbitration: true,
      note: 'corrected',
      actorUserId: offerer.user.id,
    });

    const cards = await db.select().from(feedEvents).where(eq(feedEvents.type, 'P2P_SETTLED'));
    expect(cards).toHaveLength(2);
    const second = cards.find((c) => c.dedupeKey === `p2p:${wagerId}:settled:2`)!;
    expect(second.payload).toMatchObject({ attempt: 2, correction: true, byArbitration: true });
  });

  it('reverses a void correctly — both refunds come back', async () => {
    const { offerer, acceptor, wagerId } = await accepted();

    await settle(wagerId, 'VOID');
    expect(await credits(offerer.membership.id)).toBe(100_000n);

    await settle(wagerId, 'OFFERER', {
      byArbitration: true,
      note: 'it was resolvable after all',
      actorUserId: offerer.user.id,
    });

    // Both refunds are pulled back, then the pot is paid to the offerer.
    expect(await credits(offerer.membership.id)).toBe(120_000n);
    expect(await credits(acceptor.membership.id)).toBe(80_000n);

    const reversals = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.type, 'SETTLEMENT_REVERSAL'));
    expect(reversals).toHaveLength(2);
    expect(reversals.map((r) => r.amountCents).sort()).toEqual([-50_000n, -20_000n]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/p2p/__tests__/settle-wager.test.ts`
Expected: FAIL — cannot resolve `@/server/p2p/settle-wager`.

- [ ] **Step 3: Write the implementation**

Create `src/server/p2p/settle-wager.ts`:

```ts
import { and, eq, inArray } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { ledgerEntries, p2pWagers, users } from '@/db/schema';
import { potCents } from '@/domain/p2p';
import { emitFeedEvent } from '@/server/feed/emit';
import type { P2PSettledPayload, P2PVoidedPayload, P2PVoidReason } from '@/server/feed/payload';
import { postEntry } from '@/server/money/ledger';
import { loadSelectionSubject } from './subject';
import type { P2PVerdict } from './types';

export interface SettleWagerOptions {
  wagerId: string;
  verdict: P2PVerdict;
  settledAt: Date;
  /** Why both stakes are coming back. Ignored unless the verdict is VOID. */
  reason: P2PVoidReason;
  /** True when an admin decided it rather than the two parties agreeing. */
  byArbitration: boolean;
  actorUserId?: string;
  /** Mandatory on an arbitration; recorded on the wager and the card. */
  note?: string;
}

export interface SettleWagerSummary {
  attempt: number;
  /** Total credits moved out of escrow — the pot, whether won or refunded. */
  paidCents: bigint;
  /** Null on a VOID: nobody won. */
  winnerMembershipId: string | null;
}

/** The money entry types this module writes, and therefore the ones a reversal undoes. */
const PAYOUT_TYPES = ['P2P_WON', 'P2P_REFUND'] as const;

/**
 * The one and only place a wager pays out.
 *
 * `claimWinner`, `proposeCancel`, `sweepP2PWagers` and `arbitrateWager` all route through
 * here. Do not add a second payout path — every one of those four callers has a different
 * trigger but the identical money consequence, and duplicating it is how the two versions
 * drift apart.
 *
 * Takes a `tx` rather than opening its own, for the reason `emitFeedEvent` does: a payout
 * that commits separately from the decision that caused it can succeed when the decision
 * fails. **The caller must already hold `SELECT ... FOR UPDATE` on the wager row.**
 *
 * Re-settlement lives here too. A wager already `SETTLED` or `VOIDED` has its previous
 * attempt reversed entry-by-entry before the new verdict is paid, so history is corrected by
 * addition and never by edit (D15). `settlementAttempts` feeds every idempotency key, which
 * is what stops a correction colliding with the payout it corrects.
 */
export async function settleWagerInTx(
  tx: Tx,
  opts: SettleWagerOptions,
): Promise<SettleWagerSummary> {
  const [wager] = await tx.select().from(p2pWagers).where(eq(p2pWagers.id, opts.wagerId));
  if (!wager) throw new Error(`no wager ${opts.wagerId}`);
  if (wager.acceptorMembershipId === null) {
    throw new Error(`wager ${opts.wagerId} was never accepted and cannot settle`);
  }

  const attempt = wager.settlementAttempts + 1;
  const pot = potCents(wager.offererStakeCents, wager.acceptorStakeCents);
  const note = opts.note?.trim() ?? null;

  // Undo whatever the previous attempt paid, one reversing entry per entry it wrote. The
  // amounts are read back from the ledger rather than recomputed, so a reversal cannot
  // disagree with what was actually paid.
  if (wager.settlementAttempts > 0) {
    const prior = await tx
      .select({
        membershipId: ledgerEntries.membershipId,
        amountCents: ledgerEntries.amountCents,
      })
      .from(ledgerEntries)
      .where(
        and(eq(ledgerEntries.p2pWagerId, wager.id), inArray(ledgerEntries.type, [...PAYOUT_TYPES])),
      );

    for (const entry of prior) {
      await postEntry(tx, {
        membershipId: entry.membershipId,
        amountCents: -entry.amountCents,
        type: 'SETTLEMENT_REVERSAL',
        currency: 'CREDITS',
        idempotencyKey: `p2p:${wager.id}:reversal:${attempt}:${entry.membershipId}`,
        p2pWagerId: wager.id,
        actorUserId: opts.actorUserId,
        note,
      });
    }
  }

  const winnerMembershipId =
    opts.verdict === 'OFFERER'
      ? wager.offererMembershipId
      : opts.verdict === 'ACCEPTOR'
        ? wager.acceptorMembershipId
        : null;

  if (winnerMembershipId !== null) {
    await postEntry(tx, {
      membershipId: winnerMembershipId,
      amountCents: pot,
      type: 'P2P_WON',
      currency: 'CREDITS',
      idempotencyKey: `p2p:${wager.id}:settled:${attempt}:won`,
      p2pWagerId: wager.id,
      actorUserId: opts.actorUserId,
      note,
    });
  } else {
    // Each side gets back exactly what they put in — never half the pot each, which would
    // silently transfer credits whenever the stakes were asymmetric.
    for (const [membershipId, stake] of [
      [wager.offererMembershipId, wager.offererStakeCents],
      [wager.acceptorMembershipId, wager.acceptorStakeCents],
    ] as const) {
      await postEntry(tx, {
        membershipId,
        amountCents: stake,
        type: 'P2P_REFUND',
        currency: 'CREDITS',
        idempotencyKey: `p2p:${wager.id}:settled:${attempt}:refund:${membershipId}`,
        p2pWagerId: wager.id,
        actorUserId: opts.actorUserId,
        note,
      });
    }
  }

  await tx
    .update(p2pWagers)
    .set({
      status: opts.verdict === 'VOID' ? 'VOIDED' : 'SETTLED',
      verdict: opts.verdict,
      settledAt: opts.settledAt,
      settlementAttempts: attempt,
      resolvedByUserId: opts.byArbitration ? (opts.actorUserId ?? null) : null,
      resolutionNote: note,
    })
    .where(eq(p2pWagers.id, wager.id));

  const subject =
    wager.kind === 'FREEFORM'
      ? (wager.description ?? '')
      : ((await loadSelectionSubject(wager.selectionId!, tx))?.subject ?? '');

  if (opts.verdict === 'VOID') {
    let adminDisplayName: string | null = null;
    if (opts.byArbitration && opts.actorUserId) {
      const [admin] = await tx
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, opts.actorUserId));
      adminDisplayName = admin?.displayName ?? 'an admin';
    }

    const payload: P2PVoidedPayload = {
      wagerId: wager.id,
      subject,
      reason: opts.reason,
      refundedCents: pot.toString(),
      attempt,
      note,
      adminDisplayName,
    };

    await emitFeedEvent(tx, {
      seasonId: wager.seasonId,
      type: 'P2P_VOIDED',
      // No subject member: a void is about the wager, not about either party.
      dedupeKey: `p2p:${wager.id}:voided:${attempt}`,
      payload,
      occurredAt: opts.settledAt,
    });
  } else {
    const payload: P2PSettledPayload = {
      wagerId: wager.id,
      kind: wager.kind,
      verdict: opts.verdict,
      potCents: pot.toString(),
      subject,
      attempt,
      correction: attempt > 1,
      byArbitration: opts.byArbitration,
    };

    await emitFeedEvent(tx, {
      seasonId: wager.seasonId,
      type: 'P2P_SETTLED',
      subjectMembershipId: winnerMembershipId,
      dedupeKey: `p2p:${wager.id}:settled:${attempt}`,
      payload,
      occurredAt: opts.settledAt,
    });
  }

  return { attempt, paidCents: pot, winnerMembershipId };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/server/p2p/__tests__/settle-wager.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Verify and commit**

```bash
npm run verify
git add -A
git commit -m "feat: add the single wager payout path with reversal on re-settlement"
```

---

### Task 9: Claiming a winner

**Files:**

- Create: `src/server/p2p/claim.ts`
- Test: `src/server/p2p/__tests__/claim.test.ts`

**Interfaces:**

- Consumes: `settleWagerInTx` (Task 8), `agreedVerdict` / `isDisputed` (Task 3), `P2PDisputedPayload` (Task 4).
- Produces: `claimWinner(input: ClaimWinnerInput): Promise<ClaimWinnerResult>`

Three outcomes, decided inside one transaction: agreement settles, disagreement posts a dispute card, and a lone claim just waits. A party may overwrite their own claim while the wager is unsettled — changing your mind before it is resolved is honest, and the alternative is a locked-in mistake needing an admin.

- [ ] **Step 1: Write the failing test**

Create `src/server/p2p/__tests__/claim.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedEvents, ledgerEntries, p2pWagers, seasonMemberships } from '@/db/schema';
import { acceptWager } from '@/server/p2p/accept';
import { claimWinner } from '@/server/p2p/claim';
import { offerWager } from '@/server/p2p/offer';
import { resetDb } from '@/test/db';
import { makeCreditedMembership } from '@/test/factories';

async function credits(membershipId: string) {
  const [row] = await db
    .select({ credits: seasonMemberships.creditsBalanceCents })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, membershipId));
  return row.credits;
}

/** Offerer stakes 50,000; acceptor stakes 20,000; pot is 70,000. */
async function accepted() {
  const offerer = await makeCreditedMembership(100_000n);
  const acceptor = await makeCreditedMembership(100_000n, offerer.seasonId);

  const offered = await offerWager({
    actorUserId: offerer.user.id,
    kind: 'FREEFORM',
    offererStakeCents: 50_000n,
    acceptorStakeCents: 20_000n,
    description: 'a test wager',
    expiresAt: new Date(Date.now() + 3_600_000),
    resolvesBy: new Date(Date.now() + 7 * 86_400_000),
  });
  if (!offered.ok) throw new Error('expected the offer to succeed');

  const taken = await acceptWager({ wagerId: offered.wagerId, actorUserId: acceptor.user.id });
  if (!taken.ok) throw new Error('expected the acceptance to succeed');

  return { offerer, acceptor, wagerId: offered.wagerId };
}

describe('claimWinner', () => {
  beforeEach(resetDb);

  it('records the first claim and waits for the other side', async () => {
    const { offerer, acceptor, wagerId } = await accepted();

    const result = await claimWinner({
      wagerId,
      actorUserId: offerer.user.id,
      verdict: 'OFFERER',
    });

    expect(result).toEqual({
      ok: true,
      outcome: 'AWAITING_OTHER',
      verdict: null,
      paidCents: 0n,
    });

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.status).toBe('ACCEPTED');
    expect(wager.offererClaim).toBe('OFFERER');
    expect(wager.acceptorClaim).toBeNull();

    // Nothing moved.
    expect(await credits(offerer.membership.id)).toBe(50_000n);
    expect(await credits(acceptor.membership.id)).toBe(80_000n);
  });

  it('settles the moment both parties agree', async () => {
    const { offerer, acceptor, wagerId } = await accepted();

    await claimWinner({ wagerId, actorUserId: offerer.user.id, verdict: 'OFFERER' });
    const result = await claimWinner({
      wagerId,
      actorUserId: acceptor.user.id,
      verdict: 'OFFERER',
    });

    expect(result).toEqual({
      ok: true,
      outcome: 'SETTLED',
      verdict: 'OFFERER',
      paidCents: 70_000n,
    });
    expect(await credits(offerer.membership.id)).toBe(120_000n);
    expect(await credits(acceptor.membership.id)).toBe(80_000n);

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.status).toBe('SETTLED');
    expect(wager.verdict).toBe('OFFERER');
  });

  it('treats a mutual VOID claim as an agreement to refund', async () => {
    const { offerer, acceptor, wagerId } = await accepted();

    await claimWinner({ wagerId, actorUserId: offerer.user.id, verdict: 'VOID' });
    const result = await claimWinner({
      wagerId,
      actorUserId: acceptor.user.id,
      verdict: 'VOID',
    });

    expect(result).toMatchObject({ outcome: 'SETTLED', verdict: 'VOID' });
    expect(await credits(offerer.membership.id)).toBe(100_000n);
    expect(await credits(acceptor.membership.id)).toBe(100_000n);

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.status).toBe('VOIDED');

    const [card] = await db.select().from(feedEvents).where(eq(feedEvents.type, 'P2P_VOIDED'));
    expect(card.payload).toMatchObject({ reason: 'AGREED_VOID' });
  });

  it('disputes when the two disagree, moving no money', async () => {
    const { offerer, acceptor, wagerId } = await accepted();

    await claimWinner({ wagerId, actorUserId: offerer.user.id, verdict: 'OFFERER' });
    const result = await claimWinner({
      wagerId,
      actorUserId: acceptor.user.id,
      verdict: 'ACCEPTOR',
    });

    expect(result).toEqual({
      ok: true,
      outcome: 'DISPUTED',
      verdict: null,
      paidCents: 0n,
    });

    // Still ACCEPTED — disputed is derived from the two claims, never stored (D44).
    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.status).toBe('ACCEPTED');
    expect(wager.offererClaim).toBe('OFFERER');
    expect(wager.acceptorClaim).toBe('ACCEPTOR');
    expect(wager.verdict).toBeNull();

    expect(await credits(offerer.membership.id)).toBe(50_000n);
    expect(await credits(acceptor.membership.id)).toBe(80_000n);
    expect(
      await db.select().from(ledgerEntries).where(eq(ledgerEntries.type, 'P2P_WON')),
    ).toHaveLength(0);
  });

  it('posts one P2P_DISPUTED card', async () => {
    const { offerer, acceptor, wagerId } = await accepted();

    await claimWinner({ wagerId, actorUserId: offerer.user.id, verdict: 'OFFERER' });
    await claimWinner({ wagerId, actorUserId: acceptor.user.id, verdict: 'ACCEPTOR' });

    const [card] = await db.select().from(feedEvents).where(eq(feedEvents.type, 'P2P_DISPUTED'));
    expect(card.dedupeKey).toBe(`p2p:${wagerId}:disputed:1`);
    expect(card.subjectMembershipId).toBe(acceptor.membership.id);
    expect(card.payload).toMatchObject({ wagerId, subject: 'a test wager', attempt: 1 });
  });

  it('lets a party change their mind, which can resolve a dispute', async () => {
    const { offerer, acceptor, wagerId } = await accepted();

    await claimWinner({ wagerId, actorUserId: offerer.user.id, verdict: 'OFFERER' });
    await claimWinner({ wagerId, actorUserId: acceptor.user.id, verdict: 'ACCEPTOR' });

    // The acceptor concedes.
    const result = await claimWinner({
      wagerId,
      actorUserId: acceptor.user.id,
      verdict: 'OFFERER',
    });

    expect(result).toMatchObject({ outcome: 'SETTLED', verdict: 'OFFERER' });
    expect(await credits(offerer.membership.id)).toBe(120_000n);
  });

  it('refuses a claim from someone who is not a party', async () => {
    const { offerer, wagerId } = await accepted();
    const bystander = await makeCreditedMembership(100_000n, offerer.seasonId);

    const result = await claimWinner({
      wagerId,
      actorUserId: bystander.user.id,
      verdict: 'OFFERER',
    });

    expect(result).toEqual({ ok: false, error: { code: 'NOT_A_PARTY' } });
  });

  it('refuses a claim on an unaccepted offer', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const offered = await offerWager({
      actorUserId: offerer.user.id,
      kind: 'FREEFORM',
      offererStakeCents: 10_000n,
      acceptorStakeCents: 10_000n,
      description: 'a test wager',
      expiresAt: new Date(Date.now() + 3_600_000),
      resolvesBy: new Date(Date.now() + 7 * 86_400_000),
    });
    if (!offered.ok) throw new Error('expected the offer to succeed');

    const result = await claimWinner({
      wagerId: offered.wagerId,
      actorUserId: offerer.user.id,
      verdict: 'OFFERER',
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'WAGER_NOT_ACCEPTED', status: 'OFFERED' },
    });
  });

  it('refuses a claim on an already settled wager', async () => {
    const { offerer, acceptor, wagerId } = await accepted();

    await claimWinner({ wagerId, actorUserId: offerer.user.id, verdict: 'OFFERER' });
    await claimWinner({ wagerId, actorUserId: acceptor.user.id, verdict: 'OFFERER' });

    const result = await claimWinner({
      wagerId,
      actorUserId: acceptor.user.id,
      verdict: 'ACCEPTOR',
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'WAGER_NOT_ACCEPTED', status: 'SETTLED' },
    });
    // The settled payout is untouched.
    expect(await credits(offerer.membership.id)).toBe(120_000n);
  });

  it('pays once when both parties claim simultaneously', async () => {
    const { offerer, acceptor, wagerId } = await accepted();

    await Promise.all([
      claimWinner({ wagerId, actorUserId: offerer.user.id, verdict: 'OFFERER' }),
      claimWinner({ wagerId, actorUserId: acceptor.user.id, verdict: 'OFFERER' }),
    ]);

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.status).toBe('SETTLED');
    expect(wager.settlementAttempts).toBe(1);

    const won = await db.select().from(ledgerEntries).where(eq(ledgerEntries.type, 'P2P_WON'));
    expect(won).toHaveLength(1);
    expect(await credits(offerer.membership.id)).toBe(120_000n);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/p2p/__tests__/claim.test.ts`
Expected: FAIL — cannot resolve `@/server/p2p/claim`.

- [ ] **Step 3: Write the implementation**

Create `src/server/p2p/claim.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { p2pWagers, seasonMemberships } from '@/db/schema';
import { agreedVerdict } from '@/domain/p2p';
import { emitFeedEvent } from '@/server/feed/emit';
import type { P2PDisputedPayload } from '@/server/feed/payload';
import { settleWagerInTx } from './settle-wager';
import { loadSelectionSubject } from './subject';
import type { ClaimWinnerInput, ClaimWinnerResult } from './types';

/**
 * One party names who won.
 *
 * Three outcomes, all decided inside the one transaction that writes the claim:
 * agreement settles immediately, disagreement announces a dispute and waits for an admin,
 * and a lone claim simply sits until the other side answers (D47).
 *
 * The `FOR UPDATE` lock is what makes two simultaneous claims deterministic — the second
 * transaction blocks, then reads the first claim and decides against it, so a wager can
 * never be paid twice by two people agreeing at the same instant.
 *
 * A party may overwrite their own claim while the wager is unsettled. Changing your mind
 * before it is resolved is honest, and it lets a dispute be resolved by one side conceding
 * rather than by an admin.
 */
export async function claimWinner(input: ClaimWinnerInput): Promise<ClaimWinnerResult> {
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const [wager] = await tx
      .select()
      .from(p2pWagers)
      .where(eq(p2pWagers.id, input.wagerId))
      .for('update');

    if (!wager) return { ok: false as const, error: { code: 'WAGER_NOT_FOUND' as const } };
    if (wager.status !== 'ACCEPTED') {
      return {
        ok: false as const,
        error: { code: 'WAGER_NOT_ACCEPTED' as const, status: wager.status },
      };
    }

    const [membership] = await tx
      .select({ id: seasonMemberships.id })
      .from(seasonMemberships)
      .where(
        and(
          eq(seasonMemberships.userId, input.actorUserId),
          eq(seasonMemberships.seasonId, wager.seasonId),
        ),
      );
    if (!membership) return { ok: false as const, error: { code: 'NOT_A_PARTY' as const } };

    const isOfferer = membership.id === wager.offererMembershipId;
    const isAcceptor = membership.id === wager.acceptorMembershipId;
    if (!isOfferer && !isAcceptor) {
      return { ok: false as const, error: { code: 'NOT_A_PARTY' as const } };
    }

    const claims = {
      offererClaim: isOfferer ? input.verdict : wager.offererClaim,
      acceptorClaim: isAcceptor ? input.verdict : wager.acceptorClaim,
    };

    await tx.update(p2pWagers).set(claims).where(eq(p2pWagers.id, wager.id));

    const agreed = agreedVerdict(claims);

    if (agreed !== null) {
      const summary = await settleWagerInTx(tx, {
        wagerId: wager.id,
        verdict: agreed,
        settledAt: now,
        // Only reached when the agreed verdict is VOID; the two of them decided it.
        reason: 'AGREED_VOID',
        byArbitration: false,
      });
      return {
        ok: true as const,
        outcome: 'SETTLED' as const,
        verdict: agreed,
        paidCents: summary.paidCents,
      };
    }

    if (claims.offererClaim !== null && claims.acceptorClaim !== null) {
      const subject =
        wager.kind === 'FREEFORM'
          ? (wager.description ?? '')
          : ((await loadSelectionSubject(wager.selectionId!, tx))?.subject ?? '');

      const payload: P2PDisputedPayload = {
        wagerId: wager.id,
        subject,
        attempt: wager.settlementAttempts + 1,
      };

      await emitFeedEvent(tx, {
        seasonId: wager.seasonId,
        type: 'P2P_DISPUTED',
        subjectMembershipId: membership.id,
        // Keyed on the attempt, so a dispute after an admin correction announces itself
        // again rather than being swallowed as a duplicate.
        dedupeKey: `p2p:${wager.id}:disputed:${wager.settlementAttempts + 1}`,
        payload,
        occurredAt: now,
      });

      return {
        ok: true as const,
        outcome: 'DISPUTED' as const,
        verdict: null,
        paidCents: 0n,
      };
    }

    return {
      ok: true as const,
      outcome: 'AWAITING_OTHER' as const,
      verdict: null,
      paidCents: 0n,
    };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/server/p2p/__tests__/claim.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Verify and commit**

```bash
npm run verify
git add -A
git commit -m "feat: settle a wager when both parties agree, dispute when they do not"
```

---

### Task 10: Mutual cancellation

**Files:**

- Modify: `src/server/p2p/claim.ts`
- Test: `src/server/p2p/__tests__/propose-cancel.test.ts`

**Interfaces:**

- Consumes: `settleWagerInTx` (Task 8).
- Produces: `proposeCancel(input: ProposeCancelInput): Promise<ProposeCancelResult>`

One flag alone does nothing. Only when both parties have proposed does the wager void and both stakes come back. Unilateral cancellation after acceptance is losing without paying, and it is not offered.

- [ ] **Step 1: Write the failing test**

Create `src/server/p2p/__tests__/propose-cancel.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedEvents, p2pWagers, seasonMemberships } from '@/db/schema';
import { acceptWager } from '@/server/p2p/accept';
import { proposeCancel } from '@/server/p2p/claim';
import { offerWager } from '@/server/p2p/offer';
import { resetDb } from '@/test/db';
import { makeCreditedMembership } from '@/test/factories';

async function credits(membershipId: string) {
  const [row] = await db
    .select({ credits: seasonMemberships.creditsBalanceCents })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, membershipId));
  return row.credits;
}

async function accepted() {
  const offerer = await makeCreditedMembership(100_000n);
  const acceptor = await makeCreditedMembership(100_000n, offerer.seasonId);

  const offered = await offerWager({
    actorUserId: offerer.user.id,
    kind: 'FREEFORM',
    offererStakeCents: 50_000n,
    acceptorStakeCents: 20_000n,
    description: 'a test wager',
    expiresAt: new Date(Date.now() + 3_600_000),
    resolvesBy: new Date(Date.now() + 7 * 86_400_000),
  });
  if (!offered.ok) throw new Error('expected the offer to succeed');

  const taken = await acceptWager({ wagerId: offered.wagerId, actorUserId: acceptor.user.id });
  if (!taken.ok) throw new Error('expected the acceptance to succeed');

  return { offerer, acceptor, wagerId: offered.wagerId };
}

describe('proposeCancel', () => {
  beforeEach(resetDb);

  it('does nothing on its own', async () => {
    const { offerer, acceptor, wagerId } = await accepted();

    const result = await proposeCancel({ wagerId, actorUserId: offerer.user.id });

    expect(result).toEqual({ ok: true, outcome: 'AWAITING_OTHER', refundedCents: 0n });

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.status).toBe('ACCEPTED');
    expect(wager.offererCancelProposed).toBe(true);
    expect(wager.acceptorCancelProposed).toBe(false);

    expect(await credits(offerer.membership.id)).toBe(50_000n);
    expect(await credits(acceptor.membership.id)).toBe(80_000n);
  });

  it('voids and refunds both stakes once both agree', async () => {
    const { offerer, acceptor, wagerId } = await accepted();

    await proposeCancel({ wagerId, actorUserId: offerer.user.id });
    const result = await proposeCancel({ wagerId, actorUserId: acceptor.user.id });

    expect(result).toEqual({ ok: true, outcome: 'VOIDED', refundedCents: 70_000n });

    // Each gets back exactly what they put in, not half the pot each.
    expect(await credits(offerer.membership.id)).toBe(100_000n);
    expect(await credits(acceptor.membership.id)).toBe(100_000n);

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.status).toBe('VOIDED');
    expect(wager.verdict).toBe('VOID');

    const [card] = await db.select().from(feedEvents).where(eq(feedEvents.type, 'P2P_VOIDED'));
    expect(card.payload).toMatchObject({ reason: 'MUTUAL_CANCEL', refundedCents: '70000' });
  });

  it('is idempotent — one party proposing twice is still one proposal', async () => {
    const { offerer, acceptor, wagerId } = await accepted();

    await proposeCancel({ wagerId, actorUserId: offerer.user.id });
    const second = await proposeCancel({ wagerId, actorUserId: offerer.user.id });

    expect(second).toEqual({ ok: true, outcome: 'AWAITING_OTHER', refundedCents: 0n });
    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.status).toBe('ACCEPTED');
    expect(await credits(acceptor.membership.id)).toBe(80_000n);
  });

  it('refuses a non-party', async () => {
    const { offerer, wagerId } = await accepted();
    const bystander = await makeCreditedMembership(100_000n, offerer.seasonId);

    const result = await proposeCancel({ wagerId, actorUserId: bystander.user.id });

    expect(result).toEqual({ ok: false, error: { code: 'NOT_A_PARTY' } });
  });

  it('refuses once the wager has settled', async () => {
    const { offerer, acceptor, wagerId } = await accepted();

    await proposeCancel({ wagerId, actorUserId: offerer.user.id });
    await proposeCancel({ wagerId, actorUserId: acceptor.user.id });

    const result = await proposeCancel({ wagerId, actorUserId: offerer.user.id });

    expect(result).toEqual({
      ok: false,
      error: { code: 'WAGER_NOT_ACCEPTED', status: 'VOIDED' },
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/p2p/__tests__/propose-cancel.test.ts`
Expected: FAIL — `proposeCancel` is not exported from `@/server/p2p/claim`.

- [ ] **Step 3: Implement it**

Append to `src/server/p2p/claim.ts`, and extend the type import at the top of the file to:

```ts
import type {
  ClaimWinnerInput,
  ClaimWinnerResult,
  ProposeCancelInput,
  ProposeCancelResult,
} from './types';
```

Then append:

```ts
/**
 * Proposes calling the whole thing off. Both parties must propose before anything happens.
 *
 * Unilateral cancellation after acceptance is deliberately not offered — it is just losing
 * without paying. Two flags rather than one is what makes agreement, not surrender, the
 * condition for a refund.
 */
export async function proposeCancel(input: ProposeCancelInput): Promise<ProposeCancelResult> {
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const [wager] = await tx
      .select()
      .from(p2pWagers)
      .where(eq(p2pWagers.id, input.wagerId))
      .for('update');

    if (!wager) return { ok: false as const, error: { code: 'WAGER_NOT_FOUND' as const } };
    if (wager.status !== 'ACCEPTED') {
      return {
        ok: false as const,
        error: { code: 'WAGER_NOT_ACCEPTED' as const, status: wager.status },
      };
    }

    const [membership] = await tx
      .select({ id: seasonMemberships.id })
      .from(seasonMemberships)
      .where(
        and(
          eq(seasonMemberships.userId, input.actorUserId),
          eq(seasonMemberships.seasonId, wager.seasonId),
        ),
      );
    if (!membership) return { ok: false as const, error: { code: 'NOT_A_PARTY' as const } };

    const isOfferer = membership.id === wager.offererMembershipId;
    const isAcceptor = membership.id === wager.acceptorMembershipId;
    if (!isOfferer && !isAcceptor) {
      return { ok: false as const, error: { code: 'NOT_A_PARTY' as const } };
    }

    const flags = {
      offererCancelProposed: isOfferer ? true : wager.offererCancelProposed,
      acceptorCancelProposed: isAcceptor ? true : wager.acceptorCancelProposed,
    };

    await tx.update(p2pWagers).set(flags).where(eq(p2pWagers.id, wager.id));

    if (!flags.offererCancelProposed || !flags.acceptorCancelProposed) {
      return { ok: true as const, outcome: 'AWAITING_OTHER' as const, refundedCents: 0n };
    }

    const summary = await settleWagerInTx(tx, {
      wagerId: wager.id,
      verdict: 'VOID',
      settledAt: now,
      reason: 'MUTUAL_CANCEL',
      byArbitration: false,
    });

    return {
      ok: true as const,
      outcome: 'VOIDED' as const,
      refundedCents: summary.paidCents,
    };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/server/p2p/__tests__/propose-cancel.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Verify and commit**

```bash
npm run verify
git add -A
git commit -m "feat: void an accepted wager when both parties agree to cancel"
```

---

### Task 11: The sweep, and wiring it into the settle cron

**Files:**

- Create: `src/server/p2p/sweep.ts`
- Modify: `src/app/api/cron/settle/route.ts`
- Test: `src/server/p2p/__tests__/sweep.test.ts`

**Interfaces:**

- Consumes: `settleWagerInTx` (Task 8), `verdictForLegStatus` / `isOverdue` (Task 3), `gradeLeg` and `gradeCustomLeg` (existing, unmodified), `lineToNumber` from `@/domain/line` (existing).
- Produces:
  - `sweepP2PWagers(now?: Date): Promise<SweepP2PSummary>`
  - `SweepP2PSummary = { expired: number; settled: number; overdueFlagged: number; errors: { wagerId: string; message: string }[] }`

Three passes, each in its own transaction per wager so one failure cannot roll back the rest — the same resumability discipline `settleFinalGames` follows. It rides the existing `settle` cron beside `sweepOverdueEvents`: no new schedule and no cursor to get stuck (D37's pattern).

**A `FREEFORM` wager is never settled by the sweep.** Only people settle those.

- [ ] **Step 1: Write the failing test**

Create `src/server/p2p/__tests__/sweep.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  customEvents,
  feedEvents,
  games,
  markets,
  p2pWagers,
  seasonMemberships,
} from '@/db/schema';
import { acceptWager } from '@/server/p2p/accept';
import { offerWager } from '@/server/p2p/offer';
import { sweepP2PWagers } from '@/server/p2p/sweep';
import { resetDb } from '@/test/db';
import { makeCreditedMembership, makeCustomEvent } from '@/test/factories';
import { seedBettableGame } from '@/server/bets/__tests__/helpers';

async function credits(membershipId: string) {
  const [row] = await db
    .select({ credits: seasonMemberships.creditsBalanceCents })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, membershipId));
  return row.credits;
}

async function pair() {
  const offerer = await makeCreditedMembership(100_000n);
  const acceptor = await makeCreditedMembership(100_000n, offerer.seasonId);
  return { offerer, acceptor };
}

async function offerAndAccept(
  offererUserId: string,
  acceptorUserId: string,
  over: Record<string, unknown>,
) {
  const offered = await offerWager({
    actorUserId: offererUserId,
    kind: 'FREEFORM',
    offererStakeCents: 50_000n,
    acceptorStakeCents: 20_000n,
    description: 'a test wager',
    expiresAt: new Date(Date.now() + 3_600_000),
    resolvesBy: new Date(Date.now() + 7 * 86_400_000),
    ...over,
  });
  if (!offered.ok) throw new Error(`offer failed: ${JSON.stringify(offered)}`);
  const taken = await acceptWager({ wagerId: offered.wagerId, actorUserId: acceptorUserId });
  if (!taken.ok) throw new Error(`accept failed: ${JSON.stringify(taken)}`);
  return offered.wagerId;
}

describe('sweepP2PWagers — expiry', () => {
  beforeEach(resetDb);

  it('expires an unaccepted offer past its date and refunds the offerer', async () => {
    const { offerer } = await pair();
    const offered = await offerWager({
      actorUserId: offerer.user.id,
      kind: 'FREEFORM',
      offererStakeCents: 50_000n,
      acceptorStakeCents: 20_000n,
      description: 'a test wager',
      expiresAt: new Date(Date.now() + 3_600_000),
      resolvesBy: new Date(Date.now() + 7 * 86_400_000),
    });
    if (!offered.ok) throw new Error('expected the offer to succeed');
    expect(await credits(offerer.membership.id)).toBe(50_000n);

    const summary = await sweepP2PWagers(new Date(Date.now() + 2 * 3_600_000));

    expect(summary.expired).toBe(1);
    expect(await credits(offerer.membership.id)).toBe(100_000n);

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, offered.wagerId));
    expect(wager.status).toBe('EXPIRED');
  });

  it('leaves an offer inside its window alone', async () => {
    const { offerer } = await pair();
    await offerWager({
      actorUserId: offerer.user.id,
      kind: 'FREEFORM',
      offererStakeCents: 50_000n,
      acceptorStakeCents: 20_000n,
      description: 'a test wager',
      expiresAt: new Date(Date.now() + 3_600_000),
      resolvesBy: new Date(Date.now() + 7 * 86_400_000),
    });

    const summary = await sweepP2PWagers();

    expect(summary.expired).toBe(0);
    expect(await credits(offerer.membership.id)).toBe(50_000n);
  });

  it('is idempotent — a second sweep refunds nothing more', async () => {
    const { offerer } = await pair();
    await offerWager({
      actorUserId: offerer.user.id,
      kind: 'FREEFORM',
      offererStakeCents: 50_000n,
      acceptorStakeCents: 20_000n,
      description: 'a test wager',
      expiresAt: new Date(Date.now() + 3_600_000),
      resolvesBy: new Date(Date.now() + 7 * 86_400_000),
    });

    const later = new Date(Date.now() + 2 * 3_600_000);
    await sweepP2PWagers(later);
    const second = await sweepP2PWagers(later);

    expect(second.expired).toBe(0);
    expect(await credits(offerer.membership.id)).toBe(100_000n);
  });

  it('posts no card for an expiry — an ignored offer is a non-event', async () => {
    const { offerer } = await pair();
    await offerWager({
      actorUserId: offerer.user.id,
      kind: 'FREEFORM',
      offererStakeCents: 50_000n,
      acceptorStakeCents: 20_000n,
      description: 'a test wager',
      expiresAt: new Date(Date.now() + 3_600_000),
      resolvesBy: new Date(Date.now() + 7 * 86_400_000),
    });

    await sweepP2PWagers(new Date(Date.now() + 2 * 3_600_000));

    const types = await db.select({ type: feedEvents.type }).from(feedEvents);
    expect(types.map((t) => t.type)).toEqual(['P2P_OFFERED']);
  });
});

describe('sweepP2PWagers — market-backed settlement', () => {
  beforeEach(resetDb);

  it('pays the offerer when their spread covers', async () => {
    const { offerer, acceptor } = await pair();
    const game = await seedBettableGame();
    const wagerId = await offerAndAccept(offerer.user.id, acceptor.user.id, {
      kind: 'MARKET',
      selectionId: game.spread.home,
      description: undefined,
    });

    // Home -3.50 wins by 10.
    await db
      .update(games)
      .set({ status: 'FINAL', homeScore: 27, awayScore: 17 })
      .where(eq(games.id, game.game.id));

    const summary = await sweepP2PWagers();

    expect(summary.settled).toBe(1);
    expect(await credits(offerer.membership.id)).toBe(120_000n);
    expect(await credits(acceptor.membership.id)).toBe(80_000n);

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.status).toBe('SETTLED');
    expect(wager.verdict).toBe('OFFERER');
  });

  it('pays the acceptor when the offerer’s side loses', async () => {
    const { offerer, acceptor } = await pair();
    const game = await seedBettableGame();
    await offerAndAccept(offerer.user.id, acceptor.user.id, {
      kind: 'MARKET',
      selectionId: game.spread.home,
      description: undefined,
    });

    // Home -3.50 loses outright.
    await db
      .update(games)
      .set({ status: 'FINAL', homeScore: 17, awayScore: 27 })
      .where(eq(games.id, game.game.id));

    await sweepP2PWagers();

    expect(await credits(acceptor.membership.id)).toBe(150_000n);
    expect(await credits(offerer.membership.id)).toBe(50_000n);
  });

  it('grades from the frozen line, not the current one', async () => {
    const { offerer, acceptor } = await pair();
    const game = await seedBettableGame();
    await offerAndAccept(offerer.user.id, acceptor.user.id, {
      kind: 'MARKET',
      selectionId: game.spread.home,
      description: undefined,
    });

    const { setSelectionPrice } = await import('@/server/bets/__tests__/helpers');
    // The live line moves to -14.5; the wager was struck at -3.5 and must grade at -3.5.
    await setSelectionPrice(game.spread.home, -110, '-14.50');

    await db
      .update(games)
      .set({ status: 'FINAL', homeScore: 27, awayScore: 17 })
      .where(eq(games.id, game.game.id));

    await sweepP2PWagers();

    // At -3.5 the offerer covers by 10 and wins. At -14.5 they would have lost.
    expect(await credits(offerer.membership.id)).toBe(120_000n);
  });

  it('refunds both on a push', async () => {
    const { offerer, acceptor } = await pair();
    const game = await seedBettableGame();
    const { selections } = await import('@/db/schema');
    await db.update(selections).set({ line: '-3.00' }).where(eq(selections.id, game.spread.home));

    await offerAndAccept(offerer.user.id, acceptor.user.id, {
      kind: 'MARKET',
      selectionId: game.spread.home,
      description: undefined,
    });

    // Home -3 in a game won by exactly 3 is a push.
    await db
      .update(games)
      .set({ status: 'FINAL', homeScore: 20, awayScore: 17 })
      .where(eq(games.id, game.game.id));

    await sweepP2PWagers();

    expect(await credits(offerer.membership.id)).toBe(100_000n);
    expect(await credits(acceptor.membership.id)).toBe(100_000n);
  });

  it('voids both sides when the game is canceled', async () => {
    const { offerer, acceptor } = await pair();
    const game = await seedBettableGame();
    const wagerId = await offerAndAccept(offerer.user.id, acceptor.user.id, {
      kind: 'MARKET',
      selectionId: game.moneyline.home,
      description: undefined,
    });

    await db.update(games).set({ status: 'CANCELED' }).where(eq(games.id, game.game.id));

    await sweepP2PWagers();

    expect(await credits(offerer.membership.id)).toBe(100_000n);
    expect(await credits(acceptor.membership.id)).toBe(100_000n);

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.status).toBe('VOIDED');

    const [card] = await db.select().from(feedEvents).where(eq(feedEvents.type, 'P2P_VOIDED'));
    expect(card.payload).toMatchObject({ reason: 'EVENT_DEAD' });
  });

  it('settles a wager on a resolved custom market', async () => {
    const { offerer, acceptor } = await pair();
    const event = await makeCustomEvent({
      creatorMembershipId: offerer.membership.id,
      seasonId: offerer.seasonId,
    });
    const target = event.marketSelections[0];

    await offerAndAccept(offerer.user.id, acceptor.user.id, {
      kind: 'MARKET',
      selectionId: target.selectionIds[0],
      description: undefined,
    });

    await db
      .update(markets)
      .set({ status: 'SETTLED', winningSelectionId: target.selectionIds[0] })
      .where(eq(markets.id, target.marketId));

    const summary = await sweepP2PWagers();

    expect(summary.settled).toBe(1);
    expect(await credits(offerer.membership.id)).toBe(120_000n);
  });

  it('voids a wager whose custom event was voided', async () => {
    const { offerer, acceptor } = await pair();
    const event = await makeCustomEvent({
      creatorMembershipId: offerer.membership.id,
      seasonId: offerer.seasonId,
    });
    const target = event.marketSelections[0];

    await offerAndAccept(offerer.user.id, acceptor.user.id, {
      kind: 'MARKET',
      selectionId: target.selectionIds[0],
      description: undefined,
    });

    await db
      .update(customEvents)
      .set({ status: 'VOIDED' })
      .where(eq(customEvents.eventId, event.eventId));

    await sweepP2PWagers();

    expect(await credits(offerer.membership.id)).toBe(100_000n);
    expect(await credits(acceptor.membership.id)).toBe(100_000n);
  });

  it('leaves an unfinished game alone', async () => {
    const { offerer, acceptor } = await pair();
    const game = await seedBettableGame();
    await offerAndAccept(offerer.user.id, acceptor.user.id, {
      kind: 'MARKET',
      selectionId: game.moneyline.home,
      description: undefined,
    });

    const summary = await sweepP2PWagers();

    expect(summary.settled).toBe(0);
    expect(await credits(offerer.membership.id)).toBe(50_000n);
  });

  it('never settles a FREEFORM wager, however overdue', async () => {
    const { offerer, acceptor } = await pair();
    await offerAndAccept(offerer.user.id, acceptor.user.id, {
      resolvesBy: new Date(Date.now() + 86_400_000),
    });

    const summary = await sweepP2PWagers(new Date(Date.now() + 2 * 86_400_000));

    expect(summary.settled).toBe(0);
    expect(await credits(offerer.membership.id)).toBe(50_000n);
    expect(await credits(acceptor.membership.id)).toBe(80_000n);
  });
});

describe('sweepP2PWagers — overdue', () => {
  beforeEach(resetDb);

  it('flags an overdue freeform wager exactly once', async () => {
    const { offerer, acceptor } = await pair();
    const wagerId = await offerAndAccept(offerer.user.id, acceptor.user.id, {
      resolvesBy: new Date(Date.now() + 86_400_000),
    });

    const later = new Date(Date.now() + 2 * 86_400_000);
    const first = await sweepP2PWagers(later);
    const second = await sweepP2PWagers(later);

    expect(first.overdueFlagged).toBe(1);
    expect(second.overdueFlagged).toBe(0);

    const cards = await db.select().from(feedEvents).where(eq(feedEvents.type, 'P2P_DISPUTED'));
    expect(cards).toHaveLength(1);
    expect(cards[0].dedupeKey).toBe(`p2p:${wagerId}:overdue:1`);
  });

  it('does not flag a wager the two have already agreed on', async () => {
    const { offerer, acceptor } = await pair();
    const wagerId = await offerAndAccept(offerer.user.id, acceptor.user.id, {
      resolvesBy: new Date(Date.now() + 86_400_000),
    });

    const { claimWinner } = await import('@/server/p2p/claim');
    await claimWinner({ wagerId, actorUserId: offerer.user.id, verdict: 'OFFERER' });
    await claimWinner({ wagerId, actorUserId: acceptor.user.id, verdict: 'OFFERER' });

    const summary = await sweepP2PWagers(new Date(Date.now() + 2 * 86_400_000));

    expect(summary.overdueFlagged).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/p2p/__tests__/sweep.test.ts`
Expected: FAIL — cannot resolve `@/server/p2p/sweep`.

- [ ] **Step 3: Write the sweep**

Create `src/server/p2p/sweep.ts`:

```ts
import { and, eq, lt } from 'drizzle-orm';
import { db } from '@/db/client';
import { customEvents, events, games, markets, p2pWagers, selections } from '@/db/schema';
import type { MarketType, Side } from '@/domain/grading';
import { gradeLeg } from '@/domain/grading';
import { gradeCustomLeg } from '@/domain/custom-grading';
import { lineToNumber } from '@/domain/line';
import { isOverdue, verdictForLegStatus } from '@/domain/p2p';
import { emitFeedEvent } from '@/server/feed/emit';
import type { P2PDisputedPayload } from '@/server/feed/payload';
import { postEntry } from '@/server/money/ledger';
import { settleWagerInTx } from './settle-wager';
import { loadSelectionSubject } from './subject';
import type { P2PVerdict } from './types';

export interface SweepP2PSummary {
  expired: number;
  settled: number;
  overdueFlagged: number;
  errors: { wagerId: string; message: string }[];
}

/**
 * Three passes over the wager table, run from the `settle` cron route.
 *
 * It rides an existing schedule rather than getting its own, and keeps no cursor, for the
 * same reason `sweepOverdueEvents` does (D37): one fewer entry to keep in sync and nothing
 * that can get stuck.
 *
 * Every wager is handled in its own transaction, so one failure cannot roll back the others
 * — the resumability `settleFinalGames` needs for the invocation limit (D3), applied here.
 */
export async function sweepP2PWagers(now: Date = new Date()): Promise<SweepP2PSummary> {
  const summary: SweepP2PSummary = { expired: 0, settled: 0, overdueFlagged: 0, errors: [] };

  await expirePass(now, summary);
  await settlePass(now, summary);
  await overduePass(now, summary);

  return summary;
}

/** Pass 1: unaccepted offers past their date. Refund the offerer, close the offer. */
async function expirePass(now: Date, summary: SweepP2PSummary): Promise<void> {
  const stale = await db
    .select({ id: p2pWagers.id })
    .from(p2pWagers)
    .where(and(eq(p2pWagers.status, 'OFFERED'), lt(p2pWagers.expiresAt, now)));

  for (const { id } of stale) {
    try {
      await db.transaction(async (tx) => {
        const [wager] = await tx.select().from(p2pWagers).where(eq(p2pWagers.id, id)).for('update');
        // Re-read under the lock: an acceptance may have landed since the scan.
        if (!wager || wager.status !== 'OFFERED') return;

        await tx
          .update(p2pWagers)
          .set({ status: 'EXPIRED', settledAt: now })
          .where(eq(p2pWagers.id, wager.id));

        await postEntry(tx, {
          membershipId: wager.offererMembershipId,
          amountCents: wager.offererStakeCents,
          type: 'P2P_REFUND',
          currency: 'CREDITS',
          idempotencyKey: `p2p:${wager.id}:refund:expired:${wager.offererMembershipId}`,
          p2pWagerId: wager.id,
        });

        // No feed card: an ignored offer is a non-event, exactly as a withdrawn one is.
        summary.expired += 1;
      });
    } catch (err) {
      summary.errors.push({ wagerId: id, message: (err as Error).message });
    }
  }
}

/**
 * Pass 2: accepted MARKET wagers whose underlying result has arrived.
 *
 * A FREEFORM wager is never touched here. Only people settle those (D47).
 */
async function settlePass(now: Date, summary: SweepP2PSummary): Promise<void> {
  const live = await db
    .select({
      wagerId: p2pWagers.id,
      selectionId: p2pWagers.selectionId,
      lineAtOffer: p2pWagers.lineAtOffer,
      marketType: markets.type,
      marketStatus: markets.status,
      winningSelectionId: markets.winningSelectionId,
      side: selections.side,
      eventKind: events.kind,
      gameStatus: games.status,
      homeScore: games.homeScore,
      awayScore: games.awayScore,
      customStatus: customEvents.status,
    })
    .from(p2pWagers)
    .innerJoin(selections, eq(p2pWagers.selectionId, selections.id))
    .innerJoin(markets, eq(selections.marketId, markets.id))
    .innerJoin(events, eq(markets.eventId, events.id))
    .leftJoin(games, eq(games.eventId, events.id))
    .leftJoin(customEvents, eq(customEvents.eventId, events.id))
    .where(and(eq(p2pWagers.status, 'ACCEPTED'), eq(p2pWagers.kind, 'MARKET')));

  for (const row of live) {
    const decision = decideMarketVerdict(row);
    if (decision === null) continue;

    try {
      await db.transaction(async (tx) => {
        const [wager] = await tx
          .select({ status: p2pWagers.status })
          .from(p2pWagers)
          .where(eq(p2pWagers.id, row.wagerId))
          .for('update');
        // Re-read under the lock: the two parties may have settled it themselves since.
        if (!wager || wager.status !== 'ACCEPTED') return;

        await settleWagerInTx(tx, {
          wagerId: row.wagerId,
          verdict: decision.verdict,
          settledAt: now,
          reason: decision.reason,
          byArbitration: false,
        });
        summary.settled += 1;
      });
    } catch (err) {
      summary.errors.push({ wagerId: row.wagerId, message: (err as Error).message });
    }
  }
}

/**
 * The verdict a market-backed wager has earned, or null if its result has not arrived.
 *
 * The offerer holds the selection and the acceptor holds its negation, so this is entirely
 * `gradeLeg` / `gradeCustomLeg` plus `verdictForLegStatus` — no new grading logic.
 */
function decideMarketVerdict(row: {
  selectionId: string | null;
  lineAtOffer: string | null;
  marketType: string;
  winningSelectionId: string | null;
  side: string | null;
  eventKind: 'GAME' | 'CUSTOM';
  gameStatus: string | null;
  homeScore: number | null;
  awayScore: number | null;
  customStatus: string | null;
}): { verdict: P2PVerdict; reason: 'EVENT_DEAD' } | null {
  if (row.eventKind === 'GAME') {
    if (row.gameStatus === 'POSTPONED' || row.gameStatus === 'CANCELED') {
      return { verdict: 'VOID', reason: 'EVENT_DEAD' };
    }
    if (row.gameStatus !== 'FINAL') return null;
    if (row.homeScore === null || row.awayScore === null) return null;

    const status = gradeLeg({
      marketType: row.marketType as MarketType,
      side: row.side as Side,
      // The frozen line, never the live one — a line that moved after the offer must not
      // change what was agreed (D10).
      line: lineToNumber(row.lineAtOffer),
      result: { homeScore: row.homeScore, awayScore: row.awayScore },
    });
    return { verdict: verdictForLegStatus(status), reason: 'EVENT_DEAD' };
  }

  if (row.customStatus === 'VOIDED') return { verdict: 'VOID', reason: 'EVENT_DEAD' };
  if (row.winningSelectionId === null) return null;

  const status = gradeCustomLeg({
    selectionId: row.selectionId!,
    winningSelectionId: row.winningSelectionId,
  });
  if (status === 'PENDING') return null;
  return { verdict: verdictForLegStatus(status), reason: 'EVENT_DEAD' };
}

/**
 * Pass 3: accepted wagers past their resolve-by date with no agreed verdict.
 *
 * It moves no money and changes no status — overdue is derived, not stored (D44). Its whole
 * job is to make a forgotten wager impossible to ignore; an admin then arbitrates.
 *
 * The card is a `P2P_DISPUTED` rather than a type of its own: from the season's point of
 * view "these two have not agreed" is the same announcement whether they disagreed out loud
 * or one of them went quiet, and the admin queue treats them identically.
 */
async function overduePass(now: Date, summary: SweepP2PSummary): Promise<void> {
  const live = await db
    .select()
    .from(p2pWagers)
    .where(and(eq(p2pWagers.status, 'ACCEPTED'), lt(p2pWagers.resolvesBy, now)));

  for (const wager of live) {
    if (!isOverdue(wager, now)) continue;

    try {
      const subject =
        wager.kind === 'FREEFORM'
          ? (wager.description ?? '')
          : ((await loadSelectionSubject(wager.selectionId!))?.subject ?? '');

      const payload: P2PDisputedPayload = {
        wagerId: wager.id,
        subject,
        attempt: wager.settlementAttempts + 1,
      };

      const emitted = await db.transaction((tx) =>
        emitFeedEvent(tx, {
          seasonId: wager.seasonId,
          type: 'P2P_DISPUTED',
          subjectMembershipId: wager.offererMembershipId,
          dedupeKey: `p2p:${wager.id}:overdue:${wager.settlementAttempts + 1}`,
          payload,
          occurredAt: now,
        }),
      );

      if (emitted.applied) summary.overdueFlagged += 1;
    } catch (err) {
      summary.errors.push({ wagerId: wager.id, message: (err as Error).message });
    }
  }
}
```

- [ ] **Step 4: Wire it into the settle cron**

Modify `src/app/api/cron/settle/route.ts`. Add the import:

```ts
import { sweepP2PWagers } from '@/server/p2p/sweep';
```

Add the call after the existing `sweepOverdueEvents()` line:

```ts
const overdue = await sweepOverdueEvents();
const wagers = await sweepP2PWagers();
```

Extend the response body and the status calculation so a sweep error is reported the same way a settlement error is:

```ts
// A game or wager that failed is reported, not swallowed — the run still succeeded for
// everyone else, but a persistent failure needs to be visible in the cron logs.
const status = summary.errors.length > 0 || wagers.errors.length > 0 ? 207 : 200;
return Response.json(
  jsonSafe({
    ...summary,
    leadChanged,
    overdueFlagged: overdue.flagged,
    wagersExpired: wagers.expired,
    wagersSettled: wagers.settled,
    wagersOverdue: wagers.overdueFlagged,
    wagerErrors: wagers.errors,
  }),
  { status },
);
```

Update the route's doc comment to mention the third rider:

```ts
/**
 * Every 10 minutes. Settles finished games in batches sized to fit the invocation limit;
 * whatever it does not reach is picked up by the next run.
 *
 * Lead-change detection, overdue-event sweeping and the peer-to-peer wager sweep all ride
 * along here rather than in their own cron entries: settlement is what moves standings, and
 * folding them in means no new schedules to keep in sync.
 */
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/server/p2p/__tests__/sweep.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 6: Verify and commit**

```bash
npm run verify
git add -A
git commit -m "feat: sweep expired offers, settle market wagers, flag overdue ones"
```

---

### Task 12: Admin arbitration

**Files:**

- Create: `src/server/p2p/arbitrate.ts`
- Test: `src/server/p2p/__tests__/arbitrate.test.ts`

**Interfaces:**

- Consumes: `settleWagerInTx` (Task 8).
- Produces: `arbitrateWager(input: ArbitrateWagerInput): Promise<ArbitrateWagerResult>`

Admin-only, mandatory note. Handles both the fresh case (never settled) and the correcting case (already settled — reverse, then re-pay). `settleWagerInTx` already implements the reversal, so this function is authorization, validation, and a call.

**Authorization is the caller's job.** `arbitrateWager` takes `actorUserId` and records it; the admin _check_ happens at the route boundary via `requireAdmin()`, exactly as the custom-events admin actions do. The service does not re-derive role, because the admin pages are the only callers and the redirect belongs in the page.

- [ ] **Step 1: Write the failing test**

Create `src/server/p2p/__tests__/arbitrate.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedEvents, ledgerEntries, p2pWagers, seasonMemberships } from '@/db/schema';
import { acceptWager } from '@/server/p2p/accept';
import { arbitrateWager } from '@/server/p2p/arbitrate';
import { claimWinner } from '@/server/p2p/claim';
import { offerWager } from '@/server/p2p/offer';
import { resetDb } from '@/test/db';
import { makeCreditedMembership } from '@/test/factories';

async function credits(membershipId: string) {
  const [row] = await db
    .select({ credits: seasonMemberships.creditsBalanceCents })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, membershipId));
  return row.credits;
}

async function disputed() {
  const offerer = await makeCreditedMembership(100_000n);
  const acceptor = await makeCreditedMembership(100_000n, offerer.seasonId);
  const admin = await makeCreditedMembership(100_000n, offerer.seasonId);

  const offered = await offerWager({
    actorUserId: offerer.user.id,
    kind: 'FREEFORM',
    offererStakeCents: 50_000n,
    acceptorStakeCents: 20_000n,
    description: 'a test wager',
    expiresAt: new Date(Date.now() + 3_600_000),
    resolvesBy: new Date(Date.now() + 7 * 86_400_000),
  });
  if (!offered.ok) throw new Error('expected the offer to succeed');

  const taken = await acceptWager({ wagerId: offered.wagerId, actorUserId: acceptor.user.id });
  if (!taken.ok) throw new Error('expected the acceptance to succeed');

  await claimWinner({ wagerId: offered.wagerId, actorUserId: offerer.user.id, verdict: 'OFFERER' });
  await claimWinner({
    wagerId: offered.wagerId,
    actorUserId: acceptor.user.id,
    verdict: 'ACCEPTOR',
  });

  return { offerer, acceptor, admin, wagerId: offered.wagerId };
}

describe('arbitrateWager', () => {
  beforeEach(resetDb);

  it('decides a disputed wager and pays the pot', async () => {
    const { offerer, acceptor, admin, wagerId } = await disputed();

    const result = await arbitrateWager({
      wagerId,
      actorUserId: admin.user.id,
      verdict: 'OFFERER',
      note: 'the group chat has the screenshot',
    });

    expect(result).toEqual({ ok: true, attempt: 1, paidCents: 70_000n });
    expect(await credits(offerer.membership.id)).toBe(120_000n);
    expect(await credits(acceptor.membership.id)).toBe(80_000n);

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.status).toBe('SETTLED');
    expect(wager.verdict).toBe('OFFERER');
    expect(wager.resolvedByUserId).toBe(admin.user.id);
    expect(wager.resolutionNote).toBe('the group chat has the screenshot');

    const [card] = await db.select().from(feedEvents).where(eq(feedEvents.type, 'P2P_SETTLED'));
    expect(card.payload).toMatchObject({ byArbitration: true, correction: false, attempt: 1 });
  });

  it('can refund both sides when neither was right', async () => {
    const { offerer, acceptor, admin, wagerId } = await disputed();

    const result = await arbitrateWager({
      wagerId,
      actorUserId: admin.user.id,
      verdict: 'VOID',
      note: 'nobody can establish what was said',
    });

    expect(result).toEqual({ ok: true, attempt: 1, paidCents: 70_000n });
    expect(await credits(offerer.membership.id)).toBe(100_000n);
    expect(await credits(acceptor.membership.id)).toBe(100_000n);

    const [card] = await db.select().from(feedEvents).where(eq(feedEvents.type, 'P2P_VOIDED'));
    expect(card.payload).toMatchObject({
      reason: 'ARBITRATED',
      note: 'nobody can establish what was said',
    });
    expect((card.payload as { adminDisplayName: string }).adminDisplayName).toBeTruthy();
  });

  it('corrects an already settled wager by reversing it first', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const acceptor = await makeCreditedMembership(100_000n, offerer.seasonId);
    const admin = await makeCreditedMembership(100_000n, offerer.seasonId);

    const offered = await offerWager({
      actorUserId: offerer.user.id,
      kind: 'FREEFORM',
      offererStakeCents: 50_000n,
      acceptorStakeCents: 20_000n,
      description: 'a test wager',
      expiresAt: new Date(Date.now() + 3_600_000),
      resolvesBy: new Date(Date.now() + 7 * 86_400_000),
    });
    if (!offered.ok) throw new Error('expected the offer to succeed');
    await acceptWager({ wagerId: offered.wagerId, actorUserId: acceptor.user.id });

    // Both agree, and it pays out.
    await claimWinner({
      wagerId: offered.wagerId,
      actorUserId: offerer.user.id,
      verdict: 'OFFERER',
    });
    await claimWinner({
      wagerId: offered.wagerId,
      actorUserId: acceptor.user.id,
      verdict: 'OFFERER',
    });
    expect(await credits(offerer.membership.id)).toBe(120_000n);

    const result = await arbitrateWager({
      wagerId: offered.wagerId,
      actorUserId: admin.user.id,
      verdict: 'ACCEPTOR',
      note: 'they agreed on the wrong reading of the terms',
    });

    expect(result).toEqual({ ok: true, attempt: 2, paidCents: 70_000n });
    expect(await credits(offerer.membership.id)).toBe(50_000n);
    expect(await credits(acceptor.membership.id)).toBe(150_000n);

    const reversals = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.type, 'SETTLEMENT_REVERSAL'));
    expect(reversals).toHaveLength(1);
    expect(reversals[0].note).toBe('they agreed on the wrong reading of the terms');
    expect(reversals[0].actorUserId).toBe(admin.user.id);
  });

  it('requires a note', async () => {
    const { admin, wagerId } = await disputed();

    const result = await arbitrateWager({
      wagerId,
      actorUserId: admin.user.id,
      verdict: 'OFFERER',
      note: '   ',
    });

    expect(result).toEqual({ ok: false, error: { code: 'NOTE_REQUIRED' } });

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.status).toBe('ACCEPTED');
  });

  it('refuses to arbitrate an offer nobody accepted', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const admin = await makeCreditedMembership(100_000n, offerer.seasonId);

    const offered = await offerWager({
      actorUserId: offerer.user.id,
      kind: 'FREEFORM',
      offererStakeCents: 10_000n,
      acceptorStakeCents: 10_000n,
      description: 'a test wager',
      expiresAt: new Date(Date.now() + 3_600_000),
      resolvesBy: new Date(Date.now() + 7 * 86_400_000),
    });
    if (!offered.ok) throw new Error('expected the offer to succeed');

    const result = await arbitrateWager({
      wagerId: offered.wagerId,
      actorUserId: admin.user.id,
      verdict: 'OFFERER',
      note: 'a note',
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'NOT_ARBITRABLE', status: 'OFFERED' },
    });
  });

  it('refuses to arbitrate a canceled or expired offer', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const admin = await makeCreditedMembership(100_000n, offerer.seasonId);
    const { cancelOffer } = await import('@/server/p2p/offer');

    const offered = await offerWager({
      actorUserId: offerer.user.id,
      kind: 'FREEFORM',
      offererStakeCents: 10_000n,
      acceptorStakeCents: 10_000n,
      description: 'a test wager',
      expiresAt: new Date(Date.now() + 3_600_000),
      resolvesBy: new Date(Date.now() + 7 * 86_400_000),
    });
    if (!offered.ok) throw new Error('expected the offer to succeed');
    await cancelOffer({ wagerId: offered.wagerId, actorUserId: offerer.user.id });

    const result = await arbitrateWager({
      wagerId: offered.wagerId,
      actorUserId: admin.user.id,
      verdict: 'VOID',
      note: 'a note',
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'NOT_ARBITRABLE', status: 'CANCELED' },
    });
  });

  it('reports a missing wager', async () => {
    const admin = await makeCreditedMembership(100_000n);

    const result = await arbitrateWager({
      wagerId: '00000000-0000-4000-8000-000000000000',
      actorUserId: admin.user.id,
      verdict: 'VOID',
      note: 'a note',
    });

    expect(result).toEqual({ ok: false, error: { code: 'WAGER_NOT_FOUND' } });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/p2p/__tests__/arbitrate.test.ts`
Expected: FAIL — cannot resolve `@/server/p2p/arbitrate`.

- [ ] **Step 3: Write the implementation**

Create `src/server/p2p/arbitrate.ts`:

```ts
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { p2pWagers } from '@/db/schema';
import { settleWagerInTx } from './settle-wager';
import type { ArbitrateWagerInput, ArbitrateWagerResult } from './types';

/** The statuses an admin can rule on: live, or already decided and being corrected. */
const ARBITRABLE = new Set(['ACCEPTED', 'SETTLED', 'VOIDED']);

/**
 * An admin decides a wager the two parties could not.
 *
 * Reached from the disputed and overdue queues, both of which are derived rather than
 * stored (D44). Three verdicts are available — `OFFERER`, `ACCEPTOR`, and `VOID` for the
 * case where a winner genuinely does not exist (D45).
 *
 * A wager that already settled is corrected rather than re-paid: `settleWagerInTx` reverses
 * every entry the previous attempt wrote before paying the new verdict, so history is
 * corrected by addition and never by edit (D15).
 *
 * The admin *check* lives at the route boundary in `requireAdmin()`, as it does for every
 * other admin action in this codebase. This function records who acted; it does not
 * re-derive whether they were allowed to.
 */
export async function arbitrateWager(input: ArbitrateWagerInput): Promise<ArbitrateWagerResult> {
  const note = input.note.trim();
  if (note.length === 0) return { ok: false, error: { code: 'NOTE_REQUIRED' } };

  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const [wager] = await tx
      .select()
      .from(p2pWagers)
      .where(eq(p2pWagers.id, input.wagerId))
      .for('update');

    if (!wager) return { ok: false as const, error: { code: 'WAGER_NOT_FOUND' as const } };
    if (!ARBITRABLE.has(wager.status)) {
      // An offer nobody took, or one already withdrawn or expired, has no pot to award.
      return {
        ok: false as const,
        error: { code: 'NOT_ARBITRABLE' as const, status: wager.status },
      };
    }

    const summary = await settleWagerInTx(tx, {
      wagerId: wager.id,
      verdict: input.verdict,
      settledAt: now,
      reason: 'ARBITRATED',
      byArbitration: true,
      actorUserId: input.actorUserId,
      note,
    });

    return { ok: true as const, attempt: summary.attempt, paidCents: summary.paidCents };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/server/p2p/__tests__/arbitrate.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Verify and commit**

```bash
npm run verify
git add -A
git commit -m "feat: let an admin arbitrate a disputed or overdue wager"
```

---

### Task 13: Escrow reconciliation

**Files:**

- Modify: `src/server/money/reconcile.ts`, `src/app/api/cron/reconcile/route.ts`
- Test: `src/server/money/__tests__/reconcile-escrow.test.ts`

**Interfaces:**

- Consumes: `p2pWagers` (Task 1), the P2P entry types (Task 2).
- Produces:
  - `reconcileEscrow(): Promise<EscrowDiscrepancy[]>`
  - `EscrowDiscrepancy = { wagerId: string; status: P2PWagerStatus; expectedHeldCents: bigint; actualHeldCents: bigint }`

**Why this exists.** Until this subsystem, every credit sat in exactly one member's balance at every instant, and `reconcileBalances` proved it. Escrow breaks that: credits in a live pot have left a balance and arrived nowhere. `reconcileBalances` stays correct — each member's cache and ledger sum still agree, both net of escrow — but it can no longer see whether the system total is conserved. A wager that escrowed and never paid out is invisible to it, and that is the exact bug most worth catching (D43).

`reconcileBalances` is **not modified**. This is a second, independent check.

- [ ] **Step 1: Write the failing test**

Create `src/server/money/__tests__/reconcile-escrow.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { p2pWagers } from '@/db/schema';
import { acceptWager } from '@/server/p2p/accept';
import { claimWinner } from '@/server/p2p/claim';
import { offerWager } from '@/server/p2p/offer';
import { postEntry } from '@/server/money/ledger';
import { reconcileBalances, reconcileEscrow } from '@/server/money/reconcile';
import { resetDb } from '@/test/db';
import { makeCreditedMembership } from '@/test/factories';

async function offerOnly(actorUserId: string) {
  const result = await offerWager({
    actorUserId,
    kind: 'FREEFORM',
    offererStakeCents: 50_000n,
    acceptorStakeCents: 20_000n,
    description: 'a test wager',
    expiresAt: new Date(Date.now() + 3_600_000),
    resolvesBy: new Date(Date.now() + 7 * 86_400_000),
  });
  if (!result.ok) throw new Error('expected the offer to succeed');
  return result.wagerId;
}

describe('reconcileEscrow', () => {
  beforeEach(resetDb);

  it('reports nothing when there are no wagers at all', async () => {
    await makeCreditedMembership(100_000n);
    expect(await reconcileEscrow()).toEqual([]);
  });

  it('accepts an OFFERED wager holding exactly one stake', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    await offerOnly(offerer.user.id);

    expect(await reconcileEscrow()).toEqual([]);
    expect(await reconcileBalances()).toEqual([]);
  });

  it('accepts an ACCEPTED wager holding both stakes', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const acceptor = await makeCreditedMembership(100_000n, offerer.seasonId);
    const wagerId = await offerOnly(offerer.user.id);
    await acceptWager({ wagerId, actorUserId: acceptor.user.id });

    expect(await reconcileEscrow()).toEqual([]);
  });

  it('accepts a settled wager holding nothing', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const acceptor = await makeCreditedMembership(100_000n, offerer.seasonId);
    const wagerId = await offerOnly(offerer.user.id);
    await acceptWager({ wagerId, actorUserId: acceptor.user.id });
    await claimWinner({ wagerId, actorUserId: offerer.user.id, verdict: 'OFFERER' });
    await claimWinner({ wagerId, actorUserId: acceptor.user.id, verdict: 'OFFERER' });

    expect(await reconcileEscrow()).toEqual([]);
    expect(await reconcileBalances()).toEqual([]);
  });

  it('accepts a corrected wager, where reversals net the payouts back out', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const acceptor = await makeCreditedMembership(100_000n, offerer.seasonId);
    const admin = await makeCreditedMembership(100_000n, offerer.seasonId);
    const wagerId = await offerOnly(offerer.user.id);
    await acceptWager({ wagerId, actorUserId: acceptor.user.id });
    await claimWinner({ wagerId, actorUserId: offerer.user.id, verdict: 'OFFERER' });
    await claimWinner({ wagerId, actorUserId: acceptor.user.id, verdict: 'OFFERER' });

    const { arbitrateWager } = await import('@/server/p2p/arbitrate');
    await arbitrateWager({
      wagerId,
      actorUserId: admin.user.id,
      verdict: 'ACCEPTOR',
      note: 'corrected',
    });

    expect(await reconcileEscrow()).toEqual([]);
  });

  it('catches a wager that escrowed and never paid out', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const acceptor = await makeCreditedMembership(100_000n, offerer.seasonId);
    const wagerId = await offerOnly(offerer.user.id);
    await acceptWager({ wagerId, actorUserId: acceptor.user.id });

    // Simulate the bug this check exists for: the wager is marked settled but no payout
    // entry was ever written, so 70,000 credits are stranded in the pot forever.
    await db
      .update(p2pWagers)
      .set({ status: 'SETTLED', verdict: 'OFFERER' })
      .where(eq(p2pWagers.id, wagerId));

    const discrepancies = await reconcileEscrow();

    expect(discrepancies).toEqual([
      {
        wagerId,
        status: 'SETTLED',
        expectedHeldCents: 0n,
        actualHeldCents: 70_000n,
      },
    ]);
    // The balance check cannot see it — which is precisely why this second check exists.
    expect(await reconcileBalances()).toEqual([]);
  });

  it('catches a wager paid out while still marked live', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const acceptor = await makeCreditedMembership(100_000n, offerer.seasonId);
    const wagerId = await offerOnly(offerer.user.id);
    await acceptWager({ wagerId, actorUserId: acceptor.user.id });

    // A payout with no status change: the pot is empty but the wager says it holds both.
    await db.transaction((tx) =>
      postEntry(tx, {
        membershipId: offerer.membership.id,
        amountCents: 70_000n,
        type: 'P2P_WON',
        currency: 'CREDITS',
        idempotencyKey: `p2p:${wagerId}:settled:1:won`,
        p2pWagerId: wagerId,
      }),
    );

    expect(await reconcileEscrow()).toEqual([
      {
        wagerId,
        status: 'ACCEPTED',
        expectedHeldCents: 70_000n,
        actualHeldCents: 0n,
      },
    ]);
  });

  it('catches an offer refunded without being closed', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const wagerId = await offerOnly(offerer.user.id);

    await db.transaction((tx) =>
      postEntry(tx, {
        membershipId: offerer.membership.id,
        amountCents: 50_000n,
        type: 'P2P_REFUND',
        currency: 'CREDITS',
        idempotencyKey: `p2p:${wagerId}:refund:bogus`,
        p2pWagerId: wagerId,
      }),
    );

    expect(await reconcileEscrow()).toEqual([
      {
        wagerId,
        status: 'OFFERED',
        expectedHeldCents: 50_000n,
        actualHeldCents: 0n,
      },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/money/__tests__/reconcile-escrow.test.ts`
Expected: FAIL — `reconcileEscrow` is not exported from `@/server/money/reconcile`.

- [ ] **Step 3: Write the check**

Append to `src/server/money/reconcile.ts`, and extend the type import at the top of the file to:

```ts
import type { Currency, P2PWagerStatus } from '@/db/schema';
```

Then append:

```ts
export interface EscrowDiscrepancy {
  wagerId: string;
  status: P2PWagerStatus;
  /** What the wager's own status says should be locked in its pot. */
  expectedHeldCents: bigint;
  /** What the ledger has actually locked: escrows, less payouts, refunds and reversals. */
  actualHeldCents: bigint;
}

/**
 * The second half of reconciliation, added by subsystem 4 (D43).
 *
 * `reconcileBalances` compares each cached balance against that member's own ledger sum, and
 * both sides of that comparison are already net of escrow — so it stays correct and it
 * cannot see escrow drift at all. A wager that took both stakes and never paid out leaves
 * every member's cache in perfect agreement with their entries while 70,000 credits sit in
 * a pot nobody owns.
 *
 * This check closes that gap: for every wager, what the ledger has locked against it must
 * equal what its status says should be locked. One stake while OFFERED, both while ACCEPTED,
 * nothing once it has ended.
 *
 * Written with literal, table-qualified identifiers rather than drizzle's column helpers, for
 * the same reason `reconcileBalances` is — the correlated subquery would otherwise resolve
 * both sides against its own FROM (D30).
 */
export async function reconcileEscrow(): Promise<EscrowDiscrepancy[]> {
  const rows = await db.execute<{
    wager_id: string;
    status: P2PWagerStatus;
    expected_cents: string;
    actual_cents: string;
  }>(sql`
    SELECT w.id AS wager_id,
           w.status AS status,
           CASE w.status
             WHEN 'OFFERED'  THEN w.offerer_stake_cents
             WHEN 'ACCEPTED' THEN w.offerer_stake_cents + w.acceptor_stake_cents
             ELSE 0
           END AS expected_cents,
           COALESCE((
             SELECT -SUM(l.amount_cents)
             FROM ledger_entries l
             WHERE l.p2p_wager_id = w.id
           ), 0) AS actual_cents
    FROM p2p_wagers w
    WHERE CASE w.status
            WHEN 'OFFERED'  THEN w.offerer_stake_cents
            WHEN 'ACCEPTED' THEN w.offerer_stake_cents + w.acceptor_stake_cents
            ELSE 0
          END
          <> COALESCE((
            SELECT -SUM(l.amount_cents)
            FROM ledger_entries l
            WHERE l.p2p_wager_id = w.id
          ), 0)
    ORDER BY w.id
  `);

  return Array.from(rows).map((row) => ({
    wagerId: row.wager_id,
    status: row.status,
    expectedHeldCents: BigInt(row.expected_cents),
    actualHeldCents: BigInt(row.actual_cents),
  }));
}
```

**Why the sum is negated.** Every entry attributed to a wager is signed from the _member's_ point of view: an escrow is negative (credits leaving them), a payout or refund positive. The pot holds the negation of their sum. A reversal is likewise positive or negative in the member's frame, so a corrected wager nets back out with no special case.

- [ ] **Step 4: Wire it into the reconcile cron**

Replace `src/app/api/cron/reconcile/route.ts` entirely:

```ts
import { authorizeCronRequest, jsonSafe } from '@/server/cron/auth';
import { reconcileBalances, reconcileEscrow } from '@/server/money/reconcile';

/**
 * Daily. Asserts every cached balance still equals the sum of its ledger entries, and that
 * every wager's pot holds exactly what its status says it should (D43).
 *
 * A discrepancy in either returns 500 on purpose: this is the alarm that says money drifted,
 * and it should be impossible to miss in the cron logs.
 */
export async function GET(request: Request): Promise<Response> {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  const discrepancies = await reconcileBalances();
  const escrowDiscrepancies = await reconcileEscrow();

  const ok = discrepancies.length === 0 && escrowDiscrepancies.length === 0;

  return Response.json(jsonSafe({ ok, discrepancies, escrowDiscrepancies }), {
    status: ok ? 200 : 500,
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/server/money/__tests__/reconcile-escrow.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Verify and commit**

```bash
npm run verify
git add -A
git commit -m "feat: reconcile escrow, which balance reconciliation cannot see"
```

---

### Task 14: Reads — the board, the detail, and head-to-head

**Files:**

- Create: `src/server/p2p/query.ts`
- Test: `src/server/p2p/__tests__/query.test.ts`

**Interfaces:**

- Consumes: `computeHeadToHead`, `agreedVerdict`, `isDisputed`, `isOverdue` (Task 3), `renderSubject` / `loadSelectionSubject` (Task 5).
- Produces:
  - `loadWagerBoard(membershipId: string, seasonId: string, now?: Date): Promise<WagerBoard>`
  - `loadWagerDetail(wagerId: string, viewerMembershipId: string, now?: Date): Promise<WagerDetail | null>`
  - `loadHeadToHead(seasonId: string, memberA: string, memberB: string): Promise<HeadToHead>`
  - `loadArbitrationQueue(seasonId: string, now?: Date): Promise<WagerSummary[]>`
  - `WagerSummary`, `WagerBoard`, `WagerDetail`, `ViewerActions`

All money crosses into these results as `bigint` and is converted to strings only at the server-action boundary, per the global constraint. `ViewerActions` is computed server-side and is what the pages render from — the UI must never decide for itself who may act.

- [ ] **Step 1: Write the failing test**

Create `src/server/p2p/__tests__/query.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { acceptWager } from '@/server/p2p/accept';
import { claimWinner } from '@/server/p2p/claim';
import { offerWager } from '@/server/p2p/offer';
import {
  loadArbitrationQueue,
  loadHeadToHead,
  loadWagerBoard,
  loadWagerDetail,
} from '@/server/p2p/query';
import { resetDb } from '@/test/db';
import { makeCreditedMembership } from '@/test/factories';

async function offerOnly(actorUserId: string, over: Record<string, unknown> = {}) {
  const result = await offerWager({
    actorUserId,
    kind: 'FREEFORM',
    offererStakeCents: 50_000n,
    acceptorStakeCents: 20_000n,
    description: 'a test wager',
    expiresAt: new Date(Date.now() + 3_600_000),
    resolvesBy: new Date(Date.now() + 7 * 86_400_000),
    ...over,
  });
  if (!result.ok) throw new Error(`offer failed: ${JSON.stringify(result)}`);
  return result.wagerId;
}

describe('loadWagerBoard', () => {
  beforeEach(resetDb);

  it('separates open offers from your own', async () => {
    const a = await makeCreditedMembership(100_000n);
    const b = await makeCreditedMembership(100_000n, a.seasonId);
    await offerOnly(a.user.id);

    const forB = await loadWagerBoard(b.membership.id, a.seasonId);
    expect(forB.openOffers).toHaveLength(1);
    expect(forB.yourOffers).toHaveLength(0);

    const forA = await loadWagerBoard(a.membership.id, a.seasonId);
    // Your own open offer is yours to withdraw, not yours to accept.
    expect(forA.openOffers).toHaveLength(0);
    expect(forA.yourOffers).toHaveLength(1);
  });

  it('puts a directed offer in the recipient’s inbox and nobody else’s', async () => {
    const a = await makeCreditedMembership(100_000n);
    const b = await makeCreditedMembership(100_000n, a.seasonId);
    const c = await makeCreditedMembership(100_000n, a.seasonId);
    await offerOnly(a.user.id, { opponentMembershipId: b.membership.id });

    const forB = await loadWagerBoard(b.membership.id, a.seasonId);
    expect(forB.offersToYou).toHaveLength(1);
    expect(forB.openOffers).toHaveLength(0);

    const forC = await loadWagerBoard(c.membership.id, a.seasonId);
    expect(forC.offersToYou).toHaveLength(0);
    expect(forC.openOffers).toHaveLength(0);
  });

  it('lists a live wager for both parties and flags whose claim is missing', async () => {
    const a = await makeCreditedMembership(100_000n);
    const b = await makeCreditedMembership(100_000n, a.seasonId);
    const wagerId = await offerOnly(a.user.id);
    await acceptWager({ wagerId, actorUserId: b.user.id });

    const forA = await loadWagerBoard(a.membership.id, a.seasonId);
    expect(forA.liveWagers).toHaveLength(1);
    expect(forA.awaitingYourClaim).toHaveLength(1);

    await claimWinner({ wagerId, actorUserId: a.user.id, verdict: 'OFFERER' });

    const afterA = await loadWagerBoard(a.membership.id, a.seasonId);
    expect(afterA.awaitingYourClaim).toHaveLength(0);

    const forB = await loadWagerBoard(b.membership.id, a.seasonId);
    expect(forB.awaitingYourClaim).toHaveLength(1);
  });

  it('drops a settled wager out of the live list', async () => {
    const a = await makeCreditedMembership(100_000n);
    const b = await makeCreditedMembership(100_000n, a.seasonId);
    const wagerId = await offerOnly(a.user.id);
    await acceptWager({ wagerId, actorUserId: b.user.id });
    await claimWinner({ wagerId, actorUserId: a.user.id, verdict: 'OFFERER' });
    await claimWinner({ wagerId, actorUserId: b.user.id, verdict: 'OFFERER' });

    const board = await loadWagerBoard(a.membership.id, a.seasonId);
    expect(board.liveWagers).toHaveLength(0);
    expect(board.settledWagers).toHaveLength(1);
  });
});

describe('loadWagerDetail', () => {
  beforeEach(resetDb);

  it('offers accept and decline to the invited opponent only', async () => {
    const a = await makeCreditedMembership(100_000n);
    const b = await makeCreditedMembership(100_000n, a.seasonId);
    const c = await makeCreditedMembership(100_000n, a.seasonId);
    const wagerId = await offerOnly(a.user.id, { opponentMembershipId: b.membership.id });

    const forB = await loadWagerDetail(wagerId, b.membership.id);
    expect(forB!.actions).toMatchObject({ canAccept: true, canDecline: true, canCancel: false });

    const forC = await loadWagerDetail(wagerId, c.membership.id);
    expect(forC!.actions).toMatchObject({ canAccept: false, canDecline: false });

    const forA = await loadWagerDetail(wagerId, a.membership.id);
    expect(forA!.actions).toMatchObject({ canAccept: false, canCancel: true });
  });

  it('offers accept to anyone else on an open offer', async () => {
    const a = await makeCreditedMembership(100_000n);
    const c = await makeCreditedMembership(100_000n, a.seasonId);
    const wagerId = await offerOnly(a.user.id);

    const forC = await loadWagerDetail(wagerId, c.membership.id);
    expect(forC!.actions).toMatchObject({ canAccept: true, canDecline: false });
  });

  it('offers claim and propose-cancel to both parties once accepted', async () => {
    const a = await makeCreditedMembership(100_000n);
    const b = await makeCreditedMembership(100_000n, a.seasonId);
    const c = await makeCreditedMembership(100_000n, a.seasonId);
    const wagerId = await offerOnly(a.user.id);
    await acceptWager({ wagerId, actorUserId: b.user.id });

    for (const party of [a, b]) {
      const detail = await loadWagerDetail(wagerId, party.membership.id);
      expect(detail!.actions).toMatchObject({ canClaim: true, canProposeCancel: true });
    }

    const forC = await loadWagerDetail(wagerId, c.membership.id);
    expect(forC!.actions).toMatchObject({ canClaim: false, canProposeCancel: false });
  });

  it('reports a dispute as derived state', async () => {
    const a = await makeCreditedMembership(100_000n);
    const b = await makeCreditedMembership(100_000n, a.seasonId);
    const wagerId = await offerOnly(a.user.id);
    await acceptWager({ wagerId, actorUserId: b.user.id });
    await claimWinner({ wagerId, actorUserId: a.user.id, verdict: 'OFFERER' });
    await claimWinner({ wagerId, actorUserId: b.user.id, verdict: 'ACCEPTOR' });

    const detail = await loadWagerDetail(wagerId, a.membership.id);
    expect(detail!.disputed).toBe(true);
    expect(detail!.status).toBe('ACCEPTED');
    // A dispute does not take away either party's ability to concede.
    expect(detail!.actions.canClaim).toBe(true);
  });

  it('returns null for a wager that does not exist', async () => {
    const a = await makeCreditedMembership(100_000n);
    expect(
      await loadWagerDetail('00000000-0000-4000-8000-000000000000', a.membership.id),
    ).toBeNull();
  });
});

describe('loadHeadToHead', () => {
  beforeEach(resetDb);

  it('scores the record between two members', async () => {
    const a = await makeCreditedMembership(300_000n);
    const b = await makeCreditedMembership(300_000n, a.seasonId);

    for (const verdict of ['OFFERER', 'OFFERER', 'ACCEPTOR'] as const) {
      const wagerId = await offerOnly(a.user.id);
      await acceptWager({ wagerId, actorUserId: b.user.id });
      await claimWinner({ wagerId, actorUserId: a.user.id, verdict });
      await claimWinner({ wagerId, actorUserId: b.user.id, verdict });
    }

    const h2h = await loadHeadToHead(a.seasonId, a.membership.id, b.membership.id);
    // A won twice at +20,000 each and lost once at -50,000.
    expect(h2h).toEqual({ settled: 3, aWon: 2, bWon: 1, voided: 0, netCentsForA: -10_000n });

    const mirrored = await loadHeadToHead(a.seasonId, b.membership.id, a.membership.id);
    expect(mirrored.netCentsForA).toBe(10_000n);
  });

  it('is all zeroes between members who have never wagered', async () => {
    const a = await makeCreditedMembership(100_000n);
    const b = await makeCreditedMembership(100_000n, a.seasonId);

    expect(await loadHeadToHead(a.seasonId, a.membership.id, b.membership.id)).toEqual({
      settled: 0,
      aWon: 0,
      bWon: 0,
      voided: 0,
      netCentsForA: 0n,
    });
  });
});

describe('loadArbitrationQueue', () => {
  beforeEach(resetDb);

  it('lists disputed and overdue wagers, and nothing healthy', async () => {
    const a = await makeCreditedMembership(300_000n);
    const b = await makeCreditedMembership(300_000n, a.seasonId);

    // Disputed.
    const disputedId = await offerOnly(a.user.id);
    await acceptWager({ wagerId: disputedId, actorUserId: b.user.id });
    await claimWinner({ wagerId: disputedId, actorUserId: a.user.id, verdict: 'OFFERER' });
    await claimWinner({ wagerId: disputedId, actorUserId: b.user.id, verdict: 'ACCEPTOR' });

    // Overdue: accepted, resolve-by has passed, nobody has claimed.
    const overdueId = await offerOnly(a.user.id, {
      resolvesBy: new Date(Date.now() + 86_400_000),
    });
    await acceptWager({ wagerId: overdueId, actorUserId: b.user.id });

    // Healthy: accepted, in date, no claims.
    const healthyId = await offerOnly(a.user.id);
    await acceptWager({ wagerId: healthyId, actorUserId: b.user.id });

    const queue = await loadArbitrationQueue(a.seasonId, new Date(Date.now() + 2 * 86_400_000));
    const ids = queue.map((w) => w.id).sort();
    expect(ids).toEqual([disputedId, overdueId].sort());
    expect(ids).not.toContain(healthyId);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/p2p/__tests__/query.test.ts`
Expected: FAIL — cannot resolve `@/server/p2p/query`.

- [ ] **Step 3: Write the reads**

Create `src/server/p2p/query.ts`:

```ts
import { and, desc, eq, inArray, or, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '@/db/client';
import { p2pWagers, seasonMemberships, users } from '@/db/schema';
import type { P2PVerdict, P2PWagerKind, P2PWagerStatus } from '@/db/schema';
import {
  agreedVerdict,
  computeHeadToHead,
  isDisputed,
  isOverdue,
  potCents,
  type HeadToHead,
} from '@/domain/p2p';
import { loadSelectionSubject } from './subject';

const offererUsers = alias(users, 'p2p_offerer_users');
const acceptorUsers = alias(users, 'p2p_acceptor_users');
const offererMemberships = alias(seasonMemberships, 'p2p_offerer_memberships');
const acceptorMemberships = alias(seasonMemberships, 'p2p_acceptor_memberships');

export interface WagerSummary {
  id: string;
  kind: P2PWagerKind;
  status: P2PWagerStatus;
  subject: string;
  offererMembershipId: string;
  offererDisplayName: string;
  acceptorMembershipId: string | null;
  acceptorDisplayName: string | null;
  opponentMembershipId: string | null;
  offererStakeCents: bigint;
  acceptorStakeCents: bigint;
  potCents: bigint;
  verdict: P2PVerdict | null;
  offererClaim: P2PVerdict | null;
  acceptorClaim: P2PVerdict | null;
  disputed: boolean;
  overdue: boolean;
  expiresAt: Date;
  resolvesBy: Date;
  createdAt: Date;
}

export interface WagerBoard {
  /** Open to the season and takeable by the viewer. */
  openOffers: WagerSummary[];
  /** Directed at the viewer. */
  offersToYou: WagerSummary[];
  /** The viewer's own offers, still unaccepted. */
  yourOffers: WagerSummary[];
  /** Accepted and not yet decided, with the viewer as a party. */
  liveWagers: WagerSummary[];
  /** Live wagers where the viewer has not yet said who won. */
  awaitingYourClaim: WagerSummary[];
  /** Finished, with the viewer as a party. */
  settledWagers: WagerSummary[];
}

/** What this viewer is allowed to do. Computed server-side; the UI only renders it. */
export interface ViewerActions {
  canAccept: boolean;
  canDecline: boolean;
  canCancel: boolean;
  canClaim: boolean;
  canProposeCancel: boolean;
}

export interface WagerDetail extends WagerSummary {
  description: string | null;
  lineAtOffer: string | null;
  selectionId: string | null;
  resolutionNote: string | null;
  settlementAttempts: number;
  offererCancelProposed: boolean;
  acceptorCancelProposed: boolean;
  settledAt: Date | null;
  actions: ViewerActions;
}

/**
 * Every wager read goes through this shape, so the subject line and the derived
 * dispute/overdue flags are computed in exactly one place.
 *
 * The two `users` joins are aliased because both sides of a wager are members, and joining
 * the same table twice unaliased silently collapses them into one.
 */
async function loadSummaries(where: SQL | undefined, now: Date): Promise<WagerSummary[]> {
  const rows = await db
    .select({
      wager: p2pWagers,
      offererDisplayName: offererUsers.displayName,
      acceptorDisplayName: acceptorUsers.displayName,
    })
    .from(p2pWagers)
    .innerJoin(offererMemberships, eq(p2pWagers.offererMembershipId, offererMemberships.id))
    .innerJoin(offererUsers, eq(offererMemberships.userId, offererUsers.id))
    .leftJoin(acceptorMemberships, eq(p2pWagers.acceptorMembershipId, acceptorMemberships.id))
    .leftJoin(acceptorUsers, eq(acceptorMemberships.userId, acceptorUsers.id))
    .where(where)
    .orderBy(desc(p2pWagers.createdAt));

  // Subjects for market-backed wagers need a second read each. The board is a handful of
  // rows in a private league, so a per-row lookup is the right trade against a fourth join.
  return Promise.all(
    rows.map(async ({ wager, offererDisplayName, acceptorDisplayName }) => {
      const subject =
        wager.kind === 'FREEFORM'
          ? (wager.description ?? '')
          : ((await loadSelectionSubject(wager.selectionId!))?.subject ?? '');

      return {
        id: wager.id,
        kind: wager.kind,
        status: wager.status,
        subject,
        offererMembershipId: wager.offererMembershipId,
        offererDisplayName,
        acceptorMembershipId: wager.acceptorMembershipId,
        acceptorDisplayName,
        opponentMembershipId: wager.opponentMembershipId,
        offererStakeCents: wager.offererStakeCents,
        acceptorStakeCents: wager.acceptorStakeCents,
        potCents: potCents(wager.offererStakeCents, wager.acceptorStakeCents),
        verdict: wager.verdict,
        offererClaim: wager.offererClaim,
        acceptorClaim: wager.acceptorClaim,
        disputed: wager.status === 'ACCEPTED' && isDisputed(wager),
        overdue: wager.status === 'ACCEPTED' && isOverdue(wager, now),
        expiresAt: wager.expiresAt,
        resolvesBy: wager.resolvesBy,
        createdAt: wager.createdAt,
      };
    }),
  );
}

export async function loadWagerBoard(
  membershipId: string,
  seasonId: string,
  now: Date = new Date(),
): Promise<WagerBoard> {
  const all = await loadSummaries(eq(p2pWagers.seasonId, seasonId), now);

  const isParty = (w: WagerSummary) =>
    w.offererMembershipId === membershipId || w.acceptorMembershipId === membershipId;

  const live = all.filter((w) => w.status === 'ACCEPTED' && isParty(w));

  return {
    openOffers: all.filter(
      (w) =>
        w.status === 'OFFERED' &&
        w.opponentMembershipId === null &&
        w.offererMembershipId !== membershipId &&
        w.expiresAt.getTime() > now.getTime(),
    ),
    offersToYou: all.filter(
      (w) =>
        w.status === 'OFFERED' &&
        w.opponentMembershipId === membershipId &&
        w.expiresAt.getTime() > now.getTime(),
    ),
    yourOffers: all.filter((w) => w.status === 'OFFERED' && w.offererMembershipId === membershipId),
    liveWagers: live,
    awaitingYourClaim: live.filter((w) =>
      w.offererMembershipId === membershipId ? w.offererClaim === null : w.acceptorClaim === null,
    ),
    settledWagers: all.filter(
      (w) => (w.status === 'SETTLED' || w.status === 'VOIDED') && isParty(w),
    ),
  };
}

export async function loadWagerDetail(
  wagerId: string,
  viewerMembershipId: string,
  now: Date = new Date(),
): Promise<WagerDetail | null> {
  const [summary] = await loadSummaries(eq(p2pWagers.id, wagerId), now);
  if (!summary) return null;

  const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));

  const isOfferer = summary.offererMembershipId === viewerMembershipId;
  const isAcceptor = summary.acceptorMembershipId === viewerMembershipId;
  const open = summary.status === 'OFFERED' && summary.expiresAt.getTime() > now.getTime();
  const invited =
    summary.opponentMembershipId === null || summary.opponentMembershipId === viewerMembershipId;

  const actions: ViewerActions = {
    canAccept: open && !isOfferer && invited,
    // Only a directed offer can be declined — nobody has standing to refuse an open one.
    canDecline: open && !isOfferer && summary.opponentMembershipId === viewerMembershipId,
    canCancel: open && isOfferer,
    // A dispute does not take away either party's ability to concede.
    canClaim: summary.status === 'ACCEPTED' && (isOfferer || isAcceptor),
    canProposeCancel: summary.status === 'ACCEPTED' && (isOfferer || isAcceptor),
  };

  return {
    ...summary,
    description: wager.description,
    lineAtOffer: wager.lineAtOffer,
    selectionId: wager.selectionId,
    resolutionNote: wager.resolutionNote,
    settlementAttempts: wager.settlementAttempts,
    offererCancelProposed: wager.offererCancelProposed,
    acceptorCancelProposed: wager.acceptorCancelProposed,
    settledAt: wager.settledAt,
    actions,
  };
}

/**
 * The head-to-head record between two members (D48).
 *
 * Derived from the rows at read time with no stored counter, so it can never disagree with
 * the wagers it summarizes. The aggregation itself is the pure `computeHeadToHead`; this
 * function's only job is fetching the rows it operates on.
 */
export async function loadHeadToHead(
  seasonId: string,
  memberA: string,
  memberB: string,
): Promise<HeadToHead> {
  const rows = await db
    .select({
      offererMembershipId: p2pWagers.offererMembershipId,
      acceptorMembershipId: p2pWagers.acceptorMembershipId,
      status: p2pWagers.status,
      verdict: p2pWagers.verdict,
      offererStakeCents: p2pWagers.offererStakeCents,
      acceptorStakeCents: p2pWagers.acceptorStakeCents,
    })
    .from(p2pWagers)
    .where(
      and(
        eq(p2pWagers.seasonId, seasonId),
        inArray(p2pWagers.status, ['SETTLED', 'VOIDED']),
        or(
          and(
            eq(p2pWagers.offererMembershipId, memberA),
            eq(p2pWagers.acceptorMembershipId, memberB),
          ),
          and(
            eq(p2pWagers.offererMembershipId, memberB),
            eq(p2pWagers.acceptorMembershipId, memberA),
          ),
        ),
      ),
    );

  return computeHeadToHead(rows, memberA, memberB);
}

/**
 * What an admin has to rule on: wagers where the two parties have not agreed and cannot be
 * left to sort it out.
 *
 * Both conditions are derived from the claim columns and the clock rather than read from a
 * status (D44), so a wager leaves this queue the moment one party concedes — no job has to
 * remember to take it out.
 */
export async function loadArbitrationQueue(
  seasonId: string,
  now: Date = new Date(),
): Promise<WagerSummary[]> {
  const accepted = await loadSummaries(
    and(eq(p2pWagers.seasonId, seasonId), eq(p2pWagers.status, 'ACCEPTED')),
    now,
  );

  return accepted.filter(
    (w) =>
      w.disputed ||
      (w.overdue &&
        agreedVerdict({ offererClaim: w.offererClaim, acceptorClaim: w.acceptorClaim }) === null),
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/server/p2p/__tests__/query.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Verify and commit**

```bash
npm run verify
git add -A
git commit -m "feat: read the wager board, detail, arbitration queue and head-to-head"
```

---

### Task 15: The wagers board and its route into the app

**Files:**

- Create: `src/app/(app)/wagers/page.tsx`, `src/app/(app)/wagers/actions.ts`
- Modify: `src/app/(app)/bets/page.tsx`, `src/components/ui/tab-bar.tsx`
- Test: `npm run build` (see below)

**Interfaces:**

- Consumes: `loadWagerBoard` (Task 14), and every service from Tasks 5–10.
- Produces: the six server actions the later screens call — `offerWagerAction`, `acceptWagerAction`, `declineWagerAction`, `cancelOfferAction`, `claimWinnerAction`, `proposeCancelAction`.

**No seventh bottom tab.** `tab-bar.tsx` already documents the fallback for exactly this moment — a segmented control rather than another tab — so `/bets` gains a **Bets | Wagers** toggle and `/wagers` is reached from there.

**Read `node_modules/next/dist/docs/` before writing this.** Confirm how server actions are declared and how `searchParams` is typed and awaited in this version. Do not assume your training data is current — see `AGENTS.md`.

**Browser verification is local-only.** Sign-in is Google OAuth with no dev bypass ([D20](../decisions.md#d20--auth-google-only-apple-dropped)), so you cannot get past `/sign-in` in this environment. The substitute gate that does work here is `npm run build`, which compiles every route for real and catches server/client boundary mistakes — the actual risk in this task.

- [ ] **Step 1: Write the server actions**

Create `src/app/(app)/wagers/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { requireApprovedMemberOrThrow } from '@/server/auth/session';
import { acceptWager } from '@/server/p2p/accept';
import { claimWinner, proposeCancel } from '@/server/p2p/claim';
import { cancelOffer, declineWager, offerWager } from '@/server/p2p/offer';
import type { P2PVerdict, P2PWagerKind } from '@/server/p2p/types';

/**
 * Every action re-authorizes server-side. The board computes what a viewer may do, but that
 * is for rendering only — authorization is never by hidden UI.
 *
 * Cents cross this boundary as decimal strings: `bigint` is not serializable through a
 * server action, exactly as in `src/app/(app)/bets/actions.ts`.
 */
export async function offerWagerAction(input: {
  kind: P2PWagerKind;
  opponentMembershipId?: string | null;
  offererStakeCents: string;
  acceptorStakeCents: string;
  selectionId?: string;
  description?: string;
  expiresAt: string;
  resolvesBy: string;
}) {
  const member = await requireApprovedMemberOrThrow();

  const result = await offerWager({
    actorUserId: member.userId,
    kind: input.kind,
    opponentMembershipId: input.opponentMembershipId ?? null,
    offererStakeCents: BigInt(input.offererStakeCents),
    acceptorStakeCents: BigInt(input.acceptorStakeCents),
    selectionId: input.selectionId,
    description: input.description,
    expiresAt: new Date(input.expiresAt),
    resolvesBy: new Date(input.resolvesBy),
  });

  revalidatePath('/wagers');
  revalidatePath('/feed');

  return result.ok
    ? { ok: true as const, wagerId: result.wagerId }
    : { ok: false as const, error: result.error };
}

export async function acceptWagerAction(wagerId: string) {
  const member = await requireApprovedMemberOrThrow();
  const result = await acceptWager({ wagerId, actorUserId: member.userId });

  revalidatePath('/wagers');
  revalidatePath(`/wagers/${wagerId}`);
  revalidatePath('/feed');

  return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
}

export async function declineWagerAction(wagerId: string) {
  const member = await requireApprovedMemberOrThrow();
  const result = await declineWager({ wagerId, actorUserId: member.userId });

  revalidatePath('/wagers');
  revalidatePath(`/wagers/${wagerId}`);

  return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
}

export async function cancelOfferAction(wagerId: string) {
  const member = await requireApprovedMemberOrThrow();
  const result = await cancelOffer({ wagerId, actorUserId: member.userId });

  revalidatePath('/wagers');
  revalidatePath(`/wagers/${wagerId}`);

  return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
}

export async function claimWinnerAction(wagerId: string, verdict: P2PVerdict) {
  const member = await requireApprovedMemberOrThrow();
  const result = await claimWinner({ wagerId, actorUserId: member.userId, verdict });

  revalidatePath('/wagers');
  revalidatePath(`/wagers/${wagerId}`);
  revalidatePath('/feed');

  return result.ok
    ? { ok: true as const, outcome: result.outcome }
    : { ok: false as const, error: result.error };
}

export async function proposeCancelAction(wagerId: string) {
  const member = await requireApprovedMemberOrThrow();
  const result = await proposeCancel({ wagerId, actorUserId: member.userId });

  revalidatePath('/wagers');
  revalidatePath(`/wagers/${wagerId}`);
  revalidatePath('/feed');

  return result.ok
    ? { ok: true as const, outcome: result.outcome }
    : { ok: false as const, error: result.error };
}
```

**Check `requireApprovedMemberOrThrow`'s return shape before writing this.** It returns an `ApprovedMember`; confirm whether the user id field is `userId` or nested, by reading `src/server/auth/identity.ts`, and use whichever name is actually there. The same applies to `membershipId`, used in the next step.

- [ ] **Step 2: Write the board page**

Create `src/app/(app)/wagers/page.tsx`:

```tsx
import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
import { Money } from '@/components/ui/money';
import { requireApprovedMember } from '@/server/auth/session';
import { loadWagerBoard, type WagerSummary } from '@/server/p2p/query';

function WagerRow({ wager }: { wager: WagerSummary }) {
  const parties = wager.acceptorDisplayName
    ? `${wager.offererDisplayName} vs ${wager.acceptorDisplayName}`
    : `${wager.offererDisplayName} — open`;

  return (
    <Link
      href={`/wagers/${wager.id}`}
      className="flex flex-col gap-1 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{wager.subject}</span>
        <Money cents={wager.potCents} currency="CREDITS" />
      </div>
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <span>{parties}</span>
        {wager.disputed && <span className="font-medium text-amber-600">disputed</span>}
        {wager.overdue && <span className="font-medium text-amber-600">overdue</span>}
      </div>
      <div className="text-xs text-zinc-400">
        {wager.offererStakeCents.toString()} against {wager.acceptorStakeCents.toString()} credits
      </div>
    </Link>
  );
}

function Section({ title, wagers }: { title: string; wagers: WagerSummary[] }) {
  if (wagers.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
      {wagers.map((w) => (
        <WagerRow key={w.id} wager={w} />
      ))}
    </section>
  );
}

export default async function WagersPage() {
  const member = await requireApprovedMember();
  const board = await loadWagerBoard(member.membershipId, member.seasonId);

  const empty =
    board.openOffers.length === 0 &&
    board.offersToYou.length === 0 &&
    board.yourOffers.length === 0 &&
    board.liveWagers.length === 0 &&
    board.settledWagers.length === 0;

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <div className="flex gap-2 px-1">
        <Link
          href="/bets"
          className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
        >
          Bets
        </Link>
        <span className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
          Wagers
        </span>
      </div>

      <Link
        href="/wagers/new"
        className="rounded-lg bg-zinc-900 px-4 py-2 text-center text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
      >
        Offer a wager
      </Link>

      {empty ? (
        <EmptyState title="No wagers yet" body="Offer one and see who takes the other side." />
      ) : (
        <>
          <Section title="Awaiting your call" wagers={board.awaitingYourClaim} />
          <Section title="Challenges to you" wagers={board.offersToYou} />
          <Section title="Open to the season" wagers={board.openOffers} />
          <Section title="Your open offers" wagers={board.yourOffers} />
          <Section title="Live" wagers={board.liveWagers} />
          <Section title="Finished" wagers={board.settledWagers} />
        </>
      )}
    </div>
  );
}
```

**Check `src/components/ui/money.tsx`'s props before using `<Money>`.** If it does not take a `currency` prop, either render the cents directly or extend the component — do not invent an API it does not have.

**Check `requireApprovedMember`'s return shape** for `membershipId` and `seasonId`, in `src/server/auth/identity.ts`, and use the names that are actually there.

- [ ] **Step 3: Add the segmented control to `/bets`**

In `src/app/(app)/bets/page.tsx`, the existing `filterLinks` block renders the Cash/Credits filter. Add a Bets | Wagers control above it. Insert this directly before the `const filterLinks = (` line:

```tsx
const sectionLinks = (
  <div className="flex gap-2 px-1">
    <span className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
      Bets
    </span>
    <Link
      href="/wagers"
      className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
    >
      Wagers
    </Link>
  </div>
);
```

Then render `{sectionLinks}` immediately above `{filterLinks}` in **both** return branches — the empty-state one and the main one. `Link` is already imported in this file.

- [ ] **Step 4: Record why there is no seventh tab**

In `src/components/ui/tab-bar.tsx`, do **not** change the `TABS` array. Update the doc comment so the decision is written down where the next person will look:

```tsx
/**
 * The six-tab bottom bar. Games is still the default landing route (D8); Events sits right
 * next to it since custom events are a first-class currency, not a buried feature.
 *
 * Peer-to-peer wagers deliberately did not become a seventh tab. This comment previously
 * named a segmented control as the fallback if six ever read as crowded, and subsystem 4
 * took it: `/wagers` is reached from a Bets | Wagers control on `/bets`, which is also where
 * a member would look for them.
 */
```

- [ ] **Step 5: Verify the routes compile**

Run: `npm run build`
Expected: a successful build listing `/wagers` among the compiled routes, with no server/client boundary errors.

Then run the full gate:

Run: `npm run verify`
Expected: PASS, with no new lint errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add the wagers board and reach it from My Bets"
```

---

### Task 16: Offering a wager from the UI

**Files:**

- Create: `src/app/(app)/wagers/new/page.tsx`, `src/app/(app)/wagers/new/wager-form.tsx`
- Test: `npm run build`

**Interfaces:**

- Consumes: `offerWagerAction` (Task 15), `loadWagerBoard`'s season membership list.
- Produces: the create screen. No new server interfaces.

The form needs the season's other members (for the opponent picker) and, for a market-backed wager, a selection to point at. Keep the selection input a plain id field in this pass — a full board picker is UI polish, and the project owner deferred that. The _services_ must be fully exercisable, which a text field does.

- [ ] **Step 1: Write the client form**

Create `src/app/(app)/wagers/new/wager-form.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { offerWagerAction } from '../actions';

export interface MemberOption {
  membershipId: string;
  displayName: string;
}

/** Cents in, cents out — the form speaks the same integer language the ledger does (D17). */
function toCents(input: string): string {
  const trimmed = input.trim();
  if (!/^\d+$/.test(trimmed)) return '';
  return trimmed;
}

export function WagerForm({ members }: { members: MemberOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<'FREEFORM' | 'MARKET'>('FREEFORM');
  const [opponent, setOpponent] = useState('');
  const [offererStake, setOffererStake] = useState('');
  const [acceptorStake, setAcceptorStake] = useState('');
  const [description, setDescription] = useState('');
  const [selectionId, setSelectionId] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [resolvesBy, setResolvesBy] = useState('');

  function submit() {
    setError(null);

    const offererCents = toCents(offererStake);
    const acceptorCents = toCents(acceptorStake);
    if (!offererCents || !acceptorCents) {
      setError('Both stakes must be whole numbers of credits.');
      return;
    }
    if (!expiresAt || !resolvesBy) {
      setError('An offer needs an expiry and a resolve-by date.');
      return;
    }

    startTransition(async () => {
      const result = await offerWagerAction({
        kind,
        opponentMembershipId: opponent || null,
        offererStakeCents: offererCents,
        acceptorStakeCents: acceptorCents,
        selectionId: kind === 'MARKET' ? selectionId.trim() : undefined,
        description: kind === 'FREEFORM' ? description : undefined,
        expiresAt: new Date(expiresAt).toISOString(),
        resolvesBy: new Date(resolvesBy).toISOString(),
      });

      if (result.ok) {
        router.push(`/wagers/${result.wagerId}`);
        return;
      }
      setError(describe(result.error));
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        {(['FREEFORM', 'MARKET'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              kind === k
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
            }`}
          >
            {k === 'FREEFORM' ? 'Anything' : 'A game or event'}
          </button>
        ))}
      </div>

      {kind === 'FREEFORM' ? (
        <label className="flex flex-col gap-1 text-sm">
          What is the bet?
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="rounded-lg border border-zinc-300 p-2 dark:border-zinc-700 dark:bg-zinc-900"
            placeholder="Jake cannot name ten starting quarterbacks"
          />
        </label>
      ) : (
        <label className="flex flex-col gap-1 text-sm">
          Selection id
          <input
            value={selectionId}
            onChange={(e) => setSelectionId(e.target.value)}
            className="rounded-lg border border-zinc-300 p-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
            placeholder="the selection you are taking"
          />
        </label>
      )}

      <label className="flex flex-col gap-1 text-sm">
        Who?
        <select
          value={opponent}
          onChange={(e) => setOpponent(e.target.value)}
          className="rounded-lg border border-zinc-300 p-2 dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="">Open to the season</option>
          {members.map((m) => (
            <option key={m.membershipId} value={m.membershipId}>
              {m.displayName}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-sm">
          You put up
          <input
            value={offererStake}
            onChange={(e) => setOffererStake(e.target.value)}
            inputMode="numeric"
            className="rounded-lg border border-zinc-300 p-2 dark:border-zinc-700 dark:bg-zinc-900"
            placeholder="credits"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          They put up
          <input
            value={acceptorStake}
            onChange={(e) => setAcceptorStake(e.target.value)}
            inputMode="numeric"
            className="rounded-lg border border-zinc-300 p-2 dark:border-zinc-700 dark:bg-zinc-900"
            placeholder="credits"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-sm">
          Offer expires
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="rounded-lg border border-zinc-300 p-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Settled by
          <input
            type="datetime-local"
            value={resolvesBy}
            onChange={(e) => setResolvesBy(e.target.value)}
            className="rounded-lg border border-zinc-300 p-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
      </div>

      <p className="text-xs text-zinc-500">
        Your stake is held the moment you post this. Withdraw it any time before someone accepts and
        it comes straight back.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {pending ? 'Posting…' : 'Post the offer'}
      </button>
    </div>
  );
}

function describe(error: { code: string } & Record<string, unknown>): string {
  switch (error.code) {
    case 'INSUFFICIENT_CREDITS':
      return `You only have ${String(error.availableCents)} credits.`;
    case 'INVALID_STAKE':
      return 'Both stakes must be more than zero.';
    case 'INVALID_WINDOW':
      return 'The offer must expire in the future, before the event, and before the settle-by date.';
    case 'OPPONENT_IS_SELF':
      return 'You cannot challenge yourself.';
    case 'OPPONENT_NOT_IN_SEASON':
      return 'That member is not in this season.';
    case 'WRONG_KIND_FIELDS':
      return 'Fill in the description, or the selection — whichever this wager is.';
    case 'SELECTION_NOT_FOUND':
      return 'No selection with that id.';
    case 'MARKET_NOT_OPEN':
      return 'That market is not taking action right now.';
    case 'EVENT_ALREADY_STARTED':
      return 'That event has already started.';
    default:
      return 'Could not post the offer.';
  }
}
```

- [ ] **Step 2: Write the page**

Create `src/app/(app)/wagers/new/page.tsx`:

```tsx
import { and, eq, ne } from 'drizzle-orm';
import { db } from '@/db/client';
import { seasonMemberships, users } from '@/db/schema';
import { requireApprovedMember } from '@/server/auth/session';
import { WagerForm, type MemberOption } from './wager-form';

export default async function NewWagerPage() {
  const member = await requireApprovedMember();

  const rows = await db
    .select({ membershipId: seasonMemberships.id, displayName: users.displayName })
    .from(seasonMemberships)
    .innerJoin(users, eq(seasonMemberships.userId, users.id))
    .where(
      and(
        eq(seasonMemberships.seasonId, member.seasonId),
        ne(seasonMemberships.id, member.membershipId),
      ),
    );

  const members: MemberOption[] = rows.map((r) => ({
    membershipId: r.membershipId,
    displayName: r.displayName,
  }));

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <h1 className="text-lg font-semibold">Offer a wager</h1>
      <WagerForm members={members} />
    </div>
  );
}
```

- [ ] **Step 3: Verify the routes compile**

Run: `npm run build`
Expected: a successful build listing `/wagers/new`.

Run: `npm run verify`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add the offer-a-wager screen"
```

---

### Task 17: The wager detail screen

**Files:**

- Create: `src/app/(app)/wagers/[wagerId]/page.tsx`, `src/app/(app)/wagers/[wagerId]/wager-actions.tsx`
- Test: `npm run build`

**Interfaces:**

- Consumes: `loadWagerDetail` (Task 14), the six actions from Task 15.
- Produces: the detail screen. No new server interfaces.

Every button rendered here is gated on the server-computed `ViewerActions`, and every action re-authorizes on the server. The UI is a rendering of permission, never the source of it.

**Confirm how `params` is typed and awaited in a dynamic route in this Next.js version** before writing the page — read `node_modules/next/dist/docs/`. The existing dynamic routes under `src/app/(app)/events/[eventId]/` are the reference in this codebase.

- [ ] **Step 1: Write the client actions component**

Create `src/app/(app)/wagers/[wagerId]/wager-actions.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  acceptWagerAction,
  cancelOfferAction,
  claimWinnerAction,
  declineWagerAction,
  proposeCancelAction,
} from '../actions';
import type { ViewerActions } from '@/server/p2p/query';

export interface WagerActionsProps {
  wagerId: string;
  actions: ViewerActions;
  offererDisplayName: string;
  acceptorDisplayName: string | null;
  /** What this viewer has already claimed, if anything. */
  yourClaim: 'OFFERER' | 'ACCEPTOR' | 'VOID' | null;
  youProposedCancel: boolean;
}

const BUTTON =
  'rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium disabled:opacity-50 dark:border-zinc-700';
const PRIMARY =
  'rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900';

export function WagerActions(props: WagerActionsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: { code: string } }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error?.code ?? 'Something went wrong.');
        return;
      }
      router.refresh();
    });
  }

  const { actions } = props;
  const nothing =
    !actions.canAccept &&
    !actions.canDecline &&
    !actions.canCancel &&
    !actions.canClaim &&
    !actions.canProposeCancel;

  if (nothing) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {actions.canAccept && (
          <button
            type="button"
            disabled={pending}
            className={PRIMARY}
            onClick={() => run(() => acceptWagerAction(props.wagerId))}
          >
            Take it
          </button>
        )}
        {actions.canDecline && (
          <button
            type="button"
            disabled={pending}
            className={BUTTON}
            onClick={() => run(() => declineWagerAction(props.wagerId))}
          >
            Decline
          </button>
        )}
        {actions.canCancel && (
          <button
            type="button"
            disabled={pending}
            className={BUTTON}
            onClick={() => run(() => cancelOfferAction(props.wagerId))}
          >
            Withdraw
          </button>
        )}
      </div>

      {actions.canClaim && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Who won?
          </span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              className={props.yourClaim === 'OFFERER' ? PRIMARY : BUTTON}
              onClick={() => run(() => claimWinnerAction(props.wagerId, 'OFFERER'))}
            >
              {props.offererDisplayName}
            </button>
            <button
              type="button"
              disabled={pending}
              className={props.yourClaim === 'ACCEPTOR' ? PRIMARY : BUTTON}
              onClick={() => run(() => claimWinnerAction(props.wagerId, 'ACCEPTOR'))}
            >
              {props.acceptorDisplayName ?? 'The other side'}
            </button>
            <button
              type="button"
              disabled={pending}
              className={props.yourClaim === 'VOID' ? PRIMARY : BUTTON}
              onClick={() => run(() => claimWinnerAction(props.wagerId, 'VOID'))}
            >
              Nobody — refund us
            </button>
          </div>
          <p className="text-xs text-zinc-500">
            It pays out as soon as you both say the same thing. If you disagree, an admin settles
            it.
          </p>
        </div>
      )}

      {actions.canProposeCancel && (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            disabled={pending || props.youProposedCancel}
            className={BUTTON}
            onClick={() => run(() => proposeCancelAction(props.wagerId))}
          >
            {props.youProposedCancel ? 'Waiting on them to agree' : 'Propose calling it off'}
          </button>
          <p className="text-xs text-zinc-500">
            Both of you have to agree. Then you each get your own stake back.
          </p>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Write the page**

Create `src/app/(app)/wagers/[wagerId]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { requireApprovedMember } from '@/server/auth/session';
import { loadWagerDetail } from '@/server/p2p/query';
import { WagerActions } from './wager-actions';

export default async function WagerDetailPage({ params }: PageProps<'/wagers/[wagerId]'>) {
  const member = await requireApprovedMember();
  const { wagerId } = await params;

  const wager = await loadWagerDetail(wagerId, member.membershipId);
  if (!wager) notFound();

  const isOfferer = wager.offererMembershipId === member.membershipId;
  const yourClaim = isOfferer ? wager.offererClaim : wager.acceptorClaim;
  const youProposedCancel = isOfferer ? wager.offererCancelProposed : wager.acceptorCancelProposed;

  const winner =
    wager.verdict === 'OFFERER'
      ? wager.offererDisplayName
      : wager.verdict === 'ACCEPTOR'
        ? wager.acceptorDisplayName
        : null;

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Badge>{wager.status}</Badge>
          {wager.disputed && <Badge>disputed</Badge>}
          {wager.overdue && <Badge>overdue</Badge>}
        </div>
        <h1 className="text-lg font-semibold">{wager.subject}</h1>
      </div>

      <dl className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
        <div className="flex justify-between">
          <dt className="text-zinc-500">{wager.offererDisplayName} puts up</dt>
          <dd>{wager.offererStakeCents.toString()} credits</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-zinc-500">
            {wager.acceptorDisplayName ?? 'Whoever takes it'} puts up
          </dt>
          <dd>{wager.acceptorStakeCents.toString()} credits</dd>
        </div>
        <div className="flex justify-between font-medium">
          <dt>Pot</dt>
          <dd>{wager.potCents.toString()} credits</dd>
        </div>
        {wager.lineAtOffer && (
          <div className="flex justify-between">
            <dt className="text-zinc-500">Line when offered</dt>
            <dd>{wager.lineAtOffer}</dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt className="text-zinc-500">Settled by</dt>
          <dd>{wager.resolvesBy.toLocaleString()}</dd>
        </div>
      </dl>

      {winner && (
        <p className="text-sm">
          <span className="font-medium">{winner}</span> took the pot.
        </p>
      )}
      {wager.verdict === 'VOID' && <p className="text-sm">Called off — both stakes went back.</p>}
      {wager.resolutionNote && (
        <p className="rounded-lg bg-zinc-100 p-3 text-sm dark:bg-zinc-900">
          <span className="font-medium">Admin: </span>
          {wager.resolutionNote}
        </p>
      )}

      <WagerActions
        wagerId={wager.id}
        actions={wager.actions}
        offererDisplayName={wager.offererDisplayName}
        acceptorDisplayName={wager.acceptorDisplayName}
        yourClaim={yourClaim}
        youProposedCancel={youProposedCancel}
      />
    </div>
  );
}
```

**Check `src/components/ui/badge.tsx`'s props** before using `<Badge>` — if it requires a variant or a different child shape, follow what is actually there.

- [ ] **Step 3: Verify the routes compile**

Run: `npm run build`
Expected: a successful build listing `/wagers/[wagerId]`.

Run: `npm run verify`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add the wager detail screen with every party action"
```

---

### Task 18: Arbitration, feed cards, and head-to-head on profiles

**Files:**

- Create: `src/app/admin/wagers/page.tsx`, `src/app/admin/wagers/actions.ts`
- Modify: `src/app/(app)/feed/feed-card.tsx`, `src/app/(app)/members/[membershipId]/page.tsx`
- Test: `npm run build`

**Interfaces:**

- Consumes: `loadArbitrationQueue` and `loadHeadToHead` (Task 14), `arbitrateWager` (Task 12), the five payload types (Task 4).
- Produces: `arbitrateWagerAction`.

Three loose ends, grouped because each is small and none is independently reviewable as a task.

- [ ] **Step 1: Write the admin action**

Create `src/app/admin/wagers/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/server/auth/session';
import { arbitrateWager } from '@/server/p2p/arbitrate';
import type { P2PVerdict } from '@/server/p2p/types';

/**
 * The admin check lives here, at the route boundary, exactly as it does for every other
 * admin action in this codebase. `arbitrateWager` records who acted; `requireAdmin` decides
 * whether they were allowed to.
 */
export async function arbitrateWagerAction(wagerId: string, verdict: P2PVerdict, note: string) {
  const admin = await requireAdmin();

  const result = await arbitrateWager({
    wagerId,
    actorUserId: admin.userId,
    verdict,
    note,
  });

  revalidatePath('/admin/wagers');
  revalidatePath(`/wagers/${wagerId}`);
  revalidatePath('/feed');

  return result.ok
    ? { ok: true as const, attempt: result.attempt }
    : { ok: false as const, error: result.error };
}
```

- [ ] **Step 2: Write the admin queue page**

Create `src/app/admin/wagers/page.tsx`. It renders a plain `<form action={...}>` per wager rather than a client component — an admin form with three submit buttons and a note field needs no client state.

```tsx
import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
import { requireAdmin } from '@/server/auth/session';
import { loadArbitrationQueue } from '@/server/p2p/query';
import { arbitrateWagerAction } from './actions';

export default async function AdminWagersPage() {
  const admin = await requireAdmin();
  const queue = await loadArbitrationQueue(admin.seasonId);

  async function arbitrate(formData: FormData) {
    'use server';
    await arbitrateWagerAction(
      String(formData.get('wagerId')),
      formData.get('verdict') as 'OFFERER' | 'ACCEPTOR' | 'VOID',
      String(formData.get('note') ?? ''),
    );
  }

  if (queue.length === 0) {
    return (
      <div className="px-4 py-4">
        <EmptyState
          title="Nothing to settle"
          body="Every wager is either agreed or still inside its window."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <h1 className="text-lg font-semibold">Wagers needing a ruling</h1>

      {queue.map((wager) => (
        <form
          key={wager.id}
          action={arbitrate}
          className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
        >
          <input type="hidden" name="wagerId" value={wager.id} />

          <div className="flex flex-col gap-1">
            <Link href={`/wagers/${wager.id}`} className="text-sm font-medium underline">
              {wager.subject}
            </Link>
            <span className="text-xs text-zinc-500">
              {wager.offererDisplayName} ({wager.offererStakeCents.toString()}) vs{' '}
              {wager.acceptorDisplayName} ({wager.acceptorStakeCents.toString()}) — pot{' '}
              {wager.potCents.toString()}
            </span>
            <span className="text-xs text-amber-600">
              {wager.disputed
                ? `They disagree: ${wager.offererDisplayName} says ${wager.offererClaim}, ${wager.acceptorDisplayName} says ${wager.acceptorClaim}`
                : 'Past its settle-by date with no agreement'}
            </span>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            Why (required, and it goes on the record)
            <input
              name="note"
              required
              className="rounded-lg border border-zinc-300 p-2 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              name="verdict"
              value="OFFERER"
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700"
            >
              {wager.offererDisplayName} wins
            </button>
            <button
              type="submit"
              name="verdict"
              value="ACCEPTOR"
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700"
            >
              {wager.acceptorDisplayName} wins
            </button>
            <button
              type="submit"
              name="verdict"
              value="VOID"
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700"
            >
              Refund both
            </button>
          </div>
        </form>
      ))}
    </div>
  );
}
```

**Check how the existing `src/app/admin/events/page.tsx` declares its inline server actions** and follow that shape exactly — this Next.js version may differ from your training data on inline `'use server'` functions inside a component.

- [ ] **Step 3: Render the five new feed cards**

In `src/app/(app)/feed/feed-card.tsx`, find the existing switch or map over `event.type` and add the five cases. Match whatever rendering shape the file already uses for `CUSTOM_EVENT_*` cards; the copy for each:

- `P2P_OFFERED` — "{name} is offering {offererStakeCents} against {acceptorStakeCents} credits: {description ?? subject}", plus "open to the season" or "a direct challenge" from `directed`.
- `P2P_ACCEPTED` — "{name} took it. {potCents} credits on the line: {subject}"
- `P2P_SETTLED` — "{name} took the {potCents}-credit pot: {subject}". When `correction` is true, prefix "Corrected — ". When `byArbitration` is true, add "settled by an admin".
- `P2P_DISPUTED` — "{name} and their opponent disagree on {subject}. An admin will settle it."
- `P2P_VOIDED` — "{subject} was called off; {refundedCents} credits went back." Wording by `reason`: `MUTUAL_CANCEL` "they both agreed to call it off", `AGREED_VOID` "they agreed nobody won", `EVENT_DEAD` "the event never happened", `ARBITRATED` "{adminDisplayName} refunded both sides — {note}".

Every money value in these payloads is a **decimal string**; render it directly or parse it with `BigInt()`. Do not pass it through `Number()`.

- [ ] **Step 4: Add head-to-head to the member profile**

In `src/app/(app)/members/[membershipId]/page.tsx`, load the record between the viewer and the profile's member and render it. Add the import:

```tsx
import { loadHeadToHead } from '@/server/p2p/query';
```

Then, after the existing stats are loaded, add the load and the block. `member` is the viewing member from `requireApprovedMember()`; `membershipId` is the profile being viewed — use whatever names the file already binds:

```tsx
const isSelf = membershipId === member.membershipId;
const headToHead = isSelf
  ? null
  : await loadHeadToHead(member.seasonId, member.membershipId, membershipId);
```

and in the JSX:

```tsx
{
  headToHead && (
    <section className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">You vs them</h2>
      {headToHead.settled === 0 && headToHead.voided === 0 ? (
        <p className="text-sm text-zinc-500">You have never wagered against each other.</p>
      ) : (
        <p className="text-sm">
          <span className="font-medium">
            {headToHead.aWon}–{headToHead.bWon}
          </span>
          {headToHead.voided > 0 && ` (${headToHead.voided} called off)`}, and you are{' '}
          <span className="font-medium">
            {headToHead.netCentsForA >= 0n ? 'up' : 'down'}{' '}
            {(headToHead.netCentsForA < 0n
              ? -headToHead.netCentsForA
              : headToHead.netCentsForA
            ).toString()}
          </span>{' '}
          credits.
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Verify the routes compile**

Run: `npm run build`
Expected: a successful build listing `/admin/wagers`.

Run: `npm run verify`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: arbitrate from the admin queue, render wager cards, show head-to-head"
```

---

### Task 19: The end-to-end arc, and the docs

**Files:**

- Modify: `src/server/__tests__/end-to-end.test.ts`, `docs/README.md`, `docs/roadmap.md`, `docs/specs/2026-08-19-peer-to-peer-bets-design.md`
- Test: the arc below

**Interfaces:**

- Consumes: every service built in Tasks 5–13.
- Produces: nothing new. This task proves the subsystem rather than extending it.

One arc, through the hardest path the design has: offered → accepted → the two disagree → an admin corrects an already-settled wager → the ledger, both balances, and **both** reconciliation checks come out clean.

- [ ] **Step 1: Write the arc**

Append to `src/server/__tests__/end-to-end.test.ts`. Read the file first and follow its existing `describe`/setup idiom rather than the imports below verbatim — this codebase seeds through helpers that file already imports.

```ts
describe('the peer-to-peer arc', () => {
  beforeEach(resetDb);

  it('carries a wager from offer through a dispute to an admin correction', async () => {
    const { db } = await import('@/db/client');
    const { eq } = await import('drizzle-orm');
    const { ledgerEntries, p2pWagers, seasonMemberships } = await import('@/db/schema');
    const { makeCreditedMembership } = await import('@/test/factories');
    const { offerWager } = await import('@/server/p2p/offer');
    const { acceptWager } = await import('@/server/p2p/accept');
    const { claimWinner } = await import('@/server/p2p/claim');
    const { arbitrateWager } = await import('@/server/p2p/arbitrate');
    const { reconcileBalances, reconcileEscrow } = await import('@/server/money/reconcile');

    const credits = async (membershipId: string) => {
      const [row] = await db
        .select({ credits: seasonMemberships.creditsBalanceCents })
        .from(seasonMemberships)
        .where(eq(seasonMemberships.id, membershipId));
      return row.credits;
    };

    const offerer = await makeCreditedMembership(100_000n);
    const acceptor = await makeCreditedMembership(100_000n, offerer.seasonId);
    const admin = await makeCreditedMembership(100_000n, offerer.seasonId);

    // 1. The offer. The offerer's stake is held immediately (D46).
    const offered = await offerWager({
      actorUserId: offerer.user.id,
      kind: 'FREEFORM',
      offererStakeCents: 50_000n,
      acceptorStakeCents: 20_000n,
      description: 'Jake cannot name ten starting quarterbacks',
      expiresAt: new Date(Date.now() + 3_600_000),
      resolvesBy: new Date(Date.now() + 7 * 86_400_000),
    });
    expect(offered.ok).toBe(true);
    if (!offered.ok) return;
    expect(await credits(offerer.membership.id)).toBe(50_000n);
    expect(await reconcileEscrow()).toEqual([]);

    // 2. Taken. Both stakes are now in the pot.
    const taken = await acceptWager({
      wagerId: offered.wagerId,
      actorUserId: acceptor.user.id,
    });
    expect(taken.ok).toBe(true);
    expect(await credits(acceptor.membership.id)).toBe(80_000n);
    expect(await reconcileEscrow()).toEqual([]);

    // 3. They agree, and it pays out.
    await claimWinner({
      wagerId: offered.wagerId,
      actorUserId: offerer.user.id,
      verdict: 'OFFERER',
    });
    await claimWinner({
      wagerId: offered.wagerId,
      actorUserId: acceptor.user.id,
      verdict: 'OFFERER',
    });
    expect(await credits(offerer.membership.id)).toBe(120_000n);
    expect(await credits(acceptor.membership.id)).toBe(80_000n);
    expect(await reconcileEscrow()).toEqual([]);

    // 4. An admin corrects it. Attempt 1 is reversed, attempt 2 is paid (D15).
    const corrected = await arbitrateWager({
      wagerId: offered.wagerId,
      actorUserId: admin.user.id,
      verdict: 'ACCEPTOR',
      note: 'he named eleven; there is video',
    });
    expect(corrected).toEqual({ ok: true, attempt: 2, paidCents: 70_000n });

    expect(await credits(offerer.membership.id)).toBe(50_000n);
    expect(await credits(acceptor.membership.id)).toBe(150_000n);

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, offered.wagerId));
    expect(wager.status).toBe('SETTLED');
    expect(wager.verdict).toBe('ACCEPTOR');
    expect(wager.settlementAttempts).toBe(2);

    // 5. History was corrected by addition, never by edit: the original P2P_WON is still
    //    there, alongside the reversal that undid it.
    const entries = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.p2pWagerId, offered.wagerId));
    const byType = entries.reduce<Record<string, number>>((acc, e) => {
      acc[e.type] = (acc[e.type] ?? 0) + 1;
      return acc;
    }, {});
    expect(byType).toEqual({
      P2P_ESCROW: 2,
      P2P_WON: 2,
      SETTLEMENT_REVERSAL: 1,
    });
    // Every credit that left a balance came back to one: the pot nets to zero.
    expect(entries.reduce((sum, e) => sum + e.amountCents, 0n)).toBe(0n);

    // 6. Nothing anywhere in the system has drifted, on either check.
    expect(await reconcileBalances()).toEqual([]);
    expect(await reconcileEscrow()).toEqual([]);

    // 7. No cash moved at any point. P2P cannot touch the bankroll (D40).
    const cashEntries = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.currency, 'CASH'));
    expect(cashEntries).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the arc**

Run: `npx vitest run src/server/__tests__/end-to-end.test.ts`
Expected: PASS, including every pre-existing arc in the file.

- [ ] **Step 3: Update the spec's status**

In `docs/specs/2026-08-19-peer-to-peer-bets-design.md`, change the header line:

```
**Status:** Built
```

- [ ] **Step 4: Update the roadmap**

In `docs/roadmap.md`, change the subsystem 4 table row to:

```
| 4 | Peer-to-peer bets | [Built](specs/2026-08-19-peer-to-peer-bets-design.md) |
```

and change the opening paragraph to read:

```
The project is four independent subsystems. Each gets its own spec, plan, and build cycle.
All four are built.
```

- [ ] **Step 5: Update the docs index**

In `docs/README.md`, add a subsystem 4 section to "Where things stand", after the subsystem 3 one, and update the closing paragraph. The new section:

```markdown
**Subsystem 4 — peer-to-peer bets:**

- `p2p_wagers`, a table owning its own lifecycle — six statuses, with **disputed and overdue
  derived** from the claim columns and the clock rather than stored
  ([D44](decisions.md#d44--dispute-and-overdue-are-derived-predicates-not-stored-statuses))
- Wagers staked in credits only, market-backed or freeform, with two explicit stakes and no
  price ([D40](decisions.md#d40--every-peer-to-peer-wager-moves-credits-including-the-market-backed-kind),
  [D41](decisions.md#d41--a-wager-is-two-explicit-stakes-not-a-stake-and-a-price))
- Escrow at offer rather than at acceptance, so a live offer is always good
  ([D46](decisions.md#d46--the-offerers-stake-escrows-at-offer-not-at-acceptance)), with three
  new ledger entry types and one nullable column — `bets` and `settleGame` untouched
  ([D42](decisions.md#d42--a-wager-is-its-own-table-not-two-bets-and-not-a-two-person-custom-event))
- Market-backed settlement from the existing pure graders, riding the `settle` cron beside the
  overdue-event sweep; freeform settlement when both parties agree, with admin arbitration when
  they do not ([D47](decisions.md#d47--a-freeform-wager-is-settled-by-both-parties-agreeing-with-admins-as-the-fallback))
- `reconcileEscrow`, a second daily check: balance reconciliation is blind to credits sitting
  in a pot, and a wager that escrowed and never paid out is exactly the bug it cannot see
  ([D43](decisions.md#d43--escrow-needs-its-own-reconciliation-check-balance-reconciliation-cannot-see-it))
- Head-to-head records, defined at last as the peer-to-peer record and nothing else
  ([D48](decisions.md#d48--head-to-head-is-the-peer-to-peer-record-and-nothing-else)), derived
  at read time with no stored counter
- Four screens — the wagers board, the offer form, wager detail, and the admin arbitration
  queue — reached from a Bets \| Wagers control on `/bets` rather than a seventh bottom tab
```

Replace the closing "Not built" paragraph with:

```markdown
Not built: a real odds provider adapter (still fixture-only — see [D2](decisions.md)) and
production deployment/hosted Postgres wiring. All four subsystems are otherwise complete.
```

Also update the "Where things stand" opening paragraph so the test count matches what `npm run verify` actually reports after this task — run it and use the real number, do not guess.

- [ ] **Step 6: Final verification**

```bash
npm run verify
```

Expected: all tests passing, 0 lint errors, and only the 3 pre-existing warnings. Record the exact file and test counts, and use them in the docs update from Step 5.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "test: prove the peer-to-peer arc end to end"
```

---

## Definition of done

Every one of these must be true before the branch is finished:

1. `npm run verify` passes: 0 lint errors, only the 3 pre-existing warnings, every test green.
2. `npm run build` compiles every route, including `/wagers`, `/wagers/new`, `/wagers/[wagerId]` and `/admin/wagers`.
3. **No file listed as read-only in Global Constraints was modified.** Confirm with `git diff main --stat` that `src/server/bets/place.ts`, `settle.ts`, `resettle.ts`, `grade-legs.ts`, `src/domain/grading.ts`, `src/domain/odds.ts` and `src/domain/custom-grading.ts` are absent from the diff.
4. The escrow invariant holds: `reconcileEscrow()` returns `[]` at the end of every service test that settles a wager, and in the end-to-end arc.
5. No cash ever moves through a peer-to-peer path. The end-to-end arc asserts this directly; if you ever pass a `currency` other than `'CREDITS'` in `src/server/p2p/`, that is the bug.
6. Every ledger write and every feed write in `src/server/p2p/` carries a deterministic key, and every service has a test proving a replay writes nothing new.
7. Both concurrency tests pass reliably: two simultaneous acceptances of one open offer produce exactly one acceptance, and two simultaneous agreeing claims produce exactly one payout.
8. `docs/README.md`, `docs/roadmap.md` and the spec's status line all say subsystem 4 is built, with a test count that matches reality.
