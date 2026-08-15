import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

export async function resetDb(): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE ledger_entries, bet_legs, bets, odds_snapshots, selections, markets, games, teams, season_memberships, seasons, users RESTART IDENTITY CASCADE`,
  );
}
