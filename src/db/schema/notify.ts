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
