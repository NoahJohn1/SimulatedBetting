'use client';

import { useSlip } from '@/components/bet-slip/slip-context';
import type { BoardGame, BoardMarket, BoardSelection } from '@/server/odds/board';

const MARKET_ORDER = ['SPREAD', 'MONEYLINE', 'TOTAL'] as const;
const MARKET_LABEL: Record<string, string> = {
  SPREAD: 'Spread',
  MONEYLINE: 'Money',
  TOTAL: 'Total',
};

function signed(price: number): string {
  return price > 0 ? `+${price}` : String(price);
}

/** The number shown on the button: the line where there is one, otherwise just the price. */
function selectionLabel(market: BoardMarket, selection: BoardSelection): string {
  if (market.type === 'MONEYLINE') return signed(selection.priceAmerican);
  if (selection.line === null) return signed(selection.priceAmerican);

  const value = Number(selection.line);
  const prefix = market.type === 'TOTAL' ? (selection.side === 'OVER' ? 'O ' : 'U ') : '';
  const line = market.type === 'TOTAL' ? value : value > 0 ? `+${value}` : value;
  return `${prefix}${line}`;
}

function OddsButton({
  game,
  market,
  selection,
  teamLabel,
}: {
  game: BoardGame;
  market: BoardMarket;
  selection: BoardSelection;
  teamLabel: string;
}) {
  const slip = useSlip();
  const disabled = market.status !== 'OPEN';
  const active = slip.has(selection.id);

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() =>
        slip.toggle({
          selectionId: selection.id,
          gameId: game.id,
          line: selection.line,
          priceAmerican: selection.priceAmerican,
          label: `${teamLabel} ${selectionLabel(market, selection)}`,
          marketLabel: MARKET_LABEL[market.type] ?? market.type,
          // A game is bet in cash, always — credits are the custom-event denomination (D31).
          currency: 'CASH',
        })
      }
      className={`flex h-12 flex-col items-center justify-center rounded-lg border text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
          : 'border-zinc-200 bg-white hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900'
      }`}
    >
      <span className="font-semibold tabular-nums">{selectionLabel(market, selection)}</span>
      {market.type !== 'MONEYLINE' ? (
        <span className="tabular-nums opacity-60">{signed(selection.priceAmerican)}</span>
      ) : null}
    </button>
  );
}

export function GameCard({ game }: { game: BoardGame }) {
  const byType = new Map(game.markets.map((m) => [m.type, m]));
  const kickoff = game.startsAt.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });

  const rows: { label: string; side: 'HOME' | 'AWAY'; totalSide: 'OVER' | 'UNDER' }[] = [
    { label: game.awayTeam.abbreviation, side: 'AWAY', totalSide: 'OVER' },
    { label: game.homeTeam.abbreviation, side: 'HOME', totalSide: 'UNDER' },
  ];

  return (
    <article className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
        <span className="text-xs font-medium text-zinc-500">{game.sport}</span>
        <span className="text-xs text-zinc-500">{kickoff} ET</span>
      </div>

      <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 px-3 py-2">
        <span />
        {MARKET_ORDER.map((type) => (
          <span key={type} className="w-16 text-center text-[10px] font-medium uppercase text-zinc-400">
            {MARKET_LABEL[type]}
          </span>
        ))}

        {rows.map((row) => (
          <FragmentRow key={row.side} game={game} byType={byType} row={row} />
        ))}
      </div>
    </article>
  );
}

function FragmentRow({
  game,
  byType,
  row,
}: {
  game: BoardGame;
  byType: Map<string, BoardMarket>;
  row: { label: string; side: 'HOME' | 'AWAY'; totalSide: 'OVER' | 'UNDER' };
}) {
  return (
    <>
      <span className="truncate text-sm font-medium">{row.label}</span>
      {MARKET_ORDER.map((type) => {
        const market = byType.get(type);
        const wanted = type === 'TOTAL' ? row.totalSide : row.side;
        const selection = market?.selections.find((s) => s.side === wanted);

        return (
          <div key={type} className="w-16">
            {market && selection ? (
              <OddsButton
                game={game}
                market={market}
                selection={selection}
                teamLabel={row.label}
              />
            ) : (
              <div className="flex h-12 items-center justify-center rounded-lg border border-dashed border-zinc-200 text-xs text-zinc-300 dark:border-zinc-800">
                —
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
