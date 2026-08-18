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
