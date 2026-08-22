import { FixtureOddsProvider, FixtureScoreProvider } from '@/fixtures/providers';
import { EspnOddsProvider, EspnScoreProvider } from '@/server/odds/espn/provider';
import { authorizeCronRequest, jsonSafe } from '@/server/cron/auth';
import { syncResults } from '@/server/odds/results';
import { suspendStaleMarkets, syncOdds } from '@/server/odds/sync';

/**
 * Every 15 minutes. Pulls the slate and prices, applies any reported results, then
 * suspends anything that has gone stale.
 *
 * ODDS_PROVIDER=espn switches to the real ESPN adapter; anything else (including unset)
 * keeps the fixture providers, so this ships inert until deliberately flipped in an
 * environment's config.
 */
export async function GET(request: Request): Promise<Response> {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  const useEspn = process.env.ODDS_PROVIDER === 'espn';
  const oddsProvider = useEspn ? new EspnOddsProvider() : new FixtureOddsProvider();
  const scoreProvider = useEspn ? new EspnScoreProvider() : new FixtureScoreProvider();

  const odds = await syncOdds({ provider: oddsProvider });
  const results = await syncResults({ provider: scoreProvider });
  const suspended = await suspendStaleMarkets();

  return Response.json(jsonSafe({ odds, results, suspended }));
}
