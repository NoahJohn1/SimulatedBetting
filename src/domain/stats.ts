import type { BetStatus } from '@/db/schema';

export interface BetOutcomeRow {
  status: BetStatus;
  stakeCents: bigint;
  /** What settlement returned. 0 for PENDING and for LOST. */
  payoutCents: bigint;
  settledAt: Date | null;
}

export interface MemberStats {
  pending: number;
  pendingStakeCents: bigint;
  settled: number;
  won: number;
  lost: number;
  pushed: number;
  voided: number;
  stakedCents: bigint;
  returnedCents: bigint;
  netCents: bigint;
  /** net × 10000 / staked, integer. Null when nothing was staked. */
  roiBasisPoints: number | null;
  currentStreak: { kind: 'W' | 'L' | 'NONE'; length: number };
  biggestWinCents: bigint;
}

/**
 * Season statistics for one member, from their bets.
 *
 * Three definitions worth knowing, each chosen over a defensible alternative:
 *
 * - VOIDED bets are excluded from `stakedCents`. The game never happened and the stake came
 *   back in full; counting it as action drags ROI toward zero for reasons that have nothing
 *   to do with betting.
 * - PUSHED bets are included in both staked and returned, so they are ROI-neutral rather
 *   than invisible. A push is a result — you had action and got your money back.
 * - Streaks count only WON and LOST. A push does not end a hot run.
 */
export function computeMemberStats(rows: BetOutcomeRow[]): MemberStats {
  const stats: MemberStats = {
    pending: 0,
    pendingStakeCents: 0n,
    settled: 0,
    won: 0,
    lost: 0,
    pushed: 0,
    voided: 0,
    stakedCents: 0n,
    returnedCents: 0n,
    netCents: 0n,
    roiBasisPoints: null,
    currentStreak: { kind: 'NONE', length: 0 },
    biggestWinCents: 0n,
  };

  for (const row of rows) {
    if (row.status === 'PENDING') {
      stats.pending += 1;
      stats.pendingStakeCents += row.stakeCents;
      continue;
    }

    stats.settled += 1;

    switch (row.status) {
      case 'WON': {
        stats.won += 1;
        const profit = row.payoutCents - row.stakeCents;
        if (profit > stats.biggestWinCents) stats.biggestWinCents = profit;
        break;
      }
      case 'LOST':
        stats.lost += 1;
        break;
      case 'PUSHED':
        stats.pushed += 1;
        break;
      case 'VOIDED':
        stats.voided += 1;
        break;
    }

    // A void is not action. Everything else is.
    if (row.status !== 'VOIDED') {
      stats.stakedCents += row.stakeCents;
      stats.returnedCents += row.payoutCents;
    }
  }

  stats.netCents = stats.returnedCents - stats.stakedCents;

  if (stats.stakedCents > 0n) {
    // Integer basis points, BigInt throughout — no float ever touches a money-derived value.
    stats.roiBasisPoints = Number((stats.netCents * 10_000n) / stats.stakedCents);
  }

  stats.currentStreak = computeStreak(rows);
  return stats;
}

/** Walks decided bets newest-first, skipping pushes and voids rather than breaking on them. */
function computeStreak(rows: BetOutcomeRow[]): MemberStats['currentStreak'] {
  const decided = rows
    .filter((row) => (row.status === 'WON' || row.status === 'LOST') && row.settledAt !== null)
    .sort((a, b) => b.settledAt!.getTime() - a.settledAt!.getTime());

  if (decided.length === 0) return { kind: 'NONE', length: 0 };

  const kind = decided[0].status === 'WON' ? 'W' : 'L';
  let length = 0;
  for (const row of decided) {
    const rowKind = row.status === 'WON' ? 'W' : 'L';
    if (rowKind !== kind) break;
    length += 1;
  }

  return { kind, length };
}
