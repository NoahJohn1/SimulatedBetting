import { bigint, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { seasonMemberships, users } from './identity';
import { bets } from './betting';
import { currency } from './currency';
import { p2pWagers } from './p2p';

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
    currency: currency('currency').notNull().default('CASH'),
    balanceAfterCents: bigint('balance_after_cents', { mode: 'bigint' }).notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    betId: uuid('bet_id').references(() => bets.id),
    /**
     * The wager this movement belongs to, for escrow, payout and refund entries. Sits
     * beside `betId` rather than replacing it: a wager is not a bet (D42), and an entry
     * carries at most one of the two.
     */
    p2pWagerId: uuid('p2p_wager_id').references(() => p2pWagers.id),
    note: text('note'),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ledger_entries_idempotency_key_idx').on(t.idempotencyKey),
    index('ledger_entries_membership_idx').on(t.membershipId, t.createdAt),
    index('ledger_entries_membership_currency_idx').on(t.membershipId, t.currency),
  ],
);
