import type { Sport } from '@/db/schema';
import type { ProviderGame, ProviderMarket, ProviderResult } from '../types';
import { mapGame, mapMarkets, mapResult } from './mappers';
import type { EspnScoreboardResponse } from './espn-types';

const SPORT_PATH: Record<Sport, string> = {
  NFL: 'nfl',
  NCAAF: 'college-football',
};

const MS_PER_DAY = 86_400_000;
/** Enough to keep a multi-day window quick without hammering an unofficial endpoint. */
const MAX_IN_FLIGHT = 4;
/**
 * A single-day scoreboard answers in well under a second. Without a cap, one hung request
 * would stall the whole run until the platform killed it, leaving no error behind (D81).
 */
const REQUEST_TIMEOUT_MS = 10_000;

function formatEspnDate(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * One day only. ESPN's scoreboard used to accept `dates=YYYYMMDD-YYYYMMDD`, but since
 * September 2026 it answers any range — even two days — with a 400 (D80).
 */
function buildUrl(sport: Sport, day: string): string {
  const params = new URLSearchParams({ dates: day });
  if (sport === 'NCAAF') {
    params.set('groups', '80');
    params.set('limit', '200');
  }

  return `https://site.api.espn.com/apis/site/v2/sports/football/${SPORT_PATH[sport]}/scoreboard?${params}`;
}

/** Every UTC calendar day in the window, oldest first, both ends included. */
function windowDays(opts: { daysBack: number; daysForward: number }): string[] {
  const now = Date.now();
  const days: string[] = [];
  for (let offset = -opts.daysBack; offset <= opts.daysForward; offset++) {
    days.push(formatEspnDate(new Date(now + offset * MS_PER_DAY)));
  }
  return days;
}

/**
 * `Promise.all` over `items` with at most `limit` calls running at once, results in input
 * order. The first failure rejects the whole call and stops workers from starting new items.
 */
async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;

  async function worker() {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index]);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Node's fetch reports every network failure as a bare "fetch failed" and puts the real
 * reason (DNS, refused, reset) on `cause`. `job_runs` stores only the message, so the cause
 * has to be folded in to be of any use there.
 */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? `${error.message} (${error.cause.message})` : error.message;
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
 * One scoreboard request for one day. A single malformed event is skipped and counted, not
 * thrown — the rest of the day still comes back. A request-level failure (unreachable,
 * timed out, non-200) is NOT swallowed here; it propagates so the caller's tick fails openly
 * and the next cron run retries (see the ESPN adapter plan's Global Constraints for why this
 * is scoped to the whole tick, not per-sport).
 */
async function fetchScoreboardDay(sport: Sport, day: string): Promise<FetchScoreboardResult> {
  let response: Response;
  try {
    response = await fetch(buildUrl(sport, day), {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`ESPN ${sport} scoreboard request for ${day} failed: ${describe(error)}`, {
      cause: error,
    });
  }
  if (!response.ok) {
    throw new Error(
      `ESPN ${sport} scoreboard request for ${day} failed: ${response.status} ${response.statusText}`,
    );
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

/**
 * Every game in the window, fetched one day per request (ESPN rejects ranges — D80) and
 * merged. A game that appears on more than one day is kept once, first day wins. Any
 * failed day rejects the whole call: a slate with a silent hole in it is worse than a tick
 * that fails and retries.
 */
export async function fetchScoreboard(
  sport: Sport,
  opts: { daysBack: number; daysForward: number },
): Promise<FetchScoreboardResult> {
  const perDay = await mapWithLimit(windowDays(opts), MAX_IN_FLIGHT, (day) =>
    fetchScoreboardDay(sport, day),
  );

  const seen = new Set<string>();
  const items: ParsedGame[] = [];
  let skippedGames = 0;
  let skippedMarkets = 0;

  for (const day of perDay) {
    skippedGames += day.skippedGames;
    skippedMarkets += day.skippedMarkets;
    for (const item of day.items) {
      if (seen.has(item.game.externalId)) continue;
      seen.add(item.game.externalId);
      items.push(item);
    }
  }

  return { items, skippedGames, skippedMarkets };
}
