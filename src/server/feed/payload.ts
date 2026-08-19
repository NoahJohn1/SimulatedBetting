/**
 * What a feed card renders, frozen at the moment the event happened.
 *
 * Money is a decimal string, never a JSON number: `JSON.stringify` throws on a `bigint` and
 * a `number` silently loses precision past 2^53. A string round-trips through `BigInt()`
 * exactly, which keeps D17 true inside jsonb as well as in columns (D25).
 */
export interface GameLegSnapshot {
  kind: 'GAME';
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

export interface CustomLegSnapshot {
  kind: 'CUSTOM';
  eventTitle: string;
  marketTitle: string;
  outcomeLabel: string;
  priceAmerican: number;
  startsAt: string;
  /** True when the bettor is the member who created and will resolve this event (D32). */
  byCreator: boolean;
}

export type FeedLegSnapshot = GameLegSnapshot | CustomLegSnapshot;

/** A leg's graded outcome — the engine's `BetStatus` values minus `PENDING`. */
export type LegOutcome = 'WON' | 'LOST' | 'PUSHED' | 'VOIDED';

export interface BetPlacedPayload {
  betType: 'SINGLE' | 'PARLAY';
  currency: 'CASH' | 'CREDITS';
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
  /**
   * Optional only for rows written before credits existed: every one of those was a cash
   * bet, so the card reads them as CASH. New rows always carry it.
   */
  currency?: 'CASH' | 'CREDITS';
}

export interface ParlayHitPayload {
  legCount: number;
  payoutCents: string;
  combinedPriceAmerican: number;
  /** Optional for pre-credits rows, exactly as on `BigWinPayload`. */
  currency?: 'CASH' | 'CREDITS';
}

export interface CustomEventCreatedPayload {
  eventId: string;
  title: string;
  marketCount: number;
  startsAt: string;
  resolvesBy: string;
}

export interface CustomEventResolvedPayload {
  eventId: string;
  title: string;
  /** One entry per market, in the creator's market order. */
  outcomes: { marketTitle: string; winningLabel: string }[];
  note: string | null;
  attempt: number;
  /** True from the second resolution onward — an admin correcting a disputed call. */
  correction: boolean;
  resolvedByDisplayName: string;
}

export interface CustomEventDisputedPayload {
  eventId: string;
  title: string;
  reason: string;
}

export interface CustomEventVoidedPayload {
  eventId: string;
  title: string;
  note: string;
  refundedBetCount: number;
  refundedCreditsCents: string;
  adminDisplayName: string;
}

export interface CustomEventOverduePayload {
  eventId: string;
  title: string;
  resolvesBy: string;
  openBetCount: number;
}

/**
 * A wager's one-line subject: the freeform description, or a rendering of the selection for
 * a market-backed wager ("KC -3.5 vs BUF"). Frozen at write time like every other payload
 * fact, so a later line move cannot rewrite what the card said.
 */
export interface P2POfferedPayload {
  wagerId: string;
  kind: 'MARKET' | 'FREEFORM';
  offererStakeCents: string;
  acceptorStakeCents: string;
  potCents: string;
  /** The freeform text, for a FREEFORM wager. Null for MARKET. */
  description: string | null;
  /** The rendered selection, for a MARKET wager. Null for FREEFORM. */
  subject: string | null;
  /** True when the offer names an opponent rather than being open to the season. */
  directed: boolean;
  expiresAt: string;
}

export interface P2PAcceptedPayload {
  wagerId: string;
  kind: 'MARKET' | 'FREEFORM';
  potCents: string;
  offererStakeCents: string;
  acceptorStakeCents: string;
  /** The description or the rendered selection, whichever this wager has. */
  subject: string;
}

export interface P2PSettledPayload {
  wagerId: string;
  kind: 'MARKET' | 'FREEFORM';
  verdict: 'OFFERER' | 'ACCEPTOR' | 'VOID';
  potCents: string;
  subject: string;
  attempt: number;
  /** True from the second attempt onward — an admin correcting an earlier settlement. */
  correction: boolean;
  /** True when an admin decided it rather than the two parties agreeing. */
  byArbitration: boolean;
}

export interface P2PDisputedPayload {
  wagerId: string;
  subject: string;
  attempt: number;
}

/** Why both stakes came back. Determines the card's wording and nothing else. */
export type P2PVoidReason = 'MUTUAL_CANCEL' | 'EVENT_DEAD' | 'ARBITRATED' | 'AGREED_VOID';

export interface P2PVoidedPayload {
  wagerId: string;
  subject: string;
  reason: P2PVoidReason;
  refundedCents: string;
  attempt: number;
  /** The arbitration note, when an admin decided it. Null otherwise. */
  note: string | null;
  /** Set only for ARBITRATED, matching how CustomEventVoidedPayload names the admin. */
  adminDisplayName: string | null;
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
  | ParlayHitPayload
  | CustomEventCreatedPayload
  | CustomEventResolvedPayload
  | CustomEventDisputedPayload
  | CustomEventVoidedPayload
  | CustomEventOverduePayload
  | P2POfferedPayload
  | P2PAcceptedPayload
  | P2PSettledPayload
  | P2PDisputedPayload
  | P2PVoidedPayload;
