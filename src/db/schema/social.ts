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
