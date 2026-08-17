/**
 * What a feed card renders, frozen at the moment the event happened.
 *
 * Money is a decimal string, never a JSON number: `JSON.stringify` throws on a `bigint` and
 * a `number` silently loses precision past 2^53. A string round-trips through `BigInt()`
 * exactly, which keeps D17 true inside jsonb as well as in columns (D25).
 */
export interface FeedLegSnapshot {
  sport: 'NFL' | 'NCAAF';
  marketType: 'MONEYLINE' | 'SPREAD' | 'TOTAL';
  side: 'HOME' | 'AWAY' | 'OVER' | 'UNDER';
  /** numeric(5,2) exactly as Drizzle returns it. Null for moneyline. */
  line: string | null;
  priceAmerican: number;
  homeAbbr: string;
  awayAbbr: string;
  startsAt: string;
}

/** A leg's graded outcome — the engine's `BetStatus` values minus `PENDING`. */
export type LegOutcome = 'WON' | 'LOST' | 'PUSHED' | 'VOIDED';

export interface BetPlacedPayload {
  betType: 'SINGLE' | 'PARLAY';
  stakeCents: string;
  potentialPayoutCents: string;
  combinedPriceAmerican: number;
  legs: FeedLegSnapshot[];
}

export interface BetSettledPayload extends BetPlacedPayload {
  outcome: 'WON' | 'LOST' | 'PUSHED' | 'VOIDED';
  /** "0" for a loss — the stake left the balance at placement and nothing comes back. */
  payoutCents: string;
  netCents: string;
  legOutcomes: LegOutcome[];
  settlementAttempt: number;
  correction: boolean;
}

export interface MemberJoinedPayload {
  startingBankrollCents: string;
  startingCreditsCents: string;
}

export interface AllowancePaidPayload {
  weekKey: string;
  memberCount: number;
  amountCents: string;
  creditAmountCents: string;
}

export interface AdminAdjustmentPayload {
  amountCents: string;
  note: string;
  adminDisplayName: string;
  currency: 'CASH' | 'CREDITS';
}

export interface LeadChangePayload {
  sequence: number;
  previousLeaderMembershipId: string | null;
  previousLeaderDisplayName: string | null;
  balanceCents: string;
  marginCents: string;
}

export interface BigWinPayload {
  stakeCents: string;
  payoutCents: string;
  /** payout × 10000 / stake, as integer BigInt division. 124000 renders as "12.4×". */
  multipleBasisPoints: number;
}

export interface ParlayHitPayload {
  legCount: number;
  payoutCents: string;
  combinedPriceAmerican: number;
}

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
