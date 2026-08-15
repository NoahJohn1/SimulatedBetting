import type {
  OddsProvider,
  ProviderGame,
  ProviderMarket,
  ProviderResult,
  ProviderSelection,
  ScoreProvider,
} from '@/server/odds/types';
import type { GameStatus, MarketStatusValue, MarketTypeValue, Sport } from '@/db/schema';
import resultsData from './results.json';
import slateData from './slate.json';

interface RoundOptions {
  /**
   * Which sync round to answer as. Round 0 is the opening number / first report; later
   * rounds carry line movement and score corrections. A round past the last one defined
   * holds the last, so a long-running test does not fall off the end of the data.
   */
  round?: number;
}

function atRound<T>(rounds: T[], round: number): T {
  return rounds[Math.min(round, rounds.length - 1)];
}

interface SlateGame {
  externalId: string;
  sport: string;
  home: { externalId: string; name: string; abbreviation: string; logoUrl?: string | null };
  away: { externalId: string; name: string; abbreviation: string; logoUrl?: string | null };
  startsAt: string;
  seasonYear: number;
  week: number | null;
  status: string;
}

interface SlateMarket {
  gameExternalId: string;
  type: string;
  sourceBook: string;
  status?: string;
  rounds: ProviderSelection[][];
}

const slate = slateData as unknown as { games: SlateGame[]; markets: SlateMarket[] };
const results = resultsData as unknown as {
  results: { gameExternalId: string; rounds: ProviderResult[] }[];
};

function toProviderGame(game: SlateGame): ProviderGame {
  return {
    externalId: game.externalId,
    sport: game.sport as Sport,
    home: game.home,
    away: game.away,
    startsAt: new Date(game.startsAt),
    seasonYear: game.seasonYear,
    week: game.week,
    status: game.status as GameStatus,
  };
}

/** The market status the slate declares, defaulting to OPEN. */
export function fixtureMarketStatus(
  gameExternalId: string,
  type: MarketTypeValue,
): MarketStatusValue {
  const market = slate.markets.find(
    (m) => m.gameExternalId === gameExternalId && m.type === type,
  );
  return (market?.status as MarketStatusValue) ?? 'OPEN';
}

export function allFixtureGameIds(): string[] {
  return slate.games.map((game) => game.externalId);
}

/**
 * Reads the committed JSON slate. The real adapter (The Odds API) will implement the same
 * interface, so nothing downstream of syncOdds knows which one it is talking to.
 */
export class FixtureOddsProvider implements OddsProvider {
  private readonly round: number;

  constructor(options: RoundOptions = {}) {
    this.round = options.round ?? 0;
  }

  async getUpcomingGames(sport: Sport, withinDays: number): Promise<ProviderGame[]> {
    const forSport = slate.games
      .filter((game) => game.sport === sport)
      .map(toProviderGame)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

    if (forSport.length === 0) return [];

    // The slate is fixed data with fixed dates, so the window is measured from the first
    // kickoff rather than wall-clock now — otherwise the fixtures would silently empty out
    // as real time moved past them.
    const from = forSport[0].startsAt.getTime();
    const until = from + withinDays * 86_400_000;

    return forSport.filter((game) => game.startsAt.getTime() <= until);
  }

  async getMarkets(gameExternalIds: string[]): Promise<ProviderMarket[]> {
    const wanted = new Set(gameExternalIds);

    return slate.markets
      .filter((market) => wanted.has(market.gameExternalId))
      .map((market) => ({
        gameExternalId: market.gameExternalId,
        type: market.type as MarketTypeValue,
        sourceBook: market.sourceBook,
        selections: atRound(market.rounds, this.round),
      }));
  }
}

export class FixtureScoreProvider implements ScoreProvider {
  private readonly round: number;

  constructor(options: RoundOptions = {}) {
    this.round = options.round ?? 0;
  }

  async getResults(gameExternalIds: string[]): Promise<ProviderResult[]> {
    const wanted = new Set(gameExternalIds);

    return results.results
      .filter((entry) => wanted.has(entry.gameExternalId))
      .map((entry) => ({
        ...atRound(entry.rounds, this.round),
        gameExternalId: entry.gameExternalId,
      }));
  }
}
