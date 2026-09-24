import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { games, type GameStatus } from '@/db/schema';
import { FixtureOddsProvider, FixtureScoreProvider } from '@/fixtures/providers';
import { syncResults } from '@/server/odds/results';
import { syncOdds } from '@/server/odds/sync';
import type { GetResultsOptions, ProviderResult, ScoreProvider } from '@/server/odds/types';
import { resetDb } from '@/test/db';

async function gameByExternalId(externalId: string) {
  const [row] = await db.select().from(games).where(eq(games.externalId, externalId));
  return row;
}

describe('syncResults', () => {
  beforeEach(async () => {
    await resetDb();
    await syncOdds({ provider: new FixtureOddsProvider() });
  });

  it('brings final scores in and marks the games FINAL', async () => {
    const summary = await syncResults({ provider: new FixtureScoreProvider() });

    expect(summary.gamesUpdated).toBeGreaterThanOrEqual(4);

    const game = await gameByExternalId('nfl-2026-w1-buf-nyj');
    expect(game.status).toBe('FINAL');
    expect(game.homeScore).toBe(24);
    expect(game.awayScore).toBe(20);
  });

  it('carries postponements and cancellations through', async () => {
    await syncResults({ provider: new FixtureScoreProvider() });

    expect((await gameByExternalId('nfl-2026-w1-kc-den')).status).toBe('POSTPONED');
    expect((await gameByExternalId('ncaaf-2026-w2-mich-osu')).status).toBe('CANCELED');
  });

  it('leaves a game with no reported result untouched', async () => {
    await syncResults({ provider: new FixtureScoreProvider() });

    const upcoming = await gameByExternalId('nfl-2026-w2-lar-ari');
    expect(upcoming.status).toBe('SCHEDULED');
    expect(upcoming.homeScore).toBeNull();
  });

  it('reports nothing changed when the same results are re-synced', async () => {
    await syncResults({ provider: new FixtureScoreProvider() });
    const second = await syncResults({ provider: new FixtureScoreProvider() });

    expect(second.gamesUpdated).toBe(0);
  });

  it('applies a corrected score in a later round', async () => {
    await syncResults({ provider: new FixtureScoreProvider({ round: 0 }) });
    expect((await gameByExternalId('nfl-2026-w1-gb-chi')).homeScore).toBe(17);

    const corrected = await syncResults({ provider: new FixtureScoreProvider({ round: 1 }) });

    expect(corrected.gamesUpdated).toBe(1);
    expect(corrected.corrected).toEqual(['nfl-2026-w1-gb-chi']);
    expect((await gameByExternalId('nfl-2026-w1-gb-chi')).homeScore).toBe(24);
  });

  class SkippingScoreProvider implements ScoreProvider {
    async getResults(): Promise<ProviderResult[]> {
      return [];
    }
    getSkipped(): { games: number } {
      return { games: 3 };
    }
  }

  it('surfaces getSkipped() on the summary when the provider implements it', async () => {
    const summary = await syncResults({ provider: new SkippingScoreProvider() });
    expect(summary.gamesSkipped).toBe(3);
  });

  it('defaults gamesSkipped to zero for a provider that does not implement getSkipped', async () => {
    const summary = await syncResults({ provider: new FixtureScoreProvider() });
    expect(summary.gamesSkipped).toBe(0);
  });

  describe('awaitingResultSince', () => {
    class RecordingScoreProvider implements ScoreProvider {
      options: GetResultsOptions | undefined;
      async getResults(_ids: string[], options?: GetResultsOptions): Promise<ProviderResult[]> {
        this.options = options;
        return [];
      }
    }

    async function setGame(externalId: string, status: GameStatus, startsAt: Date) {
      await db.update(games).set({ status, startsAt }).where(eq(games.externalId, externalId));
    }

    beforeEach(async () => {
      // A known baseline: every fixture game finished, so only the games each test sets
      // below can count as awaiting a result.
      await db.update(games).set({ status: 'FINAL' });
    });

    it('is the start of the oldest game that has kicked off without a final result', async () => {
      await setGame('nfl-2026-w1-buf-nyj', 'SCHEDULED', new Date('2020-01-05T18:00:00Z'));
      await setGame('nfl-2026-w1-gb-chi', 'IN_PROGRESS', new Date('2020-01-01T18:00:00Z'));

      const provider = new RecordingScoreProvider();
      await syncResults({ provider });

      expect(provider.options?.awaitingResultSince).toEqual(new Date('2020-01-01T18:00:00Z'));
    });

    it('ignores games that have not started, and postponed or canceled ones', async () => {
      await setGame('nfl-2026-w1-buf-nyj', 'SCHEDULED', new Date(Date.now() + 86_400_000));
      await setGame('nfl-2026-w1-kc-den', 'POSTPONED', new Date('2019-01-01T18:00:00Z'));
      await setGame('ncaaf-2026-w2-mich-osu', 'CANCELED', new Date('2019-01-01T18:00:00Z'));

      const provider = new RecordingScoreProvider();
      await syncResults({ provider });

      expect(provider.options?.awaitingResultSince).toBeUndefined();
    });
  });
});
