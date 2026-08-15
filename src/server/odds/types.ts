import type {
  GameStatus,
  MarketStatusValue,
  MarketTypeValue,
  SelectionSide,
  Sport,
} from '@/db/schema';

/**
 * The shape a provider hands back, deliberately independent of our table columns: a real
 * adapter (The Odds API first) maps its own response into these, and nothing downstream of
 * `syncOdds` needs to know which provider produced them.
 *
 * Everything is keyed by `externalId` rather than our uuids, because a provider has no idea
 * what our primary keys are — that mapping is `syncOdds`'s job.
 */
export interface ProviderTeam {
  externalId: string;
  name: string;
  abbreviation: string;
  logoUrl?: string | null;
}

export interface ProviderGame {
  externalId: string;
  sport: Sport;
  home: ProviderTeam;
  away: ProviderTeam;
  startsAt: Date;
  seasonYear: number;
  week: number | null;
  status: GameStatus;
}

export interface ProviderSelection {
  side: SelectionSide;
  /** Decimal string, or null for a moneyline. Strings all the way down — never a float. */
  line: string | null;
  priceAmerican: number;
}

export interface ProviderMarket {
  gameExternalId: string;
  type: MarketTypeValue;
  /** The designated house book for this market (D9). */
  sourceBook: string;
  /** What the book is currently offering. Defaults to OPEN when a provider omits it. */
  status?: MarketStatusValue;
  selections: ProviderSelection[];
}

export interface ProviderResult {
  gameExternalId: string;
  status: GameStatus;
  homeScore: number | null;
  awayScore: number | null;
}

export interface OddsProvider {
  getUpcomingGames(sport: Sport, withinDays: number): Promise<ProviderGame[]>;
  getMarkets(gameExternalIds: string[]): Promise<ProviderMarket[]>;
}

export interface ScoreProvider {
  getResults(gameExternalIds: string[]): Promise<ProviderResult[]>;
}
