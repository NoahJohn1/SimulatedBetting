import { americanToRational, combine, payoutCents } from './odds';

export type MarketType = 'MONEYLINE' | 'SPREAD' | 'TOTAL';
export type Side = 'HOME' | 'AWAY' | 'OVER' | 'UNDER';
export type LegStatus = 'PENDING' | 'WON' | 'LOST' | 'PUSHED' | 'VOIDED';
export type SettledLegStatus = 'WON' | 'LOST' | 'PUSHED';

export interface GameResult {
  homeScore: number;
  awayScore: number;
}

export interface GradeLegInput {
  marketType: MarketType;
  side: Side;
  line: number | null;
  result: GameResult;
}

function compare(a: number, b: number): SettledLegStatus {
  if (a > b) return 'WON';
  if (a < b) return 'LOST';
  return 'PUSHED';
}

export function gradeLeg(input: GradeLegInput): SettledLegStatus {
  const { marketType, side, line, result } = input;

  if (marketType === 'MONEYLINE') {
    if (line !== null) throw new Error('moneyline legs must not carry a line');
    if (side !== 'HOME' && side !== 'AWAY') throw new Error(`invalid moneyline side: ${side}`);

    return side === 'HOME'
      ? compare(result.homeScore, result.awayScore)
      : compare(result.awayScore, result.homeScore);
  }

  if (line === null) throw new Error(`${marketType} legs require a line`);

  if (marketType === 'SPREAD') {
    if (side !== 'HOME' && side !== 'AWAY') throw new Error(`invalid spread side: ${side}`);

    return side === 'HOME'
      ? compare(result.homeScore + line, result.awayScore)
      : compare(result.awayScore + line, result.homeScore);
  }

  if (side !== 'OVER' && side !== 'UNDER') throw new Error(`invalid total side: ${side}`);

  const total = result.homeScore + result.awayScore;
  return side === 'OVER' ? compare(total, line) : compare(line, total);
}

export function gradeParlay(statuses: LegStatus[]): LegStatus {
  if (statuses.length === 0) throw new Error('a parlay needs at least one leg');

  if (statuses.includes('LOST')) return 'LOST';
  if (statuses.includes('PENDING')) return 'PENDING';

  const surviving = statuses.filter((s) => s === 'WON');
  return surviving.length === 0 ? 'PUSHED' : 'WON';
}

export interface SettledLeg {
  status: LegStatus;
  priceAmerican: number;
}

/** Total return for a settled bet. Pushed and voided legs are removed from the parlay. */
export function settledPayoutCents(stakeCents: bigint, legs: SettledLeg[]): bigint {
  const outcome = gradeParlay(legs.map((leg) => leg.status));

  if (outcome === 'PENDING') throw new Error('cannot pay out a bet with pending legs');
  if (outcome === 'LOST') return 0n;
  if (outcome === 'PUSHED') return stakeCents;

  const surviving = legs.filter((leg) => leg.status === 'WON');
  return payoutCents(
    stakeCents,
    combine(surviving.map((leg) => americanToRational(leg.priceAmerican))),
  );
}
