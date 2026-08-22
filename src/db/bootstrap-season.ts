/**
 * Creates and activates the first production season. A one-time operation: run once against
 * a fresh production database, right after migrations.
 *
 *   ENV_FILE=.env.production npx tsx src/db/bootstrap-season.ts
 *
 * Unlike seed.ts, this does not touch fixture odds — the sync-odds cron populates those on
 * its own once deployed. This script exists only for the one thing nothing else does
 * automatically: standing up a season to join. Skips cleanly if a season is already active.
 */
import { config } from 'dotenv';

config({ path: process.env.ENV_FILE ?? '.env.local' });

async function run() {
  const { db } = await import('./client');
  const { seasons } = await import('./schema');
  const { eq } = await import('drizzle-orm');
  const { createSeason } = await import('@/server/seasons/service');

  const [active] = await db.select().from(seasons).where(eq(seasons.status, 'ACTIVE'));
  if (active) {
    console.log(`season: "${active.name}" already active, nothing to do`);
    process.exit(0);
  }

  const season = await createSeason({
    name: '2026 Football',
    startsAt: new Date('2026-09-01T00:00:00Z'),
    endsAt: new Date('2027-01-31T00:00:00Z'),
  });
  await db.update(seasons).set({ status: 'ACTIVE' }).where(eq(seasons.id, season.id));
  console.log(`season: created "${season.name}" and set ACTIVE`);
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
