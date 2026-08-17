import type { LegOutcome } from '@/server/feed/payload';

/** A win paying ten times the stake or better is worth telling the league about. */
export const BIG_WIN_MULTIPLE = 10n;

/** Four surviving legs is where a parlay stops being routine. */
export const PARLAY_HIT_MIN_LEGS = 4;

export function isBigWin(stakeCents: bigint, payoutCents: bigint): boolean {
  if (stakeCents <= 0n) return false;
  return payoutCents >= stakeCents * BIG_WIN_MULTIPLE;
}

/**
 * The payout multiple in integer basis points — 124000 means 12.4x.
 *
 * Basis points rather than a float because D17 holds for display values too: no
 * floating-point value goes anywhere near money, including in a card's headline.
 */
export function multipleBasisPoints(stakeCents: bigint, payoutCents: bigint): number {
  if (stakeCents <= 0n) return 0;
  return Number((payoutCents * 10_000n) / stakeCents);
}

/** Pushed and voided legs are removed from a parlay (D12), so they do not survive. */
export function survivingLegCount(legOutcomes: LegOutcome[]): number {
  return legOutcomes.filter((outcome) => outcome === 'WON' || outcome === 'LOST').length;
}

export function isParlayHit(
  betType: 'SINGLE' | 'PARLAY',
  outcome: string,
  legOutcomes: LegOutcome[],
): boolean {
  if (betType !== 'PARLAY' || outcome !== 'WON') return false;
  return survivingLegCount(legOutcomes) >= PARLAY_HIT_MIN_LEGS;
}

export interface LeaderRow {
  membershipId: string;
  balanceCents: bigint;
}

/**
 * The season's leader, or null when there isn't one.
 *
 * A tie at the top returns null on purpose. At season start every member holds the same
 * bankroll, and the feed should not open with a coin-flip "X takes the lead" that flips
 * again on the next sweep.
 */
export function pickLeader(rows: LeaderRow[]): LeaderRow | null {
  if (rows.length === 0) return null;

  let best = rows[0];
  let tied = false;

  for (const row of rows.slice(1)) {
    if (row.balanceCents > best.balanceCents) {
      best = row;
      tied = false;
    } else if (row.balanceCents === best.balanceCents) {
      tied = true;
    }
  }

  return tied ? null : best;
}
