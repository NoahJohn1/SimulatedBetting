# Social Layer — Design Spec

**Date:** 2026-08-17
**Status:** Specified, not built
**Scope:** Subsystem 2 of 4 (see [../roadmap.md](../roadmap.md))
**Depends on:** [Subsystem 1 — core betting engine](2026-08-14-core-betting-engine-design.md), built

## Purpose

Turn a private sportsbook into a private *league*. Subsystem 1 records what everybody bet
and what it paid; nobody can see any of it. This subsystem publishes that record to the
season, lets members react and talk on it, and gives every member a profile page with real
numbers behind their name.

The product goal is that opening the app tells you what your friends just did. The
engineering goal is that the social layer never puts a dollar at risk: it adds no new money
movement, no new grading path, and nothing it can get wrong changes a balance.

## Success criteria

Subsystem 2 is done when all of the following are true:

1. A member opens the Feed tab and sees, newest first, what everyone in their season has bet
   and how it resolved — a bet appears the moment it is placed.
2. Each card can be reacted to with a fixed emoji set and commented on in a flat thread.
   Comment authors can delete their own; admins can delete any.
3. Every member has a profile page with season record, ROI, net, streak, biggest win, and
   their own event history. Standings rows link to it.
4. Each member can mute event types they don't care about, and the mute is per-viewer at read
   time — nothing is lost, unmuting reveals the history.
5. Running any background job twice produces no duplicate feed events, and re-settling a bet
   posts a card marked as a correction without removing the original.
6. `npm run verify` passes, and the existing 222 tests still pass unchanged in behavior.

## Non-goals

Social graph (follows/friends) · head-to-head records · direct messages · push or email
notifications · unread badges · real-time transport (websockets, SSE, polling) · comment
editing · threaded replies · @mentions · images or GIFs in comments · a moderation queue ·
a cross-season global feed · sharing outside the app.

