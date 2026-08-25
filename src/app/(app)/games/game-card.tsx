'use client';

import { useSlip } from '@/components/bet-slip/slip-context';
import { Line, Price } from '@/components/ui/money';
import type { BoardGame, BoardMarket, BoardSelection } from '@/server/odds/board';

const MARKET_ORDER = ['SPREAD', 'MONEYLINE', 'TOTAL'] as const;
const MARKET_LABEL: Record<string, string> = {
  SPREAD: 'Spread',
  MONEYLINE: 'Money',
  TOTAL: 'Total',
};

/** `O `/`U ` ahead of a TOTAL selection's line — Line itself only knows the number. */
function sidePrefix(market: BoardMarket, selection: BoardSelection): string {
  return market.type === 'TOTAL' ? (selection.side === 'OVER' ? 'O ' : 'U ') : '';
}

/**
 * The plain-text description a slip leg carries (@/components/bet-slip/slip-context.tsx):
 * persisted to localStorage and later shown as ordinary text in the slip, so it has to be a
 * string, not the `Price`/`Line` components below — those are what the board itself renders.
 */
function selectionLabel(market: BoardMarket, selection: BoardSelection): string {
  if (market.type === 'MONEYLINE' || selection.line === null) {
    return selection.priceAmerican > 0 ? `+${selection.priceAmerican}` : String(selection.priceAmerican);
  }
  const value = Number(selection.line);
  const line = market.type === 'TOTAL' ? value : value > 0 ? `+${value}` : value;
  return `${sidePrefix(market, selection)}${line}`;
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
          ? 'border-accent bg-accent text-accent-ink'
          : 'border-line bg-surface-raised hover:border-line-hover'
      }`}
    >
      <span className="font-semibold tabular-nums">
        {market.type === 'MONEYLINE' || selection.line === null ? (
          <Price american={selection.priceAmerican} />
        ) : (
          <>
            {sidePrefix(market, selection)}
            <Line value={selection.line} market={market.type === 'TOTAL' ? 'TOTAL' : 'SPREAD'} />
          </>
        )}
      </span>
      {market.type !== 'MONEYLINE' ? (
        <span className="tabular-nums opacity-60">
          <Price american={selection.priceAmerican} />
        </span>
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
    <article className="overflow-hidden rounded-xl border border-line bg-surface-raised">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="text-xs font-medium text-ink-muted">{game.sport}</span>
        <span className="text-xs text-ink-muted">{kickoff} ET</span>
      </div>

      <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 px-3 py-2">
        <span />
        {MARKET_ORDER.map((type) => (
          <span key={type} className="w-16 text-center text-[10px] font-medium uppercase text-ink-subtle">
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
              <div className="flex h-12 items-center justify-center rounded-lg border border-dashed border-line text-xs text-ink-subtle">
                —
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
