import { settleFinalGames } from '@/server/bets/settle';
import { authorizeCronRequest, jsonSafe } from '@/server/cron/auth';

/**
 * Every 10 minutes. Settles finished games in batches sized to fit the invocation limit;
 * whatever it does not reach is picked up by the next run.
 */
export async function GET(request: Request): Promise<Response> {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  const summary = await settleFinalGames();

  // A game that failed to settle is reported, not swallowed — the run still succeeded for
  // everyone else, but a persistent failure needs to be visible in the cron logs.
  const status = summary.errors.length > 0 ? 207 : 200;
  return Response.json(jsonSafe(summary), { status });
}
