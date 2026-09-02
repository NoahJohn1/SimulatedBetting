import { and, asc, eq, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '@/db/client';
import { betLegs, games, markets, selections, teams } from '@/db/schema';
import type { BetStatus } from '@/db/schema';
import { gradeLeg } from '@/domain/grading';
import type { LegStatus, MarketType, Side } from '@/domain/grading';
import { lineToNumber } from '@/domain/line';
import { settleBetsForLegs } from '@/server/bets/grade-legs';
import { buildLegSnapshot } from '@/server/feed/snapshot';

const homeTeams = alias(teams, 'settle_home_teams');
const awayTeams = alias(teams, 'settle_away_teams');

/**
 * Game settlement only ever grades legs on sports markets. This query is scoped to a
 * game's own event id, so a CUSTOM_OUTCOME market or a null side reaching here would mean a
 * custom-event leg leaked into the sports settlement path — a bug elsewhere, not something
 * to grade around.
 */
function toSportsLeg<T extends { marketType: string; side: string | null }>(
  leg: T,
): T & { marketType: MarketType; side: Side } {
  if (leg.marketType === 'CUSTOM_OUTCOME' || leg.side === null) {
    throw new Error('settleGame: expected a sports market/selection, not a custom-outcome one');
  }
  return leg as T & { marketType: MarketType; side: Side };
}

export interface SettleGameSummary {
  gameId: string;
  legsGraded: number;
  betsSettled: number;
  centsPaid: bigint;
}

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

    const pending = (
      await tx
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
        .where(and(eq(markets.eventId, game.eventId), eq(betLegs.status, 'PENDING')))
    ).map(toSportsLeg);

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

    const settled = await settleBetsForLegs(tx, {
      betIds: touchedBetIds,
      settledAt,
      snapshotLegs: async (betId) => {
        const legs = (
          await tx
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
            .innerJoin(games, eq(markets.eventId, games.eventId))
            .innerJoin(homeTeams, eq(games.homeTeamId, homeTeams.id))
            .innerJoin(awayTeams, eq(games.awayTeamId, awayTeams.id))
            .where(eq(betLegs.betId, betId))
            .orderBy(asc(betLegs.createdAt))
        ).map(toSportsLeg);

        return {
          statuses: legs.map((leg) => leg.status as LegStatus),
          prices: legs.map((leg) => leg.priceAtPlacement),
          snapshots: legs.map((leg) =>
            buildLegSnapshot(leg, {
              line: leg.lineAtPlacement,
              priceAmerican: leg.priceAtPlacement,
            }),
          ),
        };
      },
    });

    summary.betsSettled = settled.betsSettled;
    summary.centsPaid = settled.centsPaid;

    await tx.update(markets).set({ status: 'SETTLED' }).where(eq(markets.eventId, game.eventId));

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
export async function settleFinalGames(options: SettleRunOptions = {}): Promise<SettleRunSummary> {
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
    .innerJoin(markets, eq(markets.eventId, games.eventId))
    .innerJoin(selections, eq(selections.marketId, markets.id))
    .innerJoin(betLegs, eq(betLegs.selectionId, selections.id))
    .where(
      and(eq(betLegs.status, 'PENDING'), inArray(games.status, ['FINAL', 'POSTPONED', 'CANCELED'])),
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
