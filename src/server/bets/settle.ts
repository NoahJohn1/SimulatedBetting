import { and, asc, eq, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '@/db/client';
import { betLegs, bets, games, markets, seasonMemberships, selections, teams } from '@/db/schema';
import type { BetStatus } from '@/db/schema';
import { gradeLeg, gradeParlay, settledPayoutCents } from '@/domain/grading';
import type { LegStatus } from '@/domain/grading';
import { lineToNumber } from '@/domain/line';
import { isBigWin, isParlayHit, multipleBasisPoints, survivingLegCount } from '@/domain/milestones';
import type { LedgerEntryType } from '@/db/schema';
import { postEntry } from '@/server/money/ledger';
import { emitFeedEvent } from '@/server/feed/emit';
import { buildLegSnapshot } from '@/server/feed/snapshot';
import type {
  BetSettledPayload,
  BigWinPayload,
  LegOutcome,
  ParlayHitPayload,
} from '@/server/feed/payload';

const homeTeams = alias(teams, 'settle_home_teams');
const awayTeams = alias(teams, 'settle_away_teams');

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
            .select({
              id: bets.id,
              membershipId: bets.membershipId,
              seasonId: seasonMemberships.seasonId,
              type: bets.type,
              stakeCents: bets.stakeCents,
              potentialPayoutCents: bets.potentialPayoutCents,
              combinedPriceAmerican: bets.combinedPriceAmerican,
              settlementAttempts: bets.settlementAttempts,
            })
            .from(bets)
            .innerJoin(seasonMemberships, eq(bets.membershipId, seasonMemberships.id))
            .where(and(inArray(bets.id, touchedBetIds), eq(bets.status, 'PENDING')))
            .orderBy(asc(bets.membershipId));

    for (const bet of candidates) {
      const legs = await tx
        .select({
          status: betLegs.status,
          priceAtPlacement: betLegs.priceAtPlacement,
          lineAtPlacement: betLegs.lineAtPlacement,
          marketType: markets.type,
          side: selections.side,
          sport: games.sport,
          startsAt: games.startsAt,
          homeAbbr: homeTeams.abbreviation,
          awayAbbr: awayTeams.abbreviation,
        })
        .from(betLegs)
        .innerJoin(selections, eq(betLegs.selectionId, selections.id))
        .innerJoin(markets, eq(selections.marketId, markets.id))
        .innerJoin(games, eq(markets.gameId, games.id))
        .innerJoin(homeTeams, eq(games.homeTeamId, homeTeams.id))
        .innerJoin(awayTeams, eq(games.awayTeamId, awayTeams.id))
        .where(eq(betLegs.betId, bet.id))
        .orderBy(asc(betLegs.createdAt));

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

      const legOutcomes = legs.map((leg) => leg.status as LegOutcome);

      const settledPayload: BetSettledPayload = {
        betType: bet.type,
        stakeCents: bet.stakeCents.toString(),
        potentialPayoutCents: bet.potentialPayoutCents.toString(),
        combinedPriceAmerican: bet.combinedPriceAmerican,
        legs: legs.map((leg) =>
          buildLegSnapshot(leg, { line: leg.lineAtPlacement, priceAmerican: leg.priceAtPlacement }),
        ),
        // `outcome` is typed BetStatus (includes PENDING) for the ledger/grading logic above,
        // but the `continue` on parlayOutcome === 'PENDING' guarantees it can't be PENDING
        // here — narrowing to the payload's outcome union is a type-only adaptation.
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
        occurredAt: settledAt,
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
          occurredAt: settledAt,
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
          occurredAt: settledAt,
        });
      }

      summary.betsSettled += 1;
    }

    await tx.update(markets).set({ status: 'SETTLED' }).where(eq(markets.gameId, gameId));

    return summary;
  });
}

export interface SettleRunOptions {
  maxGames?: number;
  budgetMs?: number;
  /** Injectable clock so tests exercise the budget without sleeping. */
  now?: () => number;
}

export interface SettleRunSummary {
  gamesSettled: number;
  betsSettled: number;
  centsPaid: bigint;
  remaining: number;
  exhausted: 'none' | 'maxGames' | 'budget';
  errors: { gameId: string; message: string }[];
}

const DEFAULT_MAX_GAMES = 25;
const DEFAULT_BUDGET_MS = 45_000;

/**
 * Settles every game that has pending legs and a finished-or-abandoned status.
 *
 * There is deliberately no checkpoint state between runs: the candidate query is derived
 * entirely from the current pending legs, so a run that stops early simply finds the rest
 * next time. Nothing to reset, nothing to get stuck.
 *
 * One transaction per game, so a single malformed fixture rolls back only itself and lands
 * in `errors` while everyone else still gets paid. The budget is checked before starting a
 * game, never during one — a settlement is never abandoned half-written.
 */
export async function settleFinalGames(
  options: SettleRunOptions = {},
): Promise<SettleRunSummary> {
  const maxGames = options.maxGames ?? DEFAULT_MAX_GAMES;
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  const now = options.now ?? (() => Date.now());

  const startedAt = now();

  // The full candidate list, not a maxGames+1 window: `remaining` is reported as an exact
  // count, and a limit of maxGames+1 can only prove "at least one more". This is a list of
  // games with pending legs, so it stays small even on a full Saturday slate.
  const candidates = await db
    .selectDistinct({ id: games.id, startsAt: games.startsAt })
    .from(games)
    .innerJoin(markets, eq(markets.gameId, games.id))
    .innerJoin(selections, eq(selections.marketId, markets.id))
    .innerJoin(betLegs, eq(betLegs.selectionId, selections.id))
    .where(
      and(
        eq(betLegs.status, 'PENDING'),
        inArray(games.status, ['FINAL', 'POSTPONED', 'CANCELED']),
      ),
    )
    .orderBy(asc(games.startsAt));

  const summary: SettleRunSummary = {
    gamesSettled: 0,
    betsSettled: 0,
    centsPaid: 0n,
    remaining: 0,
    exhausted: 'none',
    errors: [],
  };

  const batch = candidates.slice(0, maxGames);
  const overflow = candidates.length - batch.length;

  for (let i = 0; i < batch.length; i++) {
    if (now() - startedAt >= budgetMs) {
      summary.exhausted = 'budget';
      summary.remaining = batch.length - i + overflow;
      return summary;
    }

    const game = batch[i];
    try {
      const settled = await settleGame(game.id);
      summary.gamesSettled += 1;
      summary.betsSettled += settled.betsSettled;
      summary.centsPaid += settled.centsPaid;
    } catch (err) {
      summary.errors.push({
        gameId: game.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (overflow > 0) {
    summary.exhausted = 'maxGames';
    summary.remaining = overflow;
  }

  return summary;
}
