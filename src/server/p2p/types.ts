import type { P2PVerdict, P2PWagerKind, P2PWagerStatus } from '@/db/schema';

export type { P2PVerdict, P2PWagerKind, P2PWagerStatus };

export interface OfferWagerInput {
  actorUserId: string;
  kind: P2PWagerKind;
  /** Null or omitted means the offer is open to the season. */
  opponentMembershipId?: string | null;
  offererStakeCents: bigint;
  acceptorStakeCents: bigint;
  /** MARKET only. */
  selectionId?: string;
  /** FREEFORM only. */
  description?: string;
  expiresAt: Date;
  resolvesBy: Date;
  now?: Date;
}

export type OfferWagerError =
  | { code: 'NOT_A_MEMBER' }
  | { code: 'INVALID_STAKE'; side: 'OFFERER' | 'ACCEPTOR' }
  | { code: 'INSUFFICIENT_CREDITS'; availableCents: bigint }
  | { code: 'OPPONENT_IS_SELF' }
  | { code: 'OPPONENT_NOT_IN_SEASON' }
  | { code: 'INVALID_WINDOW' }
  | { code: 'WRONG_KIND_FIELDS' }
  | { code: 'SELECTION_NOT_FOUND' }
  | { code: 'MARKET_NOT_OPEN' }
  | { code: 'EVENT_ALREADY_STARTED' };

export type OfferWagerResult =
  | { ok: true; wagerId: string; creditsBalanceCents: bigint }
  | { ok: false; error: OfferWagerError };

export interface CancelOfferInput {
  wagerId: string;
  actorUserId: string;
  now?: Date;
}

export type CancelOfferError =
  | { code: 'WAGER_NOT_FOUND' }
  | { code: 'WAGER_NOT_OPEN'; status: P2PWagerStatus }
  | { code: 'NOT_AUTHORIZED' };

export type CancelOfferResult =
  | { ok: true; refundedCents: bigint }
  | { ok: false; error: CancelOfferError };

export interface AcceptWagerInput {
  wagerId: string;
  actorUserId: string;
  now?: Date;
}

export type AcceptWagerError =
  | { code: 'WAGER_NOT_FOUND' }
  | { code: 'WAGER_NOT_OPEN'; status: P2PWagerStatus }
  | { code: 'OFFER_EXPIRED' }
  | { code: 'NOT_A_MEMBER' }
  | { code: 'NOT_THE_INVITED_OPPONENT' }
  | { code: 'CANNOT_ACCEPT_OWN_OFFER' }
  | { code: 'INSUFFICIENT_CREDITS'; availableCents: bigint };

export type AcceptWagerResult =
  | { ok: true; wagerId: string; creditsBalanceCents: bigint }
  | { ok: false; error: AcceptWagerError };

export interface ClaimWinnerInput {
  wagerId: string;
  actorUserId: string;
  verdict: P2PVerdict;
  now?: Date;
}

export type ClaimError =
  | { code: 'WAGER_NOT_FOUND' }
  | { code: 'WAGER_NOT_ACCEPTED'; status: P2PWagerStatus }
  | { code: 'NOT_A_PARTY' };

export type ClaimWinnerResult =
  | {
      ok: true;
      /** AWAITING_OTHER: recorded, nothing else happened yet. */
      outcome: 'AWAITING_OTHER' | 'SETTLED' | 'DISPUTED';
      verdict: P2PVerdict | null;
      paidCents: bigint;
    }
  | { ok: false; error: ClaimError };

export interface ProposeCancelInput {
  wagerId: string;
  actorUserId: string;
  now?: Date;
}

export type ProposeCancelResult =
  | { ok: true; outcome: 'AWAITING_OTHER' | 'VOIDED'; refundedCents: bigint }
  | { ok: false; error: ClaimError };

export interface ArbitrateWagerInput {
  wagerId: string;
  actorUserId: string;
  verdict: P2PVerdict;
  /** Mandatory. An arbitration moves money, so it says who and why (D15). */
  note: string;
  now?: Date;
}

export type ArbitrateError =
  | { code: 'WAGER_NOT_FOUND' }
  | { code: 'NOTE_REQUIRED' }
  | { code: 'NOT_ARBITRABLE'; status: P2PWagerStatus };

export type ArbitrateWagerResult =
  | { ok: true; attempt: number; paidCents: bigint }
  | { ok: false; error: ArbitrateError };
