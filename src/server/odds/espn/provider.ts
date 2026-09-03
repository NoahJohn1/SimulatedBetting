import type { Sport } from '@/db/schema';
import type {
  OddsProvider,
  ProviderGame,
  ProviderMarket,
  ProviderResult,
  ScoreProvider,
} from '../types';
import { fetchScoreboard } from './fetch-scoreboard';

const ALL_SPORTS: Sport[] = ['NFL', 'NCAAF'];
const DEFAULT_WITHIN_DAYS = 14;
/** Enough to span one weekend of games without re-scanning further back on every tick. */
const SCORE_LOOKBACK_DAYS = 3;
const SCORE_LOOKAHEAD_DAYS = 1;

export class EspnOddsProvider implements OddsProvider {
  private lastWithinDays = DEFAULT_WITHIN_DAYS;
  private skippedGames = 0;
  private skippedMarkets = 0;

  async getUpcomingGames(sport: Sport, withinDays: number): Promise<ProviderGame[]> {
    this.lastWithinDays = withinDays;

    const { items, skippedGames } = await fetchScoreboard(sport, {
      daysBack: 0,
      daysForward: withinDays,
    });
    this.skippedGames += skippedGames;

    return items.map((item) => item.game);
  }

  async getMarkets(gameExternalIds: string[]): Promise<ProviderMarket[]> {
    const wanted = new Set(gameExternalIds);
    const markets: ProviderMarket[] = [];

    for (const sport of ALL_SPORTS) {
      // Only skippedMarkets is accumulated here, deliberately mirroring getUpcomingGames's
      // opposite omission (it only accumulates skippedGames): this fetch covers the same
      // window getUpcomingGames already fetched, so re-counting skippedGames here would
      // double-count the same malformed events.
      const { items, skippedMarkets } = await fetchScoreboard(sport, {
        daysBack: 0,
        daysForward: this.lastWithinDays,
      });
      this.skippedMarkets += skippedMarkets;

      for (const item of items) {
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

  async getResults(gameExternalIds: string[]): Promise<ProviderResult[]> {
    const wanted = new Set(gameExternalIds);
    const results: ProviderResult[] = [];

    for (const sport of ALL_SPORTS) {
      const { items, skippedGames } = await fetchScoreboard(sport, {
        daysBack: SCORE_LOOKBACK_DAYS,
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
