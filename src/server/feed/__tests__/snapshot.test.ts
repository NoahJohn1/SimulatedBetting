import { describe, expect, it } from 'vitest';
import { buildLegSnapshot } from '@/server/feed/snapshot';

describe('buildLegSnapshot', () => {
  const source = {
    sport: 'NFL' as const,
    marketType: 'SPREAD' as const,
    side: 'HOME' as const,
    homeAbbr: 'KC',
    awayAbbr: 'BUF',
    startsAt: new Date('2026-09-06T17:00:00Z'),
  };

  it('takes the line and price from the frozen values, not from the source row', () => {
    const snapshot = buildLegSnapshot(source, { line: '-3.50', priceAmerican: -115 });

    expect(snapshot.line).toBe('-3.50');
    expect(snapshot.priceAmerican).toBe(-115);
    expect(snapshot.homeAbbr).toBe('KC');
    expect(snapshot.awayAbbr).toBe('BUF');
    expect(snapshot.marketType).toBe('SPREAD');
  });

  it('serializes the kickoff as an ISO string so it survives jsonb', () => {
    const snapshot = buildLegSnapshot(source, { line: null, priceAmerican: -110 });
    expect(snapshot.startsAt).toBe('2026-09-06T17:00:00.000Z');
  });

  it('keeps a null line for a moneyline leg', () => {
    const snapshot = buildLegSnapshot(
      { ...source, marketType: 'MONEYLINE' },
      { line: null, priceAmerican: 150 },
    );
    expect(snapshot.line).toBeNull();
  });
});
