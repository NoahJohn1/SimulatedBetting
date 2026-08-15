import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { games } from '@/db/schema';
import type { ScoreProvider } from './types';

export interface SyncResultsOptions {
  provider: ScoreProvider;
}

export interface SyncResultsSummary {
  gamesUpdated: number;
  /** Games whose score changed after already being FINAL — these need re-settlement. */
  corrected: string[];
}

/**
 * Applies reported results to games. This is what moves a game to FINAL, which is what
 * makes it a settlement candidate.
 *
 * A score that changes on a game already FINAL is reported in `corrected` rather than
 * silently re-settled: re-settlement is admin-triggered, never automatic on a score change,
 * so this surfaces the correction and leaves the decision to a human.
 */
export async function syncResults(options: SyncResultsOptions): Promise<SyncResultsSummary> {
  const existing = await db
    .select({
      id: games.id,
      externalId: games.externalId,
      status: games.status,
      homeScore: games.homeScore,
      awayScore: games.awayScore,
    })
    .from(games);

  if (existing.length === 0) return { gamesUpdated: 0, corrected: [] };

  const reported = await options.provider.getResults(existing.map((g) => g.externalId));
  const byExternalId = new Map(existing.map((g) => [g.externalId, g]));

  const summary: SyncResultsSummary = { gamesUpdated: 0, corrected: [] };

  for (const result of reported) {
    const game = byExternalId.get(result.gameExternalId);
    if (!game) continue;

    const unchanged =
      game.status === result.status &&
      game.homeScore === result.homeScore &&
      game.awayScore === result.awayScore;
    if (unchanged) continue;

    const scoreChangedAfterFinal =
      game.status === 'FINAL' &&
      result.status === 'FINAL' &&
      (game.homeScore !== result.homeScore || game.awayScore !== result.awayScore);

    await db
      .update(games)
      .set({
        status: result.status,
        homeScore: result.homeScore,
        awayScore: result.awayScore,
      })
      .where(eq(games.id, game.id));

    summary.gamesUpdated += 1;
    if (scoreChangedAfterFinal) summary.corrected.push(game.externalId);
  }

  return summary;
}
