import { Line } from '@/components/ui/money';
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
 * The team-name half of a leg's side, resolved against the game's own abbreviations for
 * HOME/AWAY. Empty for a TOTAL leg — its OVER/UNDER is named by `sidePrefix` below instead,
 * exactly as the board itself splits the two (@/app/(app)/games/odds-cell.tsx).
 */
function teamText(leg: LegLineData): string {
  if (leg.side === 'HOME') return leg.homeAbbr ?? 'HOME';
  if (leg.side === 'AWAY') return leg.awayAbbr ?? 'AWAY';
  return '';
}

/** `O `/`U ` ahead of a TOTAL leg's line — `Line` itself only knows the number, same split as
 * odds-cell.tsx's `sidePrefix`. */
function sidePrefix(leg: LegLineData): string {
  return leg.marketType === 'TOTAL' ? (leg.side === 'OVER' ? 'O ' : 'U ') : '';
}

/**
 * The leg description a bet card renders. The walk's worst finding was a game leg that said
 * "SPREAD · AWAY 2.5 −112" with no team on it; this renders "ECU @ ALA · Spread · ECU +27.5"
 * with kickoff trailing, and a custom leg as "<event title> · <outcome>".
 *
 * The line itself goes through the shared `Line` component rather than a hand-formatted
 * string: `Line` is the one place the sign convention (no sign on TOTAL, a leading `+` on a
 * positive SPREAD) lives, and rendering it directly — instead of restating that rule here —
 * is also what keeps the number's `tabular-nums` alignment with every other odds display. The
 * price itself stays a separate `<Price>` at the call site.
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
  const teamName = teamText(leg);

  return (
    <span>
      {matchup} · {MARKET_LABEL[leg.marketType]} · {teamName}
      {teamName && leg.line !== null ? ' ' : null}
      {leg.line !== null && (
        <>
          {sidePrefix(leg)}
          <Line value={leg.line} market={leg.marketType === 'TOTAL' ? 'TOTAL' : 'SPREAD'} />
        </>
      )}
      {leg.startsAt ? ` · ${formatKickoff(leg.startsAt)}` : ''}
    </span>
  );
}
