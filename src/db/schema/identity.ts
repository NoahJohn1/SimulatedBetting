import { sql } from 'drizzle-orm';
import {
  bigint,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const authProvider = pgEnum('auth_provider', ['GOOGLE']);
export const userRole = pgEnum('user_role', ['USER', 'ADMIN']);
export const userStatus = pgEnum('user_status', ['PENDING', 'APPROVED', 'DISABLED']);
export const seasonStatus = pgEnum('season_status', ['UPCOMING', 'ACTIVE', 'COMPLETED']);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: authProvider('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    avatarUrl: text('avatar_url'),
    role: userRole('role').notNull().default('USER'),
    status: userStatus('status').notNull().default('PENDING'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_provider_account_idx').on(t.provider, t.providerAccountId)],
);

export const seasons = pgTable(
  'seasons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    startingBankrollCents: bigint('starting_bankroll_cents', { mode: 'bigint' }).notNull(),
    weeklyAllowanceCents: bigint('weekly_allowance_cents', { mode: 'bigint' }).notNull(),
    startingCreditsCents: bigint('starting_credits_cents', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    weeklyCreditAllowanceCents: bigint('weekly_credit_allowance_cents', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    allowanceWeekday: smallint('allowance_weekday').notNull(),
    status: seasonStatus('status').notNull().default('UPCOMING'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('seasons_one_active_idx')
      .on(t.status)
      .where(sql`${t.status} = 'ACTIVE'`),
  ],
);

export const seasonMemberships = pgTable(
  'season_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => seasons.id),
    balanceCents: bigint('balance_cents', { mode: 'bigint' }).notNull(),
    creditsBalanceCents: bigint('credits_balance_cents', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('season_memberships_user_season_idx').on(t.userId, t.seasonId)],
);
