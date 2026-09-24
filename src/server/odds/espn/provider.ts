import type { Sport } from '@/db/schema';
import type {
  GetResultsOptions,
  OddsProvider,
  ProviderGame,
  ProviderMarket,
  ProviderResult,
  ScoreProvider,
} from '../types';
import { fetchScoreboard, type FetchScoreboardResult } from './fetch-scoreboard';

const ALL_SPORTS: Sport[] = ['NFL', 'NCAAF'];
const DEFAULT_WITHIN_DAYS = 14;
/** Enough to span one weekend of games without re-scanning further back on every tick. */
const SCORE_LOOKBACK_DAYS = 3;
/**
 * The furthest back an outstanding game can pull the results window. Past this, a game
 * ESPN never finalizes (a stale postponement, a removed event) would cost 60-odd requests
 * on every run forever; an admin settles it by hand instead (D81).
 */
const MAX_SCORE_LOOKBACK_DAYS = 30;
const SCORE_LOOKAHEAD_DAYS = 1;
const MS_PER_DAY = 86_400_000;

/**
 * Days to reach back for results: the usual weekend, or far enough to cover the oldest game
 * still awaiting one, whichever is longer, up to the cap. The extra day is because ESPN files
 * a game under its US Eastern date, which for a late kickoff is the day before its UTC date.
 */
function scoreLookbackDays(awaitingResultSince: Date | undefined): number {
  if (!awaitingResultSince) return SCORE_LOOKBACK_DAYS;
  const daysAgo = Math.floor((Date.now() - awaitingResultSince.getTime()) / MS_PER_DAY) + 1;
  return Math.min(Math.max(daysAgo, SCORE_LOOKBACK_DAYS), MAX_SCORE_LOOKBACK_DAYS);
}

export class EspnOddsProvider implements OddsProvider {
  private lastWithinDays = DEFAULT_WITHIN_DAYS;
  private skippedGames = 0;
  private skippedMarkets = 0;
  /**
   * Each sport's window from getUpcomingGames, so getMarkets doesn't fetch the same 15 days
   * again. The sync-odds route builds a new provider per run, so this never outlives a run.
   */
  private windows = new Map<Sport, FetchScoreboardResult>();

  async getUpcomingGames(sport: Sport, withinDays: number): Promise<ProviderGame[]> {
    this.lastWithinDays = withinDays;

    const window = await fetchScoreboard(sport, {
      daysBack: 0,
      daysForward: withinDays,
    });
    this.windows.set(sport, window);
    this.skippedGames += window.skippedGames;

    return window.items.map((item) => item.game);
  }

  async getMarkets(gameExternalIds: string[]): Promise<ProviderMarket[]> {
    const wanted = new Set(gameExternalIds);
    const markets: ProviderMarket[] = [];

    for (const sport of ALL_SPORTS) {
      const window =
        this.windows.get(sport) ??
        (await fetchScoreboard(sport, { daysBack: 0, daysForward: this.lastWithinDays }));
      // Only skippedMarkets is accumulated here, deliberately mirroring getUpcomingGames's
      // opposite omission (it only accumulates skippedGames): this is the same window
      // getUpcomingGames already fetched, so re-counting skippedGames here would
      // double-count the same malformed events.
      this.skippedMarkets += window.skippedMarkets;

      for (const item of window.items) {
        if (wanted.has(item.game.externalId)) markets.push(...item.markets);
      }
    }

    return markets;
  }

  getSkipped(): { games: number; markets: number } {
    return { games: this.skippedGames, markets: this.skippedMarkets };
  }
}

export class EspnScoreProvider implements ScoreProvider {
  private skippedGames = 0;

  async getResults(
    gameExternalIds: string[],
    options: GetResultsOptions = {},
  ): Promise<ProviderResult[]> {
    const wanted = new Set(gameExternalIds);
    const results: ProviderResult[] = [];
    const daysBack = scoreLookbackDays(options.awaitingResultSince);

    for (const sport of ALL_SPORTS) {
      const { items, skippedGames } = await fetchScoreboard(sport, {
        daysBack,
        daysForward: SCORE_LOOKAHEAD_DAYS,
      });
      this.skippedGames += skippedGames;

      for (const item of items) {
        if (wanted.has(item.game.externalId)) results.push(item.result);
      }
    }

    return results;
  }

  getSkipped(): { games: number } {
    return { games: this.skippedGames };
  }
}
