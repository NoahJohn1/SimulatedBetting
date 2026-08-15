export interface PlaceBetLegInput {
  selectionId: string;
  /** Exactly the line the client displayed. null for moneyline. */
  line: string | null;
  /** Exactly the American price the client displayed. */
  priceAmerican: number;
}

export interface PlaceBetInput {
  userId: string;
  type: 'SINGLE' | 'PARLAY';
  stakeCents: bigint;
  legs: PlaceBetLegInput[];
  /** Client-generated UUID, stable across retries of the same submission. */
  clientRequestId: string;
}

export interface PlacedBet {
  id: string;
  type: 'SINGLE' | 'PARLAY';
  stakeCents: bigint;
  potentialPayoutCents: bigint;
  combinedPriceAmerican: number;
  balanceAfterCents: bigint;
  legs: { selectionId: string; line: string | null; priceAmerican: number }[];
}

export interface LineMovement {
  legIndex: number;
  selectionId: string;
  submittedLine: string | null;
  currentLine: string | null;
  submittedPrice: number;
  currentPrice: number;
}

export type PlaceBetError =
  | { code: 'NOT_APPROVED' }
  | { code: 'NO_ACTIVE_SEASON' }
  | { code: 'NOT_A_MEMBER' }
  | { code: 'UNKNOWN_SELECTION'; legIndex: number; selectionId: string }
  | { code: 'INVALID_LEG_VALUE'; legIndex: number; field: 'line' | 'priceAmerican' }
  | { code: 'INVALID_LEG_COUNT'; legCount: number; min: number; max: number }
  | { code: 'DUPLICATE_GAME'; gameId: string; legIndexes: number[] }
  | { code: 'GAME_NOT_BETTABLE'; legIndex: number; gameStatus: string; startsAt: string }
  | { code: 'MARKET_CLOSED'; legIndex: number; marketStatus: string }
  | { code: 'STAKE_BELOW_MINIMUM'; stakeCents: bigint; minimumCents: bigint }
  | { code: 'INSUFFICIENT_FUNDS'; stakeCents: bigint; balanceCents: bigint }
  | { code: 'LINE_MOVED'; movements: LineMovement[]; newPotentialPayoutCents: bigint }
  | { code: 'DUPLICATE_REQUEST'; betId: string };

export type PlaceBetResult =
  | { ok: true; bet: PlacedBet }
  | { ok: false; error: PlaceBetError };

/**
 * HTTP Status Mapping for PlaceBetError codes
 *
 * | Code | Status |
 * |---|---|
 * | `NOT_APPROVED`, `NOT_A_MEMBER`, `NO_ACTIVE_SEASON` | 403 |
 * | `LINE_MOVED` | 409 (spec: [Failure handling](../specs/2026-08-14-core-betting-engine-design.md#failure-handling)) |
 * | `DUPLICATE_REQUEST` | 200 with the existing bet |
 * | everything else | 422 |
 */