Each is deliberately excluded. The graph and head-to-head have their own decisions below
([D21](../decisions.md#d21--no-social-graph-the-season-is-the-graph),
[D27](../decisions.md#d27--head-to-head-is-deferred-to-subsystem-4)); the rest are either notification
infrastructure this group doesn't need (they have a group chat) or product surface that adds
screens without adding fun.

## Architecture

No new services, no new deployment, no new dependencies. Three additions to the existing
Next.js app:

```
┌──────────────────────────────────────────────────────────────┐
│  Next.js app (unchanged deployment)                          │
│                                                               │
│  React UI  ── /feed · /feed/[eventId] · /members/[id]         │
│              /me/feed-preferences   (five-tab bottom bar)     │
│      ↕ server actions                                         │
│  Domain layer ── pure, no I/O                                 │
│      domain/milestones.ts  ·  domain/stats.ts                 │
│  Service layer                                                │
│      server/feed/emit.ts    emitFeedEvent(tx, …)              │
│      server/feed/query.ts   getSeasonFeed(…)                  │
│      server/feed/social.ts  reactions + comments              │
│      server/feed/leaders.ts detectLeadChange(seasonId)        │
│      ↕                                                        │
│  Drizzle → Postgres                                           │
│      feed_events · feed_reactions · feed_comments             │
│      feed_preferences                                         │
└──────────────────────────────────────────────────────────────┘
```

The existing money and grading services gain **emit calls only**. `placeBet`, `settleGame`,
`resettleBet`, `joinSeason`, `payWeeklyAllowance`, and `adjustBalance` each add one
`emitFeedEvent(tx, …)` call. None of their existing logic changes.

### How feed events are produced

Events are **materialized rows written in the transaction that causes them**, not derived at
read time and not built by a background scanner. This is
[D23](../decisions.md#d23--feed_events-is-a-materialized-append-only-table-written-in-the-source-transaction),
and it is the decision the rest of the design hangs off.

Two categories:

**Source events** — `BET_PLACED`, `BET_SETTLED`, `MEMBER_JOINED`, `ALLOWANCE_PAID`,
`ADMIN_ADJUSTMENT`, `MILESTONE_BIG_WIN`, `MILESTONE_PARLAY_HIT`. Each is caused by exactly
one state change in exactly one transaction, and is emitted there. `MILESTONE_BIG_WIN` and
`MILESTONE_PARLAY_HIT` belong here despite the name: both are functions of a single settled
bet and need no cross-member state.

**Derived events** — `MILESTONE_LEAD_CHANGE` only. Detecting it requires comparing every
membership's balance in the season, which has no business inside a bet's transaction.
`detectLeadChange(seasonId)` runs in its own transaction, called from the `settle` cron route
after `settleFinalGames()` and from the admin adjustment action. It is not a new cron entry —
see [Lead change detection](#lead-change-detection).

`emitFeedEvent` deliberately mirrors `postEntry`: same `(tx, input)` shape, same
`onConflictDoNothing` on a deterministic unique key, same "returns whether it applied"
result. An engineer who has read the ledger has already read this.

### Layering rule, restated

Milestone thresholds and profile statistics are **pure functions** in `src/domain/`, taking
values and returning values. `computeMemberStats(rows)` never sees a database. This is the
same rule that made grading exhaustively testable, applied to the only two pieces of the
social layer with real logic in them.

## Data model

All monetary values remain integer cents. Timestamps are `TIMESTAMPTZ`. Primary keys are
UUIDv4 ([D18](../decisions.md#d18--primary-keys-are-uuidv4-not-uuidv7)).

### `feed_events`

Append-only. Never updated, never deleted.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `season_id` | uuid | FK `seasons`; every event is season-scoped |
| `type` | enum | see below |
| `subject_membership_id` | uuid | FK `season_memberships`, nullable — the member the event is *about* |
| `bet_id` | uuid | nullable FK `bets` |
| `ledger_entry_id` | uuid | nullable FK `ledger_entries` |
| `payload` | jsonb | frozen render snapshot; see [Payloads](#payloads) |
| `dedupe_key` | text | **unique** |
| `occurred_at` | timestamptz | business time — copied from the source row, not `now()` |
| `created_at` | timestamptz | write time |

Event types:

| Type | Subject | Emitted from |
|---|---|---|
| `BET_PLACED` | bettor | `placeBet` |
| `BET_SETTLED` | bettor | `settleGame`, `resettleBet` |
| `MEMBER_JOINED` | joiner | `joinSeason` |
| `ALLOWANCE_PAID` | *null* — season-wide | `payWeeklyAllowance` |
| `ADMIN_ADJUSTMENT` | adjusted member | `adjustBalance` |
| `MILESTONE_LEAD_CHANGE` | new leader | `detectLeadChange` |
| `MILESTONE_BIG_WIN` | bettor | `settleGame`, `resettleBet` |
| `MILESTONE_PARLAY_HIT` | bettor | `settleGame`, `resettleBet` |

The column is `subject_membership_id`, not `actor_membership_id`, because of
`ADMIN_ADJUSTMENT`: the actor is the admin, but the card belongs to the member whose balance
moved. Naming it "subject" makes every type read the same way — *this card is about this
member* — and the admin's name lives in the payload.

`ALLOWANCE_PAID` is the one event with no subject. It is **one event per season per week**,
not one per member: a twelve-person league would otherwise post twelve identical cards every
Tuesday, which is how a feed dies. See
[D26](../decisions.md#d26--allowance-posts-one-aggregated-card-per-week).

**Indexes**

| Index | Columns | Serves |
|---|---|---|
| `feed_events_dedupe_key_idx` | unique (`dedupe_key`) | idempotency |
| `feed_events_season_idx` | (`season_id`, `occurred_at` desc, `id` desc) | the feed's keyset pagination |
| `feed_events_subject_idx` | (`subject_membership_id`, `occurred_at` desc) | a profile's event history |
| `feed_events_bet_idx` | (`bet_id`) | finding a bet's cards |

The season index is `(occurred_at, id)` and not `occurred_at` alone because two events can
share a timestamp to the microsecond — a settlement transaction posts several. Paginating on
a non-unique sort key silently skips or repeats rows at page boundaries.

### Dedupe keys

Deterministic, and deliberately parallel to the ledger's idempotency keys so a card and its
ledger entry can be lined up by eye:

| Event | Key |
|---|---|
| `BET_PLACED` | `bet:<betId>:placed` |
| `BET_SETTLED` | `bet:<betId>:settled:<attempt>` |
| `MILESTONE_BIG_WIN` | `bet:<betId>:bigwin:<attempt>` |
| `MILESTONE_PARLAY_HIT` | `bet:<betId>:parlayhit:<attempt>` |
| `MEMBER_JOINED` | `membership:<membershipId>:joined` |
| `ALLOWANCE_PAID` | `allowance:<seasonId>:<isoWeekKey>` |
| `ADMIN_ADJUSTMENT` | `ledger:<ledgerEntryId>` |
| `MILESTONE_LEAD_CHANGE` | `lead:<seasonId>:<sequence>` |

Settlement keys carry the attempt counter for the same reason the ledger's do: a re-settled
bet must be able to post a corrected card without colliding with the original.

### Payloads

`payload` is a discriminated union on `type`, typed in `src/server/feed/payload.ts`. It holds
a **frozen snapshot of what to render** — the teams, the market, the line and price as they
were, the stake, the result. Identity is *not* in the payload: display name and avatar are
joined live from `users`, so renaming yourself updates every card you ever posted.

That split is the whole rule: **facts freeze, identity doesn't.** A leg's line is what was
offered at 1:04pm and can never be anything else
([D10](../decisions.md#d10--legs-freeze-their-line-and-price-at-placement)); a display name is
a current fact about a person.

Money in JSON is stored as **decimal strings**, not numbers. `JSON.stringify` throws on a
`bigint` and silently loses precision on anything above 2^53 as a `number`; a string round-trips
into `BigInt()` exactly. ([D25](../decisions.md#d25--money-inside-a-feed-payload-is-a-decimal-string))

```ts
export interface FeedLegSnapshot {
  sport: 'NFL' | 'NCAAF';
  marketType: 'MONEYLINE' | 'SPREAD' | 'TOTAL';
  side: 'HOME' | 'AWAY' | 'OVER' | 'UNDER';
  line: string | null;          // numeric(5,2) as Drizzle returns it
  priceAmerican: number;
  homeAbbr: string;
  awayAbbr: string;
  startsAt: string;             // ISO 8601
}

export interface BetPlacedPayload {
  betType: 'SINGLE' | 'PARLAY';
  stakeCents: string;
  potentialPayoutCents: string;
  combinedPriceAmerican: number;
  legs: FeedLegSnapshot[];
}

/** A leg's graded outcome. Reuses the engine's `BetStatus` values minus `PENDING`. */
export type LegOutcome = 'WON' | 'LOST' | 'PUSHED' | 'VOIDED';

export interface BetSettledPayload extends BetPlacedPayload {
  outcome: 'WON' | 'LOST' | 'PUSHED' | 'VOIDED';
  payoutCents: string;                    // "0" for LOST
  netCents: string;                       // payout − stake, signed
  legOutcomes: LegOutcome[];              // parallel to legs, same order
  settlementAttempt: number;
  correction: boolean;                    // settlementAttempt > 1
}

export interface MemberJoinedPayload  { startingBankrollCents: string }
export interface AllowancePaidPayload { weekKey: string; memberCount: number; amountCents: string }
export interface AdminAdjustmentPayload { amountCents: string; note: string; adminDisplayName: string }
export interface LeadChangePayload {
  sequence: number;
  previousLeaderMembershipId: string | null;
  previousLeaderDisplayName: string | null;
  balanceCents: string;
  marginCents: string;                    // over second place
}
export interface BigWinPayload    { stakeCents: string; payoutCents: string; multipleBasisPoints: number }
export interface ParlayHitPayload { legCount: number; payoutCents: string; combinedPriceAmerican: number }

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

`multipleBasisPoints` rather than a float multiple: `payout × 10000 / stake` as integer
BigInt division, rendered as `12.4×`. No floating-point value appears anywhere near money,
including in display-only fields ([D17](../decisions.md#d17--all-money-is-integer-cents)).

### `feed_reactions`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `event_id` | uuid | FK `feed_events` |
| `membership_id` | uuid | FK `season_memberships` |
| `emoji` | text | must be in the allowed set |
| `created_at` | timestamptz | |

Unique on (`event_id`, `membership_id`, `emoji`); indexed on (`event_id`).

A member may leave several *different* emoji on a card but not the same one twice. Tapping an
active reaction removes it — a hard `DELETE`, because a reaction is not an audit record and
nobody needs its history ([D28](../decisions.md#d28--reactions-hard-delete-comments-soft-delete)).

The allowed set is a domain constant, validated server-side:

```ts
export const REACTION_EMOJI = ['🔥', '😂', '💀', '🤝', '🎯', '🤡'] as const;
```

Six, fixed, in this order everywhere. An open emoji field means an unbounded `GROUP BY` per
card, a legend nobody can read, and a picker on a phone. Six covers celebration, mockery, and
respect, which is the entire emotional range of a betting group chat.

### `feed_comments`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `event_id` | uuid | FK `feed_events` |
| `membership_id` | uuid | FK `season_memberships` |
| `body` | text | trimmed, 1–500 characters |
| `created_at` | timestamptz | |
| `deleted_at` | timestamptz | nullable |
| `deleted_by_user_id` | uuid | nullable FK `users` |

Indexed on (`event_id`, `created_at`).

Flat — no threading, no editing. Deletion is **soft**: the row stays, the thread keeps its
shape, the card renders *"Comment removed"*, and `deleted_by_user_id` records whether the
author or an admin did it. That's the same instinct as
[D15](../decisions.md#d15--corrections-write-reversing-entries-history-is-never-edited): when
an admin removes something, there is a record that they did.

### `feed_preferences`

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid | PK, FK `users` |
| `muted_types` | `feed_event_type[]` | NOT NULL, default `'{}'` |
| `updated_at` | timestamptz | |

Keyed on `user_id`, not `membership_id`: a preference is about a person, and it should survive
into next season rather than resetting when a new membership is created.

No row means nothing muted, so the table stays empty until somebody changes something. The
mute is applied **at read time** (`NOT (type = ANY(muted_types))`) — events are always
recorded for everyone, so unmuting reveals the full history rather than a gap.

## Emission points

Each of these adds one call. Nothing else in the function changes.

**`placeBet`** (`src/server/bets/place.ts`) — after `postEntry`, inside the same transaction:
`BET_PLACED`, `occurred_at` = the bet's `placed_at`. The leg snapshot needs team abbreviations
and sport, which `loadSelections` does not currently select; it gains those columns via two
aliased joins to `teams` rather than paying for a second query inside the placement
transaction.

**`settleGame`** (`src/server/bets/settle.ts`) — per settled bet, in the game's transaction:
`BET_SETTLED`, plus `MILESTONE_BIG_WIN` when `payout ≥ 10 × stake`, plus
`MILESTONE_PARLAY_HIT` when a `PARLAY` won with four or more surviving legs. The per-bet legs
query gains the same snapshot joins. `season_id` comes from a join to `season_memberships`.

**`resettleBet`** (`src/server/bets/resettle.ts`) — the same three, keyed on the new attempt
number, with `correction: true`.

**`joinSeason`** (`src/server/seasons/service.ts`) — `MEMBER_JOINED` after the grant. Guarded
on `postEntry` having applied, so re-joining an existing membership doesn't re-announce it.

**`payWeeklyAllowance`** (`src/server/seasons/allowance.ts`) — one `ALLOWANCE_PAID` after the
per-membership loop, in its own transaction, carrying the credited count. It is emitted
unconditionally — a run that credited nobody is a repeat run, and the week-scoped dedupe key
already makes that a no-op, so there is no reason for the caller to branch on the count.

**`adjustBalance`** (`src/server/admin/adjust.ts`) — `ADMIN_ADJUSTMENT` in the same
transaction, keyed on the ledger entry id, with the admin's display name resolved into the
payload. This publishes admin adjustments to the whole season, which is a change from
subsystem 1 and an intentional one — see
[D24](../decisions.md#d24--admin-adjustments-are-published-to-the-season-feed).

### Why the emit is inside the money transaction

Because the alternative is worse. A feed insert that commits separately can succeed when the
bet fails or fail when the bet succeeds, and the second case produces a feed that lies. Inside
the transaction, the insert is a single `INSERT … ON CONFLICT DO NOTHING` with no joins, no
computation, and no external call: the only way it fails is a database that is unavailable, in
which case the bet should not commit either. This is exactly the argument the ledger already
makes for `postEntry`, and it is why `emitFeedEvent` takes a `tx` rather than opening its own.

The cost is real and worth naming: a bug in payload construction can now reject a bet. The
mitigation is that payload construction happens **before** the transaction's final writes
where possible, is pure data assembly over rows already read, and is covered by tests at the
emit boundary rather than only through the UI.

### Lead change detection

```ts
export async function detectLeadChange(seasonId: string): Promise<{ emitted: boolean }>;
```

Reads every membership's balance in the season, finds the leader, compares against the leader
recorded in the most recent `MILESTONE_LEAD_CHANGE` payload for that season, and emits when
they differ.

Three rules make it stable rather than chatty:

1. **A strict leader only.** If the top balance is tied, there is no leader and no event. At
   season start everyone holds the same bankroll, so the feed does not open with a
   coin-flip "X takes the lead".
2. **Sequence-numbered keys.** `sequence` = 1 + the count of existing lead-change events in
   the season, so the key is `lead:<seasonId>:<n>`. A leader can lose and retake the lead
   (A → B → A) because each transition gets a new number, while a double-fired run computes
   the same number and loses the unique-key race harmlessly.
3. **Called where standings actually move.** At the end of the `settle` cron route, and after
   an admin adjustment. Not after the allowance run: crediting every member the same amount
   cannot reorder them.

No new cron entry in `vercel.json`, no cursor table, no snapshot table. Previous state is read
back out of the last event's payload, which is the only place it needs to exist.

## Reading the feed

```ts
export interface FeedCursor { occurredAt: Date; id: string }

export async function getSeasonFeed(opts: {
  seasonId: string;
  viewerUserId: string;
  viewerMembershipId: string;
  subjectMembershipId?: string;   // set for a profile's history
  cursor?: FeedCursor;
  limit?: number;                 // default 25, hard max 50
}): Promise<{ cards: FeedCard[]; nextCursor: FeedCursor | null }>;
```

Three queries per page, never N+1:

1. **The page.** `feed_events` joined to `season_memberships` → `users` for the subject,
   filtered by season, by the viewer's muted types, and optionally by subject; keyset
   `WHERE (occurred_at, id) < (cursor.occurredAt, cursor.id)`, ordered
   `occurred_at DESC, id DESC`, `LIMIT limit + 1`. The extra row is how `nextCursor` is
   decided without a `COUNT`.
2. **Reactions.** Grouped counts plus a `bool_or(membership_id = viewer)` flag, for the page's
   event ids only.
3. **Comment counts.** `COUNT(*) WHERE deleted_at IS NULL`, for the page's event ids only.

Keyset rather than `OFFSET` because the feed grows at the head: with an offset, an event
arriving between page 1 and page 2 shifts everything down one and the reader sees a duplicate.

```ts
export interface FeedCard {
  id: string;
  type: FeedEventType;
  occurredAt: Date;
  subject: { membershipId: string; displayName: string; avatarUrl: string | null } | null;
  payload: FeedEventPayload;
  reactions: { emoji: string; count: number; mine: boolean }[];
  commentCount: number;
}
```

**Authorization.** Every read and write goes through the existing `requireApprovedMember()` /
`requireApprovedMemberOrThrow()`, and every query is filtered by the viewer's own
`seasonId` — a member cannot pass another season's id and read it. A `PENDING` or `DISABLED`
user gets the same treatment they already get everywhere else.

## Reactions and comments

```ts
export async function toggleReaction(input: {
  eventId: string; membershipId: string; emoji: string;
}): Promise<{ active: boolean }>;

export async function addComment(input: {
  eventId: string; membershipId: string; body: string;
}): Promise<{ commentId: string }>;

export async function deleteComment(input: {
  commentId: string; actorUserId: string; actorMembershipId: string; isAdmin: boolean;
}): Promise<{ deleted: boolean }>;
```

Rules, all enforced server-side:

- The emoji must be in `REACTION_EMOJI`. Anything else is rejected, not stored.
- The event must belong to the actor's season. Cross-season interaction is rejected.
- `body` is trimmed; empty is rejected, over 500 characters is rejected.
- `deleteComment` succeeds for the comment's own author or for an `ADMIN`, and is rejected for
  anyone else. Already-deleted comments return `{ deleted: false }` rather than erroring —
  a double-tap on a slow connection is not an error condition.

## Profile statistics

Pure, in `src/domain/stats.ts`:

```ts
export interface BetOutcomeRow {
  status: BetStatus;
  stakeCents: bigint;
  payoutCents: bigint;      // 0 for PENDING and LOST
  settledAt: Date | null;
}

export interface MemberStats {
  pending: number;
  pendingStakeCents: bigint;
  settled: number;
  won: number; lost: number; pushed: number; voided: number;
  stakedCents: bigint;
  returnedCents: bigint;
  netCents: bigint;
  roiBasisPoints: number | null;               // null when stakedCents is 0
  currentStreak: { kind: 'W' | 'L' | 'NONE'; length: number };
  biggestWinCents: bigint;                     // largest net profit on a single won bet
}

export function computeMemberStats(rows: BetOutcomeRow[]): MemberStats;
```

Definitions, chosen and then written down because each has a defensible alternative:

- **`stakedCents` excludes `VOIDED` bets.** A voided bet was refunded in full because the game
  never happened; counting it as action would drag every ROI toward zero for reasons that have
  nothing to do with betting skill.
- **`PUSHED` bets are included** in both staked and returned, so they are ROI-neutral rather
  than invisible. A push *is* a result — you had action and got your money back.
- **ROI is integer basis points**, `net × 10000 / staked` in BigInt, displayed as a percentage
  with one decimal. Zero staked gives `null`, which the UI renders as `—` rather than `0.0%`.
- **Streaks count only `WON` and `LOST`**, in `settledAt` order; pushes and voids are skipped
  rather than breaking the streak. A push does not end a hot run.

The profile page also shows current rank and balance, both already available from the
standings query.

## Screens

The bottom bar goes from four tabs to five, which
[D8](../decisions.md#d8--layout-sportsbook-first) anticipated. Games stays the landing route;
Feed sits second, one tap from open.

**Games · Feed · My Bets · Standings · Me**

- **Feed** (`/feed`) — the season's cards, newest first. A server component renders the first
  page; a client `FeedList` appends further pages through a server action, so there is no
  client data-fetching library and no route handler. Each card shows the subject's name and
  avatar, relative time, a type-specific body, the reaction row, and a comment count.
- **Event detail** (`/feed/[eventId]`) — the same card, full comment thread, composer, and
  delete controls where permitted. Cards link here; the comment count is the affordance.
- **Member profile** (`/members/[membershipId]`) — name, avatar, rank, balance, the stats
  block, and that member's recent events. Reached from standings rows and from any feed card's
  name.
- **Feed preferences** (`/me/feed-preferences`) — a checkbox per event type, saved by a server
  action. Linked from the Me tab and from the feed header.
- **Admin** — no new screen. Comment deletion is a control on the comment itself, visible to
  admins.

Card bodies by type, so the UI has no room for invention:

| Type | Reads as |
|---|---|
| `BET_PLACED` | *Dana* bet **$50** · KC −3.5 (−110) · to win $95.45 |
| `BET_SETTLED` | *Dana* **won $95.45** · KC −3.5 ✓ (with per-leg marks on parlays) |
| `MEMBER_JOINED` | *Dana* joined with **$10,000** |
| `ALLOWANCE_PAID` | Weekly allowance paid · **$500** to 12 members |
| `ADMIN_ADJUSTMENT` | *Dana* **+$250** by admin *Chris* — "won the survivor pool" |
| `MILESTONE_LEAD_CHANGE` | *Dana* takes the lead · **$12,480** (+$310 over *Sam*) |
| `MILESTONE_BIG_WIN` | *Dana* cashed **12.4×** · $50 → $620 |
| `MILESTONE_PARLAY_HIT` | *Dana* hit a **5-leg parlay** · +$2,400 |

## Failure handling

| Failure | Behavior |
|---|---|
| Feed insert fails inside a money transaction | The whole transaction rolls back. Deliberate: the insert is one dumb statement, so failure means Postgres is unavailable and the bet must not commit either. |
| Cron double-fires; settlement re-runs | Unique `dedupe_key` plus `ON CONFLICT DO NOTHING` makes the second write a no-op — the same guarantee the ledger already gives. |
| Admin re-settles a bet | A second `BET_SETTLED` card is posted with `correction: true`; the original stays. History is never edited ([D15](../decisions.md#d15--corrections-write-reversing-entries-history-is-never-edited)). |
| Two runs both detect the same lead change | Both compute the same `sequence`; one wins the unique key, the other no-ops. |
| Lead change while the top balance is tied | No event. A tie has no leader. |
| A member is `DISABLED` mid-season | Their events and comments remain. Their profile renders with a disabled badge. They cannot react or comment (existing authorization already blocks it). |
| A viewer mutes a type | Filtered at read time only. Nothing is deleted, and unmuting restores the full history. |
| Comment is empty, whitespace, or over 500 chars | Rejected by the server action with a field error. The client also guards, but the server is what decides. |
| Deleting an already-deleted comment | Returns `{ deleted: false }`. Not an error. |
| A reaction emoji outside the allowed set | Rejected. The set is a server-side constant, not a client contract. |
| Bets and settlements that predate this subsystem | No backfill. There is no production data yet ([docs/README.md](../README.md#where-things-stand)), so the feed simply starts empty and fills forward. |
| A card's underlying game or team row changes | Irrelevant — the payload froze what to render. Only identity is joined live. |

## Testing

**Unit, table-driven, no I/O:**

- `computeMemberStats`: empty history; all-pending; a push counted in both staked and returned;
  a void excluded from staked; ROI at zero staked returning `null`; ROI sign on a losing
  season; streak broken by a loss; streak *not* broken by a push; biggest win taken as net
  profit rather than gross payout.
- Milestone thresholds: big win at exactly 10× (inclusive) and at 9.99× (excluded); parlay hit
  at exactly 4 surviving legs and at 3; a 5-leg parlay reduced to 3 by pushes not counting as
  a hit.
- Lead change: no event when tied; no event when the leader is unchanged; an event on A → B;
  an event on B → A with the next sequence number.

**Integration, against the test database:**

1. *Emission* — placing a bet writes exactly one `BET_PLACED` with the expected dedupe key and
   a payload whose legs match the frozen `bet_legs` rows.
2. *Idempotency* — run `settleFinalGames` twice; assert `feed_events` is byte-identical after
   the second run. This mirrors the existing ledger idempotency test and is the single most
   important test in the subsystem.
3. *Correction* — re-settle a bet; assert two `BET_SETTLED` rows exist, the second flagged
   `correction`, and the first unmodified.
4. *Pagination* — seed 60 events with colliding timestamps, page through with `limit: 25`, and
   assert every event appears exactly once across the pages.
5. *Muting* — mute `ALLOWANCE_PAID`; assert it is absent for that viewer and present for
   another; unmute and assert it returns.
6. *Authorization* — a member of season A cannot read season B's feed, react to its events, or
   comment on them; a `PENDING` user is rejected.
7. *Comments* — author deletes own (allowed), non-author non-admin deletes (rejected), admin
   deletes another's (allowed, `deleted_by_user_id` recorded), double-delete returns
   `{ deleted: false }`.
8. *Reactions* — toggle on, toggle off, two distinct emoji from one member allowed, the same
   emoji twice is one row.
9. *End-to-end* — extend the existing `end-to-end.test.ts`: after the full place-and-settle
   flow, assert the feed contains the expected event sequence in the expected order.

The reconciliation property from subsystem 1 must still hold after every social operation:
nothing here touches money, and the test suite should prove it rather than assume it.
