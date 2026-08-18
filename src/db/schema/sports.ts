import {
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { events } from './events';

export const sport = pgEnum('sport', ['NFL', 'NCAAF']);
export const gameStatus = pgEnum('game_status', [
  'SCHEDULED',
  'IN_PROGRESS',
  'FINAL',
  'POSTPONED',
  'CANCELED',
]);
export const marketType = pgEnum('market_type', ['MONEYLINE', 'SPREAD', 'TOTAL']);
export const marketStatus = pgEnum('market_status', ['OPEN', 'SUSPENDED', 'SETTLED']);
export const selectionSide = pgEnum('selection_side', ['HOME', 'AWAY', 'OVER', 'UNDER']);

export type Sport = (typeof sport.enumValues)[number];
export type GameStatus = (typeof gameStatus.enumValues)[number];
export type MarketTypeValue = (typeof marketType.enumValues)[number];
export type MarketStatusValue = (typeof marketStatus.enumValues)[number];
export type SelectionSide = (typeof selectionSide.enumValues)[number];

export const teams = pgTable(
  'teams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sport: sport('sport').notNull(),
    externalId: text('external_id').notNull(),
    name: text('name').notNull(),
    abbreviation: text('abbreviation').notNull(),
    logoUrl: text('logo_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('teams_sport_external_idx').on(t.sport, t.externalId)],
);

export const games = pgTable(
  'games',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sport: sport('sport').notNull(),
    externalId: text('external_id').notNull(),
    homeTeamId: uuid('home_team_id')
      .notNull()
      .references(() => teams.id),
    awayTeamId: uuid('away_team_id')
      .notNull()
      .references(() => teams.id),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    seasonYear: integer('season_year').notNull(),
    week: smallint('week'),
    status: gameStatus('status').notNull().default('SCHEDULED'),
    homeScore: integer('home_score'),
    awayScore: integer('away_score'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
  },
  (t) => [
    uniqueIndex('games_sport_external_idx').on(t.sport, t.externalId),
    // The settlement candidate query filters on exactly this pair.
    index('games_status_starts_at_idx').on(t.status, t.startsAt),
    uniqueIndex('games_event_idx').on(t.eventId),
  ],
);

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

/**
 * `line` is numeric(5,2) and Drizzle hands it back as a decimal string, which is what
 * the domain's line comparison expects — it normalizes and compares as strings and
 * never routes through Number. null means the market has no line (moneyline).
 */
export const selections = pgTable(
  'selections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id),
    side: selectionSide('side').notNull(),
    line: numeric('line', { precision: 5, scale: 2 }),
    priceAmerican: integer('price_american').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('selections_market_side_idx').on(t.marketId, t.side)],
);

/** Append-only history of what each selection actually offered, and when. */
export const oddsSnapshots = pgTable(
  'odds_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    selectionId: uuid('selection_id')
      .notNull()
      .references(() => selections.id),
    line: numeric('line', { precision: 5, scale: 2 }),
    priceAmerican: integer('price_american').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('odds_snapshots_selection_idx').on(t.selectionId, t.capturedAt)],
);
