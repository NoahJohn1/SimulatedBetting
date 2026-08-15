import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { games, markets, selections, teams } from '@/db/schema';
import type { MarketStatusValue, MarketTypeValue, SelectionSide, Sport } from '@/db/schema';

export interface BoardSelection {
  id: string;
  side: SelectionSide;
  line: string | null;
  priceAmerican: number;
}

export interface BoardMarket {
  id: string;
  type: MarketTypeValue;
  status: MarketStatusValue;
  selections: BoardSelection[];
}

export interface BoardGame {
  id: string;
  sport: Sport;
  startsAt: Date;
  status: string;
  homeTeam: { name: string; abbreviation: string };
  awayTeam: { name: string; abbreviation: string };
  homeScore: number | null;
  awayScore: number | null;
  markets: BoardMarket[];
}

/**
 * The odds board: scheduled games with kickoff still ahead, and their markets.
 *
 * One query per level rather than a single wide join — a Saturday slate is 60+ games with
 * three markets and two selections each, and the flat join would return every game row six
 * times over just to be regrouped in memory.
 */
export async function getSlate(now: Date = new Date()): Promise<BoardGame[]> {
  const gameRows = await db
    .select({
      id: games.id,
      sport: games.sport,
      startsAt: games.startsAt,
      status: games.status,
      homeScore: games.homeScore,
      awayScore: games.awayScore,
      homeTeamId: games.homeTeamId,
      awayTeamId: games.awayTeamId,
    })
    .from(games)
    .where(and(eq(games.status, 'SCHEDULED'), gt(games.startsAt, now)))
    .orderBy(asc(games.startsAt));

  if (gameRows.length === 0) return [];

  const teamIds = [
    ...new Set(gameRows.flatMap((g) => [g.homeTeamId, g.awayTeamId])),
  ];
  const teamRows = await db
    .select({ id: teams.id, name: teams.name, abbreviation: teams.abbreviation })
    .from(teams)
    .where(inArray(teams.id, teamIds));
  const teamById = new Map(teamRows.map((t) => [t.id, t]));

  const gameIds = gameRows.map((g) => g.id);
  const marketRows = await db
    .select({
      id: markets.id,
      gameId: markets.gameId,
      type: markets.type,
      status: markets.status,
    })
    .from(markets)
    .where(inArray(markets.gameId, gameIds));

  const selectionRows = marketRows.length
    ? await db
        .select({
          id: selections.id,
          marketId: selections.marketId,
          side: selections.side,
          line: selections.line,
          priceAmerican: selections.priceAmerican,
        })
        .from(selections)
        .where(
          inArray(
            selections.marketId,
            marketRows.map((m) => m.id),
          ),
        )
    : [];

  const selectionsByMarket = new Map<string, BoardSelection[]>();
  for (const row of selectionRows) {
    const list = selectionsByMarket.get(row.marketId) ?? [];
    list.push({
      id: row.id,
      side: row.side,
      line: row.line,
      priceAmerican: row.priceAmerican,
    });
    selectionsByMarket.set(row.marketId, list);
  }

  const marketsByGame = new Map<string, BoardMarket[]>();
  for (const row of marketRows) {
    const list = marketsByGame.get(row.gameId) ?? [];
    list.push({
      id: row.id,
      type: row.type,
      status: row.status,
      selections: selectionsByMarket.get(row.id) ?? [],
    });
    marketsByGame.set(row.gameId, list);
  }

  return gameRows.map((game) => ({
    id: game.id,
    sport: game.sport,
    startsAt: game.startsAt,
    status: game.status,
    homeTeam: teamById.get(game.homeTeamId) ?? { name: 'Home', abbreviation: 'HOME' },
    awayTeam: teamById.get(game.awayTeamId) ?? { name: 'Away', abbreviation: 'AWAY' },
    homeScore: game.homeScore,
    awayScore: game.awayScore,
    markets: marketsByGame.get(game.id) ?? [],
  }));
}
