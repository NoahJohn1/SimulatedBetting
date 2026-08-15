import { and, asc, eq, inArray } from 'drizzle-orm';
import { db, type Tx } from '@/db/client';
import { betLegs, bets, games, markets, selections } from '@/db/schema';
import type { BetStatus } from '@/db/schema';
import { gradeLeg, gradeParlay, settledPayoutCents } from '@/domain/grading';
import type { LegStatus } from '@/domain/grading';
import { lineToNumber } from '@/domain/line';
import type { LedgerEntryType } from '@/db/schema';
import { postEntry } from '@/server/money/ledger';

export interface SettleGameSummary {
  gameId: string;
  legsGraded: number;
  betsSettled: number;
  centsPaid: bigint;
}

/** The ledger entry a settled bet writes. LOST writes nothing — the stake left at placement. */
const ENTRY_TYPE_FOR_STATUS: Partial<Record<BetStatus, LedgerEntryType>> = {
  WON: 'BET_WON',
  PUSHED: 'BET_PUSHED',
  VOIDED: 'BET_VOIDED',
};

/**
 * Settles every pending leg on a finished game, then every bet those legs belong to.
 *
 * Legs are graded from their own frozen `lineAtPlacement` / `priceAtPlacement`, never from
 * the live `selections` row — the leg records what was offered, the selection records what
 * is offered now, and reading the wrong one is silent and shows up only as wrong money.
 */
export async function settleGame(gameId: string): Promise<SettleGameSummary> {
  return db.transaction(async (tx) => {
    const [game] = await tx.select().from(games).where(eq(games.id, gameId)).for('update');

    if (!game) throw new Error(`no game ${gameId}`);

    // FINAL grades from the score; POSTPONED and CANCELED void every pending leg without
    // consulting gradeLeg at all — there is no result to grade against.
    const voiding = game.status === 'POSTPONED' || game.status === 'CANCELED';
    if (game.status !== 'FINAL' && !voiding) {
      throw new Error(`game ${gameId} is ${game.status}, not settleable`);
    }
    if (!voiding && (game.homeScore === null || game.awayScore === null)) {
      throw new Error(`game ${gameId} is FINAL but has no score`);
    }

    const result = voiding
      ? null
      : { homeScore: game.homeScore as number, awayScore: game.awayScore as number };

    const pending = await tx
      .select({
        legId: betLegs.id,
        betId: betLegs.betId,
        line: betLegs.lineAtPlacement,
        marketType: markets.type,
        side: selections.side,
      })
      .from(betLegs)
      .innerJoin(selections, eq(betLegs.selectionId, selections.id))
      .innerJoin(markets, eq(selections.marketId, markets.id))
      .where(and(eq(markets.gameId, gameId), eq(betLegs.status, 'PENDING')));

    const settledAt = new Date();

    for (const leg of pending) {
      const status: BetStatus = result
        ? gradeLeg({
            marketType: leg.marketType,
            side: leg.side,
            line: lineToNumber(leg.line),
            result,
          })
        : 'VOIDED';
      await tx.update(betLegs).set({ status, settledAt }).where(eq(betLegs.id, leg.legId));
    }

    const summary: SettleGameSummary = {
      gameId,
      legsGraded: pending.length,
      betsSettled: 0,
      centsPaid: 0n,
    };

    const touchedBetIds = [...new Set(pending.map((leg) => leg.betId))];

    // Only bets still PENDING are candidates — a parlay that already lost on an earlier
    // game does not reopen because a later leg finally graded. Ordering by membership_id
    // keeps the lock order consistent with placement, so the two cannot deadlock.
    const candidates =
      touchedBetIds.length === 0
        ? []
        : await tx
            .select()
            .from(bets)
            .where(and(inArray(bets.id, touchedBetIds), eq(bets.status, 'PENDING')))
            .orderBy(asc(bets.membershipId));

    for (const bet of candidates) {
      const legs = await tx
        .select({
          status: betLegs.status,
          priceAtPlacement: betLegs.priceAtPlacement,
        })
        .from(betLegs)
        .where(eq(betLegs.betId, bet.id));

      const statuses = legs.map((leg) => leg.status as LegStatus);
      const parlayOutcome = gradeParlay(statuses);
      if (parlayOutcome === 'PENDING') continue;

      // gradeParlay returns PUSHED for an all-void bet, which is right for a parlay — the
      // stake comes back. A single whose only leg voided is more precisely VOIDED, and the
      // ledger entry follows the bet status.
      const outcome: BetStatus =
        parlayOutcome === 'PUSHED' && bet.type === 'SINGLE' && statuses.every((s) => s === 'VOIDED')
          ? 'VOIDED'
          : (parlayOutcome as BetStatus);

      const attempts = bet.settlementAttempts + 1;
      const payout = settledPayoutCents(
        bet.stakeCents,
        legs.map((leg) => ({
          status: leg.status as LegStatus,
          priceAmerican: leg.priceAtPlacement,
        })),
      );

      const entryType = ENTRY_TYPE_FOR_STATUS[outcome];
      if (entryType && payout > 0n) {
        await postEntry(tx, {
          membershipId: bet.membershipId,
          amountCents: payout,
          type: entryType,
          idempotencyKey: `bet:${bet.id}:settled:${attempts}`,
          betId: bet.id,
        });
        summary.centsPaid += payout;
      }

      await tx
        .update(bets)
        .set({ status: outcome, settledAt, settlementAttempts: attempts })
        .where(eq(bets.id, bet.id));

      summary.betsSettled += 1;
    }

    await tx.update(markets).set({ status: 'SETTLED' }).where(eq(markets.gameId, gameId));

    return summary;
  });
}
