import { and, eq, lt } from 'drizzle-orm';
import { db } from '@/db/client';
import { games, markets, oddsSnapshots, selections, teams } from '@/db/schema';
import type { Sport } from '@/db/schema';
import { linesEqual, normalizeLine } from '@/domain/line';
import type { OddsProvider, ProviderGame, ProviderTeam } from './types';

/** A market whose data is older than this is not safe to bet against. */
export const STALE_AFTER_MS = 30 * 60_000;

const DEFAULT_SPORTS: Sport[] = ['NFL', 'NCAAF'];
const DEFAULT_WITHIN_DAYS = 14;

export interface SyncOddsOptions {
  provider: OddsProvider;
  sports?: Sport[];
  withinDays?: number;
}

export interface SyncOddsSummary {
  gamesUpserted: number;
  marketsUpserted: number;
  selectionsUpserted: number;
  snapshotsWritten: number;
}

async function upsertTeam(team: ProviderTeam, sport: Sport): Promise<string> {
  const [row] = await db
    .insert(teams)
    .values({
      sport,
      externalId: team.externalId,
      name: team.name,
      abbreviation: team.abbreviation,
      logoUrl: team.logoUrl ?? null,
    })
    .onConflictDoUpdate({
      target: [teams.sport, teams.externalId],
      set: { name: team.name, abbreviation: team.abbreviation },
    })
    .returning({ id: teams.id });

  return row.id;
}

async function upsertGame(game: ProviderGame): Promise<string> {
  const homeTeamId = await upsertTeam(game.home, game.sport);
  const awayTeamId = await upsertTeam(game.away, game.sport);

  const [row] = await db
    .insert(games)
    .values({
      sport: game.sport,
      externalId: game.externalId,
      homeTeamId,
      awayTeamId,
      startsAt: game.startsAt,
      seasonYear: game.seasonYear,
      week: game.week,
      status: game.status,
    })
    .onConflictDoUpdate({
      target: [games.sport, games.externalId],
      // Scores and terminal statuses are the score provider's business, not the odds
      // feed's — syncOdds only keeps the schedule current.
      set: { startsAt: game.startsAt, week: game.week },
    })
    .returning({ id: games.id });

  return row.id;
}

/**
 * Pulls the upcoming slate and prices from a provider into our tables.
 *
 * A snapshot is appended only when a line or price actually changed. Syncing every 15
 * minutes and snapshotting unconditionally would bloat `odds_snapshots` with thousands of
 * identical rows a day and make real line movement impossible to see.
 *
 * Lines are compared through the domain's normalizer, so `-3.5` from a feed and `-3.50`
 * from Postgres are correctly recognised as the same number rather than a phantom move.
 */
export async function syncOdds(options: SyncOddsOptions): Promise<SyncOddsSummary> {
  const sports = options.sports ?? DEFAULT_SPORTS;
  const withinDays = options.withinDays ?? DEFAULT_WITHIN_DAYS;

  const summary: SyncOddsSummary = {
    gamesUpserted: 0,
    marketsUpserted: 0,
    selectionsUpserted: 0,
    snapshotsWritten: 0,
  };

  const gameIdByExternalId = new Map<string, string>();

  for (const sport of sports) {
    const upcoming = await options.provider.getUpcomingGames(sport, withinDays);
    for (const game of upcoming) {
      gameIdByExternalId.set(game.externalId, await upsertGame(game));
      summary.gamesUpserted += 1;
    }
  }

  if (gameIdByExternalId.size === 0) return summary;

  const providerMarkets = await options.provider.getMarkets([...gameIdByExternalId.keys()]);
  const syncedAt = new Date();

  for (const market of providerMarkets) {
    const gameId = gameIdByExternalId.get(market.gameExternalId);
    if (!gameId) continue;

    const [marketRow] = await db
      .insert(markets)
      .values({
        gameId,
        type: market.type,
        sourceBook: market.sourceBook,
        status: market.status ?? 'OPEN',
        lastSyncedAt: syncedAt,
      })
      .onConflictDoUpdate({
        target: [markets.gameId, markets.type],
        // Status is deliberately not overwritten: a market suspended for staleness or
        // settled by the settlement job must not be reopened by a routine sync.
        set: { sourceBook: market.sourceBook, lastSyncedAt: syncedAt },
      })
      .returning({ id: markets.id });

    summary.marketsUpserted += 1;

    for (const selection of market.selections) {
      const line = normalizeLine(selection.line);

      const [existing] = await db
        .select({
          id: selections.id,
          line: selections.line,
          priceAmerican: selections.priceAmerican,
        })
        .from(selections)
        .where(and(eq(selections.marketId, marketRow.id), eq(selections.side, selection.side)));

      const changed =
        !existing ||
        !linesEqual(existing.line, line) ||
        existing.priceAmerican !== selection.priceAmerican;

      const [selectionRow] = await db
        .insert(selections)
        .values({
          marketId: marketRow.id,
          side: selection.side,
          line,
          priceAmerican: selection.priceAmerican,
          updatedAt: syncedAt,
        })
        .onConflictDoUpdate({
          target: [selections.marketId, selections.side],
          set: { line, priceAmerican: selection.priceAmerican, updatedAt: syncedAt },
        })
        .returning({ id: selections.id });

      summary.selectionsUpserted += 1;

      if (changed) {
        await db.insert(oddsSnapshots).values({
          selectionId: selectionRow.id,
          line,
          priceAmerican: selection.priceAmerican,
          capturedAt: syncedAt,
        });
        summary.snapshotsWritten += 1;
      }
    }
  }

  return summary;
}

/**
 * Suspends any OPEN market whose data has gone stale, so nobody bets a dead line.
 *
 * Suspension is a column write during the sync cycle rather than something computed at read
 * time: placement validation already reads `markets.status`, and a stored status is one
 * source of truth instead of every caller re-deriving staleness from `last_synced_at`.
 */
export async function suspendStaleMarkets(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_AFTER_MS);

  const suspended = await db
    .update(markets)
    .set({ status: 'SUSPENDED' })
    .where(and(eq(markets.status, 'OPEN'), lt(markets.lastSyncedAt, cutoff)))
    .returning({ id: markets.id });

  return suspended.length;
}
