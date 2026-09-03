import type { Sport } from '@/db/schema';
import type { ProviderGame, ProviderMarket, ProviderResult } from '../types';
import { mapGame, mapMarkets, mapResult } from './mappers';
import type { EspnScoreboardResponse } from './espn-types';

const SPORT_PATH: Record<Sport, string> = {
  NFL: 'nfl',
  NCAAF: 'college-football',
};

const MS_PER_DAY = 86_400_000;

function formatEspnDate(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function buildUrl(sport: Sport, opts: { daysBack: number; daysForward: number }): string {
  const now = new Date();
  const from = new Date(now.getTime() - opts.daysBack * MS_PER_DAY);
  const to = new Date(now.getTime() + opts.daysForward * MS_PER_DAY);

  const params = new URLSearchParams({ dates: `${formatEspnDate(from)}-${formatEspnDate(to)}` });
  if (sport === 'NCAAF') {
    params.set('groups', '80');
    params.set('limit', '200');
  }

  return `https://site.api.espn.com/apis/site/v2/sports/football/${SPORT_PATH[sport]}/scoreboard?${params}`;
}

export interface ParsedGame {
  game: ProviderGame;
  markets: ProviderMarket[];
  result: ProviderResult;
}

export interface FetchScoreboardResult {
  items: ParsedGame[];
  skippedGames: number;
  skippedMarkets: number;
}

/**
 * Hits ESPN's public scoreboard endpoint once and maps every event it returns. A single
 * malformed event is skipped and counted, not thrown — the rest of the slate still comes
 * back. A request-level failure (unreachable, non-200) is NOT caught here; it propagates so
 * the caller's tick fails openly and the next cron run retries (see the plan's Global
 * Constraints for why this is scoped to the whole tick, not per-sport).
 */
export async function fetchScoreboard(
  sport: Sport,
  opts: { daysBack: number; daysForward: number },
): Promise<FetchScoreboardResult> {
  const response = await fetch(buildUrl(sport, opts));
  if (!response.ok) {
    throw new Error(`ESPN scoreboard request failed: ${response.status} ${response.statusText}`);
  }

  const body = (await response.json()) as EspnScoreboardResponse;

  const items: ParsedGame[] = [];
  let skippedGames = 0;
  let skippedMarkets = 0;

  for (const event of body.events ?? []) {
    let game: ProviderGame;
    let result: ProviderResult;
    try {
      game = mapGame(event, sport);
      result = mapResult(event);
    } catch {
      skippedGames += 1;
      continue;
    }

    // Market parsing is isolated from game/result parsing: a game whose odds block is
    // malformed in a way mapMarkets's own per-market try/catch doesn't cover must still
    // sync its schedule and score — losing a game's result because its odds were bad
    // would silently block that game from ever settling.
    let markets: ProviderMarket[] = [];
    try {
      const mapped = mapMarkets(event);
      markets = mapped.markets;
      skippedMarkets += mapped.skipped;
    } catch {
      skippedMarkets += 1;
    }

    items.push({ game, markets, result });
  }

  return { items, skippedGames, skippedMarkets };
}
