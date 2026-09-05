import { formatKickoff } from '@/domain/dates';
import type { BoardGame, BoardMarket, BoardSelection } from '@/server/odds/board';
import { MARKET_ORDER } from './market-meta';
import { OddsCell } from './odds-cell';

/** The three odds cells for one team line, in the board's fixed market order. */
function cellsFor(
  game: BoardGame,
  byType: Map<string, BoardMarket>,
  side: 'HOME' | 'AWAY',
  totalSide: 'OVER' | 'UNDER',
  teamLabel: string,
) {
  return MARKET_ORDER.map((type) => {
    const market = byType.get(type);
    const wanted: BoardSelection['side'] = type === 'TOTAL' ? totalSide : side;
    const selection = market?.selections.find((s) => s.side === wanted);
    return (
      <OddsCell
        key={type}
        game={game}
        market={market}
        selection={selection}
        teamLabel={teamLabel}
      />
    );
  });
}

/**
 * A two-line row for one game: away team above home team, each with its three odds cells.
 * Replaces the old card-per-game layout (D77) — the market column header now lives once per
 * day section (day-section.tsx), not repeated inside every row.
 */
export function GameRow({ game }: { game: BoardGame }) {
  const byType = new Map(game.markets.map((m) => [m.type, m] as const));
  const kickoff = formatKickoff(game.startsAt);

  return (
    <article className="grid grid-cols-[minmax(0,1fr)_repeat(3,4rem)] items-center gap-x-2 gap-y-1 border-b border-line-subtle px-1 py-2 lg:grid-cols-[3.5rem_minmax(0,1fr)_repeat(3,4.5rem)]">
      <span className="row-span-2 hidden text-xs text-ink-muted lg:block">{kickoff}</span>

      <span className="truncate text-sm font-medium">
        <span className="text-ink-muted lg:hidden">{kickoff} </span>
        {game.awayTeam.abbreviation}
      </span>
      {cellsFor(game, byType, 'AWAY', 'OVER', game.awayTeam.abbreviation)}

      <span className="truncate text-sm font-medium">{game.homeTeam.abbreviation}</span>
      {cellsFor(game, byType, 'HOME', 'UNDER', game.homeTeam.abbreviation)}
    </article>
  );
}
