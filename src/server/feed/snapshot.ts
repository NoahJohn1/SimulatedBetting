import type { Sport } from '@/db/schema';
import type { FeedLegSnapshot } from './payload';

export interface SnapshotSource {
  sport: Sport;
  marketType: 'MONEYLINE' | 'SPREAD' | 'TOTAL';
  side: 'HOME' | 'AWAY' | 'OVER' | 'UNDER';
  homeAbbr: string;
  awayAbbr: string;
  startsAt: Date;
}

/**
 * Builds one card's leg snapshot.
 *
 * The split matters: market and team facts come from the source row, but `line` and
 * `priceAmerican` come from `frozen` — the leg's `line_at_placement` and
 * `price_at_placement`. Reading the live selection instead would let later line movement
 * rewrite an old card, which is exactly what D10 exists to prevent.
 */
export function buildLegSnapshot(
  source: SnapshotSource,
  frozen: { line: string | null; priceAmerican: number },
): FeedLegSnapshot {
  return {
    sport: source.sport,
    marketType: source.marketType,
    side: source.side,
    line: frozen.line,
    priceAmerican: frozen.priceAmerican,
    homeAbbr: source.homeAbbr,
    awayAbbr: source.awayAbbr,
    startsAt: source.startsAt.toISOString(),
  };
}
