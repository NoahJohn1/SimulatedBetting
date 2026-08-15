/**
 * Seeds a development database: the fixture slate plus an ACTIVE season to join.
 *
 *   npm run db:seed
 *
 * Safe to run repeatedly — syncOdds upserts, and the season is only created if none is
 * active. Never point this at production; it is a convenience for local development.
 */
import { config } from 'dotenv';

config({ path: process.env.ENV_FILE ?? '.env.local' });

async function run() {
  // Imported after dotenv so the db client sees DATABASE_URL.
  const { db } = await import('./client');
  const { seasons } = await import('./schema');
  const { eq } = await import('drizzle-orm');
  const { FixtureOddsProvider, FixtureScoreProvider } = await import('@/fixtures/providers');
  const { syncOdds } = await import('@/server/odds/sync');
  const { syncResults } = await import('@/server/odds/results');
  const { createSeason } = await import('@/server/seasons/service');

  const odds = await syncOdds({ provider: new FixtureOddsProvider() });
  console.log(
    `odds: ${odds.gamesUpserted} games, ${odds.marketsUpserted} markets, ${odds.snapshotsWritten} snapshots`,
  );

  // Results are deliberately not applied by default — a freshly seeded board should have
  // games to bet on, not a slate that is already over. Pass WITH_RESULTS=1 to finalize.
  if (process.env.WITH_RESULTS === '1') {
    const results = await syncResults({ provider: new FixtureScoreProvider() });
    console.log(`results: ${results.gamesUpdated} games updated`);
  }

  const [active] = await db.select().from(seasons).where(eq(seasons.status, 'ACTIVE'));
  if (active) {
    console.log(`season: "${active.name}" already active`);
  } else {
    const season = await createSeason({
      name: '2026 Football',
      startsAt: new Date('2026-09-01T00:00:00Z'),
      endsAt: new Date('2027-01-31T00:00:00Z'),
    });
    await db.update(seasons).set({ status: 'ACTIVE' }).where(eq(seasons.id, season.id));
    console.log(`season: created "${season.name}" and set ACTIVE`);
  }

  console.log('seed complete');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
