import { and, eq, ne, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { betLegs, bets, games, ledgerEntries, markets, selections } from '@/db/schema';
import type { BetStatus, LedgerEntryType } from '@/db/schema';
import { gradeLeg, gradeParlay, settledPayoutCents } from '@/domain/grading';
import type { LegStatus } from '@/domain/grading';
import { lineToNumber } from '@/domain/line';
import { postEntry } from '@/server/money/ledger';

export interface ResettleBetInput {
  betId: string;
  actorUserId: string;
  /** Required — D15's audit trail. A correction always says who and why. */
  note: string;
}

export type ResettleBetResult =
  | {
      ok: true;
      previousStatus: BetStatus;
      newStatus: BetStatus;
      reversedCents: bigint;
      paidCents: bigint;
      attempt: number;
    }
  | { ok: false; error: { code: 'BET_NOT_FOUND' | 'BET_STILL_PENDING' | 'NOTE_REQUIRED' } };

const ENTRY_TYPE_FOR_STATUS: Partial<Record<BetStatus, LedgerEntryType>> = {
  WON: 'BET_WON',
  PUSHED: 'BET_PUSHED',
  VOIDED: 'BET_VOIDED',
};

/**
 * Admin-triggered re-settlement after a score correction. Never automatic on a score change.
 *
 * History is never edited (D15): this appends a reversal of whatever the previous settlement
 * paid, then the corrected entry. It is therefore not idempotent in the ledger — running it
 * twice with no score change appends two rows that net to zero — and that is the intended
 * behaviour, not a bug to fix.
 *
 * BET_PLACED is never reversed (A-D10). The stake genuinely left the balance at placement,
 * and the corrected settlement entry already accounts for it.
 */
export async function resettleBet(input: ResettleBetInput): Promise<ResettleBetResult> {
  if (!input.note.trim()) {
    return { ok: false, error: { code: 'NOTE_REQUIRED' } };
  }

  return db.transaction(async (tx) => {
    const [bet] = await tx.select().from(bets).where(eq(bets.id, input.betId)).for('update');

    if (!bet) return { ok: false as const, error: { code: 'BET_NOT_FOUND' as const } };
    if (bet.status === 'PENDING') {
      return { ok: false as const, error: { code: 'BET_STILL_PENDING' as const } };
    }

    const attempt = bet.settlementAttempts + 1;

    // Everything this bet has been paid so far, excluding the stake that left at placement.
    const [{ netPaid }] = await tx
      .select({ netPaid: sql<string>`COALESCE(SUM(${ledgerEntries.amountCents}), 0)` })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.betId, bet.id), ne(ledgerEntries.type, 'BET_PLACED')));

    const reversedCents = BigInt(netPaid);
    if (reversedCents !== 0n) {
      await postEntry(tx, {
        membershipId: bet.membershipId,
        amountCents: -reversedCents,
        type: 'SETTLEMENT_REVERSAL',
        idempotencyKey: `bet:${bet.id}:reversal:${attempt}`,
        actorUserId: input.actorUserId,
        betId: bet.id,
        note: input.note,
      });
    }

    // Re-grade every leg from the games' current scores.
    const legs = await tx
      .select({
        legId: betLegs.id,
        line: betLegs.lineAtPlacement,
        priceAtPlacement: betLegs.priceAtPlacement,
        marketType: markets.type,
        side: selections.side,
        gameStatus: games.status,
        homeScore: games.homeScore,
        awayScore: games.awayScore,
      })
      .from(betLegs)
      .innerJoin(selections, eq(betLegs.selectionId, selections.id))
      .innerJoin(markets, eq(selections.marketId, markets.id))
      .innerJoin(games, eq(markets.gameId, games.id))
      .where(eq(betLegs.betId, bet.id));

    const settledAt = new Date();
    const regraded: { status: LegStatus; priceAmerican: number }[] = [];

    for (const leg of legs) {
      const voided = leg.gameStatus === 'POSTPONED' || leg.gameStatus === 'CANCELED';
      const gradable =
        leg.gameStatus === 'FINAL' && leg.homeScore !== null && leg.awayScore !== null;

      const status: LegStatus = voided
        ? 'VOIDED'
        : gradable
          ? gradeLeg({
              marketType: leg.marketType,
              side: leg.side,
              line: lineToNumber(leg.line),
              result: { homeScore: leg.homeScore as number, awayScore: leg.awayScore as number },
            })
          : 'PENDING';

      await tx.update(betLegs).set({ status, settledAt }).where(eq(betLegs.id, leg.legId));
      regraded.push({ status, priceAmerican: leg.priceAtPlacement });
    }

    const parlayOutcome = gradeParlay(regraded.map((leg) => leg.status));
    const newStatus: BetStatus =
      parlayOutcome === 'PUSHED' &&
      bet.type === 'SINGLE' &&
      regraded.every((leg) => leg.status === 'VOIDED')
        ? 'VOIDED'
        : (parlayOutcome as BetStatus);

    let paidCents = 0n;
    if (newStatus !== 'PENDING') {
      const payout = settledPayoutCents(bet.stakeCents, regraded);
      const entryType = ENTRY_TYPE_FOR_STATUS[newStatus];
      if (entryType && payout > 0n) {
        await postEntry(tx, {
          membershipId: bet.membershipId,
          amountCents: payout,
          type: entryType,
          idempotencyKey: `bet:${bet.id}:settled:${attempt}`,
          actorUserId: input.actorUserId,
          betId: bet.id,
          note: input.note,
        });
        paidCents = payout;
      }
    }

    await tx
      .update(bets)
      .set({
        status: newStatus,
        settledAt,
        settlementAttempts: attempt,
      })
      .where(eq(bets.id, bet.id));

    return {
      ok: true as const,
      previousStatus: bet.status,
      newStatus,
      reversedCents,
      paidCents,
      attempt,
    };
  });
}
