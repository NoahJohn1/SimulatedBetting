import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { bets, seasonMemberships, users } from '@/db/schema';
import { computeMemberStats, type BetOutcomeRow, type MemberStats } from '@/domain/stats';

export interface MemberProfile {
  membershipId: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  status: 'PENDING' | 'APPROVED' | 'DISABLED';
  balanceCents: bigint;
  rank: number;
  stats: MemberStats;
}

/**
 * One member's profile, scoped to a season.
 *
 * Returns null when the membership is not in the given season, so a crafted URL cannot read
 * across leagues.
 *
 * The per-bet payout is summed from the ledger rather than stored on the bet: a bet's payout
 * is whatever its settlement entries say, and re-settlement (D15) appends reversals rather
 * than rewriting them. Summing everything except BET_PLACED gives the net returned, which is
 * exactly what `computeMemberStats` wants.
 */
export async function getMemberProfile(opts: {
  membershipId: string;
  seasonId: string;
}): Promise<MemberProfile | null> {
  const [row] = await db
    .select({
      membershipId: seasonMemberships.id,
      userId: users.id,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      status: users.status,
      balanceCents: seasonMemberships.balanceCents,
    })
    .from(seasonMemberships)
    .innerJoin(users, eq(seasonMemberships.userId, users.id))
    .where(
      and(
        eq(seasonMemberships.id, opts.membershipId),
        eq(seasonMemberships.seasonId, opts.seasonId),
      ),
    );

  if (!row) return null;

  const [{ ahead }] = await db
    .select({ ahead: sql<number>`count(*)::int` })
    .from(seasonMemberships)
    .where(
      and(
        eq(seasonMemberships.seasonId, opts.seasonId),
        sql`${seasonMemberships.balanceCents} > ${row.balanceCents}`,
      ),
    );

  // The correlated subquery is written with literal, qualified identifiers rather than
  // drizzle's `${table.column}` interpolation: those render column names unqualified inside
  // a raw sql fragment like this one, which is silently correct SQL that resolves both sides
  // of the correlation against ledger_entries alone — a real bug that surfaced as every
  // settled bet's payout reading back as 0. See docs/decisions.md D30.
  const betRows = await db
    .select({
      status: bets.status,
      stakeCents: bets.stakeCents,
      settledAt: bets.settledAt,
      returnedCents: sql<string>`COALESCE((
        SELECT SUM(ledger_entries.amount_cents)
        FROM ledger_entries
        WHERE ledger_entries.bet_id = bets.id
          AND ledger_entries.type <> 'BET_PLACED'
      ), 0)`,
    })
    .from(bets)
    .where(eq(bets.membershipId, opts.membershipId));

  const outcomes: BetOutcomeRow[] = betRows.map((bet) => ({
    status: bet.status,
    stakeCents: bet.stakeCents,
    payoutCents: BigInt(bet.returnedCents),
    settledAt: bet.settledAt,
  }));

  return {
    ...row,
    rank: ahead + 1,
    stats: computeMemberStats(outcomes),
  };
}
