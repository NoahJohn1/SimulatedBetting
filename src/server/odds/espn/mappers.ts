import type { GameStatus, Sport } from '@/db/schema';
import type {
  ProviderGame,
  ProviderMarket,
  ProviderResult,
  ProviderSelection,
  ProviderTeam,
} from '../types';
import { parseLine } from './parse-line';
import type { EspnCompetition, EspnEvent, EspnOdds, EspnStatusType, EspnTeamRef } from './espn-types';

/**
 * Buckets ESPN's ~10 detailed status names into our 5-value enum, primarily off `state`
 * (`pre`/`in`/`post`) rather than `name`, since `name` has far more variants than we have
 * buckets for. A `post` status that isn't `completed` and isn't recognizably postponed or
 * canceled falls back to IN_PROGRESS rather than FINAL — an unrecognized status must never
 * silently trigger settlement.
 */
export function mapStatus(type: EspnStatusType): GameStatus {
  if (type.state === 'pre') return 'SCHEDULED';
  if (type.state === 'in') return 'IN_PROGRESS';

  if (type.completed) return 'FINAL';
  if (type.name === 'STATUS_POSTPONED') return 'POSTPONED';
  if (type.name === 'STATUS_CANCELED') return 'CANCELED';
  return 'IN_PROGRESS';
}

function competitors(competition: EspnCompetition): {
  home: EspnCompetition['competitors'][number];
  away: EspnCompetition['competitors'][number];
} {
  const home = competition.competitors.find((c) => c.homeAway === 'home');
  const away = competition.competitors.find((c) => c.homeAway === 'away');
  if (!home || !away) {
    throw new Error(`competition ${competition.id} is missing a home or away competitor`);
  }
  return { home, away };
}

function mapTeam(team: EspnTeamRef): ProviderTeam {
  return {
    externalId: team.id,
    name: team.displayName,
    abbreviation: team.abbreviation,
    logoUrl: team.logo ?? null,
  };
}

/** A game that hasn't started yet has no meaningful score — ESPN reports "0", we report null. */
function mapScore(status: GameStatus, raw: string | undefined): number | null {
  if (status === 'SCHEDULED' || status === 'POSTPONED' || status === 'CANCELED') return null;
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function mapGame(event: EspnEvent, sport: Sport): ProviderGame {
  const competition = event.competitions[0];
  const { home, away } = competitors(competition);

  return {
    externalId: competition.id,
    sport,
    home: mapTeam(home.team),
    away: mapTeam(away.team),
    startsAt: new Date(event.date),
    seasonYear: event.season.year,
    week: event.week?.number ?? null,
    status: mapStatus(competition.status.type),
  };
}

export function mapResult(event: EspnEvent): ProviderResult {
  const competition = event.competitions[0];
  const { home, away } = competitors(competition);
  const status = mapStatus(competition.status.type);

  return {
    gameExternalId: competition.id,
    status,
    homeScore: mapScore(status, home.score),
    awayScore: mapScore(status, away.score),
  };
}

function spreadMarket(gameExternalId: string, sourceBook: string, odds: EspnOdds): ProviderMarket {
  const selections: ProviderSelection[] = [
    {
      side: 'HOME',
      line: parseLine(odds.pointSpread!.home.close.line!),
      priceAmerican: Number(odds.pointSpread!.home.close.odds),
    },
    {
      side: 'AWAY',
      line: parseLine(odds.pointSpread!.away.close.line!),
      priceAmerican: Number(odds.pointSpread!.away.close.odds),
    },
  ];
  return { gameExternalId, type: 'SPREAD', sourceBook, selections };
}

function totalMarket(gameExternalId: string, sourceBook: string, odds: EspnOdds): ProviderMarket {
  const selections: ProviderSelection[] = [
    {
      side: 'OVER',
      line: parseLine(odds.total!.over.close.line!),
      priceAmerican: Number(odds.total!.over.close.odds),
    },
    {
      side: 'UNDER',
      line: parseLine(odds.total!.under.close.line!),
      priceAmerican: Number(odds.total!.under.close.odds),
    },
  ];
  return { gameExternalId, type: 'TOTAL', sourceBook, selections };
}

function moneylineMarket(gameExternalId: string, sourceBook: string, odds: EspnOdds): ProviderMarket {
  const selections: ProviderSelection[] = [
    { side: 'HOME', line: null, priceAmerican: Number(odds.moneyline!.home.close.odds) },
    { side: 'AWAY', line: null, priceAmerican: Number(odds.moneyline!.away.close.odds) },
  ];
  return { gameExternalId, type: 'MONEYLINE', sourceBook, selections };
}

/**
 * Each market type is extracted independently so a malformed `pointSpread` doesn't take
 * `moneyline` down with it. A missing `odds` array (no line posted yet) is normal — zero
 * markets, zero skips. A present-but-malformed market — the field exists but doesn't match
 * the expected shape — is what increments `skipped`.
 */
export function mapMarkets(event: EspnEvent): { markets: ProviderMarket[]; skipped: number } {
  const competition = event.competitions[0];
  const odds = competition.odds?.[0];
  if (!odds) return { markets: [], skipped: 0 };

  const gameExternalId = competition.id;
  const sourceBook = odds.provider.displayName;
  const markets: ProviderMarket[] = [];
  let skipped = 0;

  if (odds.pointSpread) {
    try {
      markets.push(spreadMarket(gameExternalId, sourceBook, odds));
    } catch {
      skipped += 1;
    }
  }

  if (odds.total) {
    try {
      markets.push(totalMarket(gameExternalId, sourceBook, odds));
    } catch {
      skipped += 1;
    }
  }

  if (odds.moneyline) {
    try {
      markets.push(moneylineMarket(gameExternalId, sourceBook, odds));
    } catch {
      skipped += 1;
    }
  }

  return { markets, skipped };
}
