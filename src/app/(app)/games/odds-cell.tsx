'use client';

import { useSlip } from '@/components/bet-slip/slip-context';
import { Line, Price } from '@/components/ui/money';
import type { BoardGame, BoardMarket, BoardSelection } from '@/server/odds/board';
import { MARKET_LABEL } from './market-meta';

/** `O `/`U ` ahead of a TOTAL selection's line — Line itself only knows the number. */
function sidePrefix(market: BoardMarket, selection: BoardSelection): string {
  return market.type === 'TOTAL' ? (selection.side === 'OVER' ? 'O ' : 'U ') : '';
}

/** `plus 27.5` / `minus 3` — the word form a screen reader should say instead of a bare sign. */
function signedWords(n: number): string {
  return n >= 0 ? `plus ${n}` : `minus ${Math.abs(n)}`;
}

/**
 * The full sentence a screen reader announces for a cell — team, market, line, and price spelled
 * out (Task 19's a11y pass): "ECU spread plus 27.5 at minus 102". The visible cell only ever
 * shows the numbers themselves (Line/Price below), which read as bare digits with no market or
 * team context; this is the one place that context gets said out loud. A total has no team side
 * of its own (the OVER cell renders on the away row and UNDER on the home row purely for grid
 * layout, per game-row.tsx's `cellsFor`), so it names the direction instead of borrowing
 * whichever team happens to share its row.
 */
function cellAriaLabel(market: BoardMarket, selection: BoardSelection, teamLabel: string): string {
  const price = signedWords(selection.priceAmerican);

  if (market.type === 'MONEYLINE' || selection.line === null) {
    return `${teamLabel} moneyline at ${price}`;
  }
  if (market.type === 'TOTAL') {
    const direction = selection.side === 'OVER' ? 'Over' : 'Under';
    return `${direction} ${Number(selection.line)} at ${price}`;
  }
  return `${teamLabel} spread ${signedWords(Number(selection.line))} at ${price}`;
}

/**
 * The plain-text description a slip leg carries (@/components/bet-slip/slip-context.tsx):
 * persisted to localStorage and later shown as ordinary text in the slip, so it has to be a
 * string, not the `Price`/`Line` components below — those are what the board itself renders.
 */
function selectionLabel(market: BoardMarket, selection: BoardSelection): string {
  if (market.type === 'MONEYLINE' || selection.line === null) {
    return selection.priceAmerican > 0
      ? `+${selection.priceAmerican}`
      : String(selection.priceAmerican);
  }
  const value = Number(selection.line);
  const line = market.type === 'TOTAL' ? value : value > 0 ? `+${value}` : value;
  return `${sidePrefix(market, selection)}${line}`;
}

/**
 * One odds cell on the board: extracted out of games/game-card.tsx (D77), which had one copy
 * per card. A row has six of these, and a board can hold dozens of rows, so this is the unit
 * that owns selected state, the slip-context toggle, and suspended rendering — unchanged from
 * the old `OddsButton`/`FragmentRow` split. Two distinct non-interactive cases, not one: a
 * missing selection (no market for this game yet) renders the dashed "—" placeholder, exactly
 * as the caller used to render it inline; a present selection on a non-OPEN market still shows
 * its price, just disabled and dimmed — a bettor can see what the line was without being able
 * to act on it, which is not the same information as "—".
 */
export function OddsCell({
  game,
  market,
  selection,
  teamLabel,
}: {
  game: BoardGame;
  market: BoardMarket | undefined;
  selection: BoardSelection | undefined;
  teamLabel: string;
}) {
  const slip = useSlip();

  if (!market || !selection) {
    return (
      <div
        aria-label={`${teamLabel}: no line yet`}
        className="flex h-12 w-16 items-center justify-center rounded-lg border border-dashed border-line text-xs text-ink-muted"
      >
        —
      </div>
    );
  }

  const disabled = market.status !== 'OPEN';
  const active = slip.has(selection.id);

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={cellAriaLabel(market, selection, teamLabel)}
      aria-pressed={active}
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
      className={`flex h-12 w-16 flex-col items-center justify-center rounded-lg border text-xs transition-colors duration-[var(--motion-fast)] disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? 'border-accent bg-accent text-accent-ink'
          : 'border-line bg-surface-sunken hover:border-line-hover'
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
