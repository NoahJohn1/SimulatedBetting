import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Tx } from '@/db/client';
import { db } from '@/db/client';
import {
  betLegs,
  bets,
  customEvents,
  events,
  games,
  ledgerEntries,
  markets,
  seasonMemberships,
  selections,
  teams,
} from '@/db/schema';
import type { BetStatus, LedgerEntryType } from '@/db/schema';
import { gradeLeg, gradeParlay, settledPayoutCents } from '@/domain/grading';
import type { LegStatus, MarketType, Side } from '@/domain/grading';
import { gradeCustomLeg } from '@/domain/custom-grading';
import { lineToNumber } from '@/domain/line';
import { isBigWin, isParlayHit, multipleBasisPoints, survivingLegCount } from '@/domain/milestones';
import { emitFeedEvent } from '@/server/feed/emit';
import { buildCustomLegSnapshot, buildLegSnapshot } from '@/server/feed/snapshot';
import type {
  BetSettledPayload,
  BigWinPayload,
  FeedLegSnapshot,
  LegOutcome,
  ParlayHitPayload,
} from '@/server/feed/payload';
import { postEntry } from '@/server/money/ledger';

const homeTeams = alias(teams, 'resettle_home_teams');
const awayTeams = alias(teams, 'resettle_away_teams');

/**
 * Re-settlement only ever grades legs on sports markets — see settleGame's identical guard.
 */
function toSportsLeg<T extends { marketType: string; side: string | null }>(
  leg: T,
): T & { marketType: MarketType; side: Side } {
  if (leg.marketType === 'CUSTOM_OUTCOME' || leg.side === null) {
    throw new Error('resettleBet: expected a sports market/selection, not a custom-outcome one');
  }
  return leg as T & { marketType: MarketType; side: Side };
}

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
 * Admin-triggered re-settlement after a score correction (or, for a custom event, an admin
 * re-resolution). Never automatic on a score change.
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
  return db.transaction((tx) => resettleBetInTx(tx, input));
}

/**
 * The body of `resettleBet`, callable from an already-open transaction.
 *
 * This exists because `resolveCustomEvent` needs to reverse and re-pay bets from inside its
 * own transaction: calling the `resettleBet` wrapper there would open a second database
 * connection that then blocks forever on the row locks the outer transaction already holds —
 * a nested `db.transaction(...)` is not a savepoint here.
 */
