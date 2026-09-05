import type { LedgerEntryType } from '@/db/schema/money';

/**
 * English copy for every `ledger_entry_type` enum value (Task 11). A raw enum string
 * reaching `/me` is a bug — `ledger-labels.test.ts` pins this map to the schema so a new
 * enum value fails the suite instead of leaking `LIKE_THIS` onto the screen.
 *
 * P2P copy reads from the wager's point of view, matching the `p2pWagerId` comment in
 * `src/db/schema/money.ts` ("escrow, payout and refund entries"): `P2P_ESCROW` is the stake
 * held when a wager is accepted, `P2P_WON` is that stake (and the opponent's) paid out to
 * the winner, `P2P_REFUND` is the stake returned when a wager falls through unmatched.
 */
export const LEDGER_LABELS: Record<LedgerEntryType, string> = {
  SEASON_STARTING_GRANT: 'Starting bankroll',
  WEEKLY_ALLOWANCE: 'Weekly allowance',
  BET_PLACED: 'Bet placed',
  BET_WON: 'Bet won',
  BET_PUSHED: 'Bet pushed',
  BET_VOIDED: 'Bet voided',
  ADMIN_CREDIT: 'Admin credit',
  ADMIN_DEBIT: 'Admin debit',
  SETTLEMENT_REVERSAL: 'Settlement reversal',
  P2P_ESCROW: 'Wager stake held',
  P2P_WON: 'Wager paid out',
  P2P_REFUND: 'Stake returned',
};
