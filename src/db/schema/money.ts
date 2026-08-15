import { bigint, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { seasonMemberships, users } from './identity';

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
]);

export type LedgerEntryType = (typeof ledgerEntryType.enumValues)[number];

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => seasonMemberships.id),
    amountCents: bigint('amount_cents', { mode: 'bigint' }).notNull(),
    type: ledgerEntryType('type').notNull(),
    balanceAfterCents: bigint('balance_after_cents', { mode: 'bigint' }).notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    note: text('note'),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ledger_entries_idempotency_key_idx').on(t.idempotencyKey),
    index('ledger_entries_membership_idx').on(t.membershipId, t.createdAt),
  ],
);
