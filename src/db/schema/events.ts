import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { seasonMemberships, seasons, users } from './identity';

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