export async function resettleBetInTx(tx: Tx, input: ResettleBetInput): Promise<ResettleBetResult> {
  const [bet] = await tx.select().from(bets).where(eq(bets.id, input.betId)).for('update');

  if (!bet) return { ok: false as const, error: { code: 'BET_NOT_FOUND' as const } };
  if (bet.status === 'PENDING') {
    return { ok: false as const, error: { code: 'BET_STILL_PENDING' as const } };
  }

  const attempt = bet.settlementAttempts + 1;

  // Everything this bet has been paid so far, excluding the stake that left at placement.
  // Filtered by currency too, so a bet can never reverse against the wrong denomination.
  const [{ netPaid }] = await tx
    .select({ netPaid: sql<string>`COALESCE(SUM(${ledgerEntries.amountCents}), 0)` })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.betId, bet.id),
        eq(ledgerEntries.currency, bet.currency),
        ne(ledgerEntries.type, 'BET_PLACED'),
      ),
    );

  const reversedCents = BigInt(netPaid);
  if (reversedCents !== 0n) {
    await postEntry(tx, {
      membershipId: bet.membershipId,
      amountCents: -reversedCents,
      type: 'SETTLEMENT_REVERSAL',
      currency: bet.currency,
      idempotencyKey: `bet:${bet.id}:reversal:${attempt}`,
      actorUserId: input.actorUserId,
      betId: bet.id,
      note: input.note,
    });
  }

  // The season id needs its own small read: `bet` was loaded with `.for('update')`, and
  // Postgres will not take a `FOR UPDATE` lock through an outer-joined query.
  const [membership] = await tx
    .select({ seasonId: seasonMemberships.seasonId })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, bet.membershipId));

  const settledAt = new Date();
  const regraded: { status: LegStatus; priceAmerican: number }[] = [];
  let snapshots: FeedLegSnapshot[] = [];

  if (bet.currency === 'CASH') {
    // Re-grade every leg from the games' current scores.
    const legs = (
      await tx
        .select({
          legId: betLegs.id,
          line: betLegs.lineAtPlacement,
          priceAtPlacement: betLegs.priceAtPlacement,
          marketType: markets.type,
          side: selections.side,
          gameStatus: games.status,
          homeScore: games.homeScore,
          awayScore: games.awayScore,
          sport: games.sport,
          startsAt: games.startsAt,
          homeAbbr: homeTeams.abbreviation,
          awayAbbr: awayTeams.abbreviation,
        })
        .from(betLegs)
        .innerJoin(selections, eq(betLegs.selectionId, selections.id))
        .innerJoin(markets, eq(selections.marketId, markets.id))
        .innerJoin(games, eq(markets.eventId, games.eventId))
        .innerJoin(homeTeams, eq(games.homeTeamId, homeTeams.id))
        .innerJoin(awayTeams, eq(games.awayTeamId, awayTeams.id))
        .where(eq(betLegs.betId, bet.id))
        .orderBy(asc(betLegs.createdAt))
    ).map(toSportsLeg);

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

    snapshots = legs.map((leg) =>
      buildLegSnapshot(leg, { line: leg.line, priceAmerican: leg.priceAtPlacement }),
    );
  } else {
    // Re-grade every leg from the custom market's (possibly newly-corrected) winner.
    const legs = await tx
      .select({
        legId: betLegs.id,
        selectionId: betLegs.selectionId,
        priceAtPlacement: betLegs.priceAtPlacement,
        label: selections.label,
        marketTitle: markets.title,
        winningSelectionId: markets.winningSelectionId,
        eventTitle: events.title,
        eventStartsAt: events.startsAt,
        customStatus: customEvents.status,
        creatorMembershipId: customEvents.creatorMembershipId,
      })
      .from(betLegs)
      .innerJoin(selections, eq(betLegs.selectionId, selections.id))
      .innerJoin(markets, eq(selections.marketId, markets.id))
      .innerJoin(events, eq(markets.eventId, events.id))
      .innerJoin(customEvents, eq(customEvents.eventId, events.id))
      .where(eq(betLegs.betId, bet.id))
      .orderBy(asc(betLegs.createdAt));

    for (const leg of legs) {
      // A voided event voids its legs; otherwise grade against the stored winner.
      const status: LegStatus =
        leg.customStatus === 'VOIDED'
          ? 'VOIDED'
          : gradeCustomLeg({
              selectionId: leg.selectionId,
              winningSelectionId: leg.winningSelectionId,
            });

      await tx.update(betLegs).set({ status, settledAt }).where(eq(betLegs.id, leg.legId));
      regraded.push({ status, priceAmerican: leg.priceAtPlacement });
    }

    snapshots = legs.map((leg) =>
      buildCustomLegSnapshot(
        {
          eventTitle: leg.eventTitle,
          marketTitle: leg.marketTitle ?? '',
          outcomeLabel: leg.label ?? '',
          startsAt: leg.eventStartsAt,
          byCreator: leg.creatorMembershipId === bet.membershipId,
        },
        { priceAmerican: leg.priceAtPlacement },
      ),
    );
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
        currency: bet.currency,
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

  // Guarded exactly like the payout block above: unlike settleGame's structural `continue`
  // on PENDING, resettleBet has no such guarantee — a leg's game can revert away from FINAL
  // between attempts, and this is the only thing standing between that case and a
  // BET_SETTLED card lying about a bet that is still PENDING. The guard also narrows
  // `newStatus` to exactly BetSettledPayload['outcome'], so no unsafe cast is needed below.
  if (newStatus !== 'PENDING') {
    const legOutcomes = regraded.map((leg) => leg.status as LegOutcome);

    const settledPayload: BetSettledPayload = {
      betType: bet.type,
      currency: bet.currency,
      stakeCents: bet.stakeCents.toString(),
      potentialPayoutCents: bet.potentialPayoutCents.toString(),
      combinedPriceAmerican: bet.combinedPriceAmerican,
      legs: snapshots,
      outcome: newStatus,
      payoutCents: paidCents.toString(),
      netCents: (paidCents - bet.stakeCents).toString(),
      legOutcomes,
      settlementAttempt: attempt,
      // Always true here: a bet's first-ever settlement never goes through resettleBet.
      correction: attempt > 1,
    };

    await emitFeedEvent(tx, {
      seasonId: membership.seasonId,
      type: 'BET_SETTLED',
      subjectMembershipId: bet.membershipId,
      betId: bet.id,
      dedupeKey: `bet:${bet.id}:settled:${attempt}`,
      payload: settledPayload,
      occurredAt: settledAt,
    });

    if (newStatus === 'WON' && isBigWin(bet.stakeCents, paidCents)) {
      const bigWin: BigWinPayload = {
        stakeCents: bet.stakeCents.toString(),
        payoutCents: paidCents.toString(),
        multipleBasisPoints: multipleBasisPoints(bet.stakeCents, paidCents),
        currency: bet.currency,
      };
      await emitFeedEvent(tx, {
        seasonId: membership.seasonId,
        type: 'MILESTONE_BIG_WIN',
        subjectMembershipId: bet.membershipId,
        betId: bet.id,
        dedupeKey: `bet:${bet.id}:bigwin:${attempt}`,
        payload: bigWin,
        occurredAt: settledAt,
      });
    }

    if (isParlayHit(bet.type, newStatus, legOutcomes)) {
      const parlayHit: ParlayHitPayload = {
        legCount: survivingLegCount(legOutcomes),
        payoutCents: paidCents.toString(),
        combinedPriceAmerican: bet.combinedPriceAmerican,
        currency: bet.currency,
      };
      await emitFeedEvent(tx, {
        seasonId: membership.seasonId,
        type: 'MILESTONE_PARLAY_HIT',
        subjectMembershipId: bet.membershipId,
        betId: bet.id,
        dedupeKey: `bet:${bet.id}:parlayhit:${attempt}`,
        payload: parlayHit,
        occurredAt: settledAt,
      });
    }
  }

  return {
    ok: true as const,
    previousStatus: bet.status,
    newStatus,
    reversedCents,
    paidCents,
    attempt,
  };
}
