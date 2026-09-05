import { formatKickoff } from '@/domain/dates';
import type { MarketTypeValue, SelectionSide } from '@/db/schema';

const MARKET_LABEL: Record<MarketTypeValue, string> = {
  SPREAD: 'Spread',
  MONEYLINE: 'Money',
  TOTAL: 'Total',
  CUSTOM_OUTCOME: 'Custom',
};

/**
 * What a bet card needs to name a leg's game (Task 9). Six fields ride along on the page's
 * `legRows` select beyond what the leg itself carries — `homeAbbr`, `awayAbbr` and `startsAt`
 * come from left joins through `games` and `teams` (twice, home/away) that are null for a
 * CUSTOM leg, same as `side` already was.
 */
export interface LegLineData {
  eventKind: 'GAME' | 'CUSTOM';
  eventTitle: string;
  marketType: MarketTypeValue;
  outcomeLabel: string | null;
  side: SelectionSide | null;
  line: string | null;
  homeAbbr: string | null;
  awayAbbr: string | null;
  startsAt: Date | null;
}

/**
 * The team-name half of a leg's description: `side` resolved against the game's own
 * abbreviations for HOME/AWAY, and the board's `O`/`U` convention for a TOTAL's OVER/UNDER
 * (@/app/(app)/games/odds-cell.tsx's `sidePrefix`).
 */
function sideText(leg: LegLineData): string {
  if (leg.side === 'HOME') return leg.homeAbbr ?? 'HOME';
  if (leg.side === 'AWAY') return leg.awayAbbr ?? 'AWAY';
  if (leg.side === 'OVER') return 'O';
  if (leg.side === 'UNDER') return 'U';
  return leg.side ?? '';
}

/** A leading space plus the signed line, matching `Line`'s no-sign-on-TOTAL rule — empty for
 * a moneyline leg, which carries no line at all. */
function lineText(leg: LegLineData): string {
  if (leg.line === null) return '';
  const value = Number(leg.line);
  const signed = leg.marketType === 'TOTAL' ? value : value > 0 ? `+${value}` : value;
  return ` ${signed}`;
}

/**
 * The leg description a bet card renders. The walk's worst finding was a game leg that said
 * "SPREAD · AWAY 2.5 −112" with no team on it; this renders "ECU @ ALA · Spread · ECU +27.5"
 * with kickoff trailing, and a custom leg as "<event title> · <outcome>". The price itself
 * stays a separate `<Price>` at the call site — this component is text only.
 */
export function LegLine({ leg }: { leg: LegLineData }) {
  if (leg.eventKind === 'CUSTOM') {
    return (
      <span>
        {leg.eventTitle} · {leg.outcomeLabel ?? ''}
      </span>
    );
  }

  const matchup = `${leg.awayAbbr ?? '?'} @ ${leg.homeAbbr ?? '?'}`;
  return (
    <span>
      {matchup} · {MARKET_LABEL[leg.marketType]} · {sideText(leg)}
      {lineText(leg)}
      {leg.startsAt ? ` · ${formatKickoff(leg.startsAt)}` : ''}
    </span>
  );
}
