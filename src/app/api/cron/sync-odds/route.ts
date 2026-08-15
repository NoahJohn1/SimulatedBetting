import { FixtureOddsProvider, FixtureScoreProvider } from '@/fixtures/providers';
import { authorizeCronRequest, jsonSafe } from '@/server/cron/auth';
import { syncResults } from '@/server/odds/results';
import { suspendStaleMarkets, syncOdds } from '@/server/odds/sync';

/**
 * Every 15 minutes. Pulls the slate and prices, applies any reported results, then
 * suspends anything that has gone stale.
 *
 * The fixture providers are wired in here; swapping to a real adapter is a change to these
 * two lines and nothing else, which is the point of the provider interfaces.
 */
export async function GET(request: Request): Promise<Response> {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  const odds = await syncOdds({ provider: new FixtureOddsProvider() });
  const results = await syncResults({ provider: new FixtureScoreProvider() });
  const suspended = await suspendStaleMarkets();

  return Response.json(jsonSafe({ odds, results, suspended }));
}
