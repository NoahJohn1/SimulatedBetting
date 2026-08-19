import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { seasons } from '@/db/schema';
import { settleFinalGames } from '@/server/bets/settle';
import { authorizeCronRequest, jsonSafe } from '@/server/cron/auth';
import { detectLeadChange } from '@/server/feed/leaders';
import { sweepOverdueEvents } from '@/server/events/overdue';
import { sweepP2PWagers } from '@/server/p2p/sweep';

/**
 * Every 10 minutes. Settles finished games in batches sized to fit the invocation limit;
 * whatever it does not reach is picked up by the next run.
 *
 * Lead-change detection, overdue-event sweeping and the peer-to-peer wager sweep all ride
 * along here rather than in their own cron entries: settlement is what moves standings, and
 * folding them in means no new schedules to keep in sync.
 */
export async function GET(request: Request): Promise<Response> {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  const summary = await settleFinalGames();

  let leadChanged = false;
  const [activeSeason] = await db
    .select({ id: seasons.id })
    .from(seasons)
    .where(eq(seasons.status, 'ACTIVE'));

  if (activeSeason) {
    leadChanged = (await detectLeadChange(activeSeason.id)).emitted;
  }

  const overdue = await sweepOverdueEvents();
  const wagers = await sweepP2PWagers();

  // A game or wager that failed is reported, not swallowed — the run still succeeded for
  // everyone else, but a persistent failure needs to be visible in the cron logs.
  const status = summary.errors.length > 0 || wagers.errors.length > 0 ? 207 : 200;
  return Response.json(
    jsonSafe({
      ...summary,
      leadChanged,
      overdueFlagged: overdue.flagged,
      wagersExpired: wagers.expired,
      wagersSettled: wagers.settled,
      wagersOverdue: wagers.overdueFlagged,
      wagerErrors: wagers.errors,
    }),
    { status },
  );
}
