import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

export async function resetDb(): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE notifications, notification_preferences, rate_limits, job_runs, feed_reactions, feed_comments, feed_events, feed_preferences, ledger_entries, p2p_wagers, bet_legs, bets, odds_snapshots, selections, markets, games, custom_event_disputes, custom_events, events, teams, season_memberships, seasons, users RESTART IDENTITY CASCADE`,
  );
}
