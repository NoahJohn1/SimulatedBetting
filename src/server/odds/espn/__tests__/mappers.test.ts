import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mapGame, mapMarkets, mapResult } from '../mappers';
import type { EspnScoreboardResponse } from '../espn-types';

function loadFixture(name: string): EspnScoreboardResponse {
  const file = path.join(__dirname, 'fixtures', name);
  return JSON.parse(readFileSync(file, 'utf-8'));
}

const withOdds = loadFixture('event-with-odds.json').events[0];
const withoutOdds = loadFixture('event-without-odds.json').events[0];
const final = loadFixture('event-final.json').events[0];

describe('mapGame', () => {
  it('maps a scheduled game', () => {
    const game = mapGame(withOdds, 'NFL');

    expect(game).toEqual({
      externalId: '401873601',
      sport: 'NFL',
      home: {
        externalId: '8',
        name: 'Detroit Lions',
        abbreviation: 'DET',
        logoUrl: 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/det.png',
      },
      away: {
        externalId: '28',
        name: 'Washington Commanders',
        abbreviation: 'WSH',
        logoUrl: 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/wsh.png',
      },
      startsAt: new Date('2026-08-22T16:00Z'),
      seasonYear: 2026,
      week: 3,
      status: 'SCHEDULED',
    });
  });

  it('maps a final game status to FINAL', () => {
    const game = mapGame(final, 'NFL');
    expect(game.status).toBe('FINAL');
  });

  it('throws when a competitor is missing, for the caller to catch', () => {
    const broken = {
      ...withOdds,
      competitions: [{ ...withOdds.competitions[0], competitors: [] }],
    };
    expect(() => mapGame(broken, 'NFL')).toThrow();
  });

  it('throws when event.date is unparseable, instead of returning an Invalid Date', () => {
    const broken = { ...withOdds, date: 'garbage' };
    expect(() => mapGame(broken, 'NFL')).toThrow();
  });
});

describe('mapResult', () => {
  it('reports null scores for a game that has not started', () => {
    const result = mapResult(withOdds);
    expect(result).toEqual({
      gameExternalId: '401873601',
      status: 'SCHEDULED',
      homeScore: null,
      awayScore: null,
    });
  });

  it('reports real scores for a final game', () => {
    const result = mapResult(final);
    expect(result).toEqual({
      gameExternalId: '401873286',
      status: 'FINAL',
      homeScore: 20,
      awayScore: 22,
    });
  });

  it('throws instead of fabricating a 0 when a FINAL game has a null score', () => {
    const broken = {
      ...final,
      competitions: [
        {
          ...final.competitions[0],
          competitors: [
            { ...final.competitions[0].competitors[0], score: null as unknown as string },
            final.competitions[0].competitors[1],
          ],
        },
      ],
    };
    expect(() => mapResult(broken)).toThrow();
  });

  it('throws instead of fabricating a 0 when a FINAL game has an empty-string score', () => {
    const broken = {
      ...final,
      competitions: [
        {
          ...final.competitions[0],
          competitors: [
            { ...final.competitions[0].competitors[0], score: '' },
            final.competitions[0].competitors[1],
          ],
        },
      ],
    };
    expect(() => mapResult(broken)).toThrow();
  });
});

describe('mapMarkets', () => {
  it('maps all three market types with prices normalized', () => {
    const { markets, skipped } = mapMarkets(withOdds);

    expect(skipped).toBe(0);
    expect(markets).toEqual([
      {
        gameExternalId: '401873601',
        type: 'SPREAD',
        sourceBook: 'DraftKings',
        selections: [
          { side: 'HOME', line: '-1.5', priceAmerican: -105 },
          { side: 'AWAY', line: '1.5', priceAmerican: -115 },
        ],
      },
      {
        gameExternalId: '401873601',
        type: 'TOTAL',
        sourceBook: 'DraftKings',
        selections: [
          { side: 'OVER', line: '36.5', priceAmerican: -105 },
          { side: 'UNDER', line: '36.5', priceAmerican: -115 },
        ],
      },
      {
        gameExternalId: '401873601',
        type: 'MONEYLINE',
        sourceBook: 'DraftKings',
        selections: [
          { side: 'HOME', line: null, priceAmerican: -118 },
          { side: 'AWAY', line: null, priceAmerican: -102 },
        ],
      },
    ]);
  });

  it('returns no markets, and no skips, when odds have not been posted yet', () => {
    const { markets, skipped } = mapMarkets(withoutOdds);
    expect(markets).toEqual([]);
    expect(skipped).toBe(0);
  });

  it('skips only the malformed market type and keeps the rest', () => {
    const broken = {
      ...withOdds,
      competitions: [
        {
          ...withOdds.competitions[0],
          odds: [
            {
              ...withOdds.competitions[0].odds![0],
              // pointSpread is present but missing the nested price object entirely
              pointSpread: {} as never,
            },
          ],
        },
      ],
    };

    const { markets, skipped } = mapMarkets(broken);

    expect(skipped).toBe(1);
    expect(markets.map((m) => m.type).sort()).toEqual(['MONEYLINE', 'TOTAL']);
  });

  it('skips a market whose price is finite but not a valid American odds magnitude (e.g. "0")', () => {
    const broken = {
      ...withOdds,
      competitions: [
        {
          ...withOdds.competitions[0],
          odds: [
            {
              ...withOdds.competitions[0].odds![0],
              moneyline: {
                home: { close: { odds: '0' } },
                away: { close: { odds: '-102' } },
              },
            },
          ],
        },
      ],
    };

    const { markets, skipped } = mapMarkets(broken);

    expect(markets.map((m) => m.type)).not.toContain('MONEYLINE');
    expect(skipped).toBe(1);
  });

  it('skips markets ESPN reports as "OFF" (a pulled book) and keeps the clean one', () => {
    const marketOff = loadFixture('event-market-off.json').events[0];

    const { markets, skipped } = mapMarkets(marketOff);

    expect(() => mapMarkets(marketOff)).not.toThrow();
    expect(markets).toEqual([
      {
        gameExternalId: '401856767',
        type: 'SPREAD',
        sourceBook: 'DraftKings',
        selections: [
          { side: 'HOME', line: '-41.5', priceAmerican: -110 },
          { side: 'AWAY', line: '41.5', priceAmerican: -110 },
        ],
      },
    ]);
    expect(markets.map((m) => m.type)).not.toContain('TOTAL');
    expect(markets.map((m) => m.type)).not.toContain('MONEYLINE');
    expect(skipped).toBe(2);
    expect(markets[0].sourceBook).toBe('DraftKings');
  });
});
