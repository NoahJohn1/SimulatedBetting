import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { betLegs, bets, seasonMemberships, type BetStatus, type Currency, type LedgerEntryType } from '@/db/schema';
import { gradeParlay, settledPayoutCents } from '@/domain/grading';
import type { LegStatus } from '@/domain/grading';
import { isBigWin, isParlayHit, multipleBasisPoints, survivingLegCount } from '@/domain/milestones';
import { emitFeedEvent } from '@/server/feed/emit';
import { postEntry } from '@/server/money/ledger';
import type { BetSettledPayload, BigWinPayload, FeedLegSnapshot, LegOutcome, ParlayHitPayload } from '@/server/feed/payload';

const ENTRY_TYPE_FOR_STATUS: Partial<Record<BetStatus, LedgerEntryType>> = {
  WON: 'BET_WON',
  PUSHED: 'BET_PUSHED',
  VOIDED: 'BET_VOIDED',
};

export interface SettleBetsSummary {
  betsSettled: number;
  centsPaid: bigint;
}

/**
 * Grades and pays every still-pending bet among `betIds`, using leg statuses already
 * written by the caller.
 *
 * `snapshotLegs` is injected rather than queried here because a game leg and a custom leg
 * build their card from entirely different joins. Everything else — the parlay rule, the
 * payout arithmetic, the idempotency key, the milestone thresholds — is identical for both
 * kinds, and identical to what subsystem 1 already did.
 */
export async function settleBetsForLegs(
  tx: Tx,
  input: {
    betIds: string[];
    settledAt: Date;
    snapshotLegs: (betId: string) => Promise<{
      statuses: LegStatus[];
      prices: number[];
      snapshots: FeedLegSnapshot[];
    }>;
  },
): Promise<SettleBetsSummary> {
  const summary: SettleBetsSummary = { betsSettled: 0, centsPaid: 0n };
  if (input.betIds.length === 0) return summary;

  const candidates = await tx
    .select({
      id: bets.id,
      membershipId: bets.membershipId,
      seasonId: seasonMemberships.seasonId,
      type: bets.type,
      currency: bets.currency,
      stakeCents: bets.stakeCents,
      potentialPayoutCents: bets.potentialPayoutCents,
      combinedPriceAmerican: bets.combinedPriceAmerican,
      settlementAttempts: bets.settlementAttempts,
    })
    .from(bets)
    .innerJoin(seasonMemberships, eq(bets.membershipId, seasonMemberships.id))
    .where(and(inArray(bets.id, input.betIds), eq(bets.status, 'PENDING')))
    .orderBy(asc(bets.membershipId));

  for (const bet of candidates) {
    const { statuses, prices, snapshots } = await input.snapshotLegs(bet.id);

    const parlayOutcome = gradeParlay(statuses);
    if (parlayOutcome === 'PENDING') continue;

    const outcome: BetStatus =
      parlayOutcome === 'PUSHED' && bet.type === 'SINGLE' && statuses.every((s) => s === 'VOIDED')
        ? 'VOIDED'
        : (parlayOutcome as BetStatus);

    const attempts = bet.settlementAttempts + 1;
    const payout = settledPayoutCents(
      bet.stakeCents,
      statuses.map((status, i) => ({ status, priceAmerican: prices[i] })),
    );

    const entryType = ENTRY_TYPE_FOR_STATUS[outcome];
    if (entryType && payout > 0n) {
      await postEntry(tx, {
        membershipId: bet.membershipId,
        amountCents: payout,
        type: entryType,
        currency: bet.currency as Currency,
        idempotencyKey: `bet:${bet.id}:settled:${attempts}`,
        betId: bet.id,
      });
      summary.centsPaid += payout;
    }

    await tx
      .update(bets)
      .set({ status: outcome, settledAt: input.settledAt, settlementAttempts: attempts })
      .where(eq(bets.id, bet.id));

    const legOutcomes = statuses as LegOutcome[];

    const settledPayload: BetSettledPayload = {
      betType: bet.type,
      currency: bet.currency as Currency,
      stakeCents: bet.stakeCents.toString(),
      potentialPayoutCents: bet.potentialPayoutCents.toString(),
      combinedPriceAmerican: bet.combinedPriceAmerican,
      legs: snapshots,
      outcome: outcome as BetSettledPayload['outcome'],
      payoutCents: payout.toString(),
      netCents: (payout - bet.stakeCents).toString(),
      legOutcomes,
      settlementAttempt: attempts,
      correction: attempts > 1,
    };

    await emitFeedEvent(tx, {
      seasonId: bet.seasonId,
      type: 'BET_SETTLED',
      subjectMembershipId: bet.membershipId,
      betId: bet.id,
      dedupeKey: `bet:${bet.id}:settled:${attempts}`,
      payload: settledPayload,
      occurredAt: input.settledAt,
    });

    if (outcome === 'WON' && isBigWin(bet.stakeCents, payout)) {
      const bigWin: BigWinPayload = {
        stakeCents: bet.stakeCents.toString(),
        payoutCents: payout.toString(),
        multipleBasisPoints: multipleBasisPoints(bet.stakeCents, payout),
      };
      await emitFeedEvent(tx, {
        seasonId: bet.seasonId,
        type: 'MILESTONE_BIG_WIN',
        subjectMembershipId: bet.membershipId,
        betId: bet.id,
        dedupeKey: `bet:${bet.id}:bigwin:${attempts}`,
        payload: bigWin,
        occurredAt: input.settledAt,
      });
    }

    if (isParlayHit(bet.type, outcome, legOutcomes)) {
      const parlayHit: ParlayHitPayload = {
        legCount: survivingLegCount(legOutcomes),
        payoutCents: payout.toString(),
        combinedPriceAmerican: bet.combinedPriceAmerican,
      };
      await emitFeedEvent(tx, {
        seasonId: bet.seasonId,
        type: 'MILESTONE_PARLAY_HIT',
        subjectMembershipId: bet.membershipId,
        betId: bet.id,
        dedupeKey: `bet:${bet.id}:parlayhit:${attempts}`,
        payload: parlayHit,
        occurredAt: input.settledAt,
      });
    }

    summary.betsSettled += 1;
  }

  return summary;
}
