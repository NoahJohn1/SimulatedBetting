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
