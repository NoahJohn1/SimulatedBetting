import { describe, expect, it } from 'vitest';
import { buildCustomLegSnapshot } from '@/server/feed/snapshot';

describe('buildCustomLegSnapshot', () => {
  const startsAt = new Date('2026-09-12T23:00:00Z');

  it('freezes the event and outcome text and the placed price', () => {
    const snapshot = buildCustomLegSnapshot(
      {
        eventTitle: 'Jyxnzi Cup',
        marketTitle: 'Who wins map 3?',
        outcomeLabel: 'Falcons',
        startsAt,
        byCreator: false,
      },
      { priceAmerican: -150 },
    );

    expect(snapshot).toEqual({
      kind: 'CUSTOM',
      eventTitle: 'Jyxnzi Cup',
      marketTitle: 'Who wins map 3?',
      outcomeLabel: 'Falcons',
      priceAmerican: -150,
      startsAt: startsAt.toISOString(),
      byCreator: false,
    });
  });

  it('carries the creator flag through', () => {
    const snapshot = buildCustomLegSnapshot(
      {
        eventTitle: 'Jyxnzi Cup',
        marketTitle: 'Who wins?',
        outcomeLabel: 'Ravens',
        startsAt,
        byCreator: true,
      },
      { priceAmerican: 220 },
    );

    expect(snapshot.byCreator).toBe(true);
  });

  it('takes its price only from the frozen argument', () => {
    const snapshot = buildCustomLegSnapshot(
      {
        eventTitle: 'Cup',
        marketTitle: 'Who wins?',
        outcomeLabel: 'Falcons',
        startsAt,
        byCreator: false,
      },
      { priceAmerican: -110 },
    );

    // The source carries no price at all — its type has no such field — so there is no
    // path by which a creator's later reprice could reach an old card (D10).
    expect(snapshot.priceAmerican).toBe(-110);
  });
});
