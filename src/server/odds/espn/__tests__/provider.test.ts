import { afterEach, describe, expect, it, vi } from 'vitest';
import { EspnOddsProvider, EspnScoreProvider } from '../provider';

function scoreboardWith(events: unknown[]): Response {
  return new Response(JSON.stringify({ events }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const NFL_EVENT = {
  id: '1',
  date: '2026-09-10T17:00Z',
  season: { year: 2026 },
  week: { number: 2 },
  competitions: [
    {
      id: '1',
      status: { type: { state: 'pre', name: 'STATUS_SCHEDULED', completed: false } },
      competitors: [
        {
          homeAway: 'home',
          score: '0',
          team: { id: '10', abbreviation: 'AAA', displayName: 'Team AAA' },
        },
        {
          homeAway: 'away',
          score: '0',
          team: { id: '11', abbreviation: 'BBB', displayName: 'Team BBB' },
        },
      ],
      odds: [
        {
          provider: { displayName: 'DraftKings' },
          moneyline: {
            home: { close: { odds: '-120' } },
            away: { close: { odds: '+100' } },
          },
        },
      ],
    },
  ],
};

const NCAAF_EVENT = {
  ...NFL_EVENT,
  id: '2',
  competitions: [{ ...NFL_EVENT.competitions[0], id: '2' }],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('EspnOddsProvider', () => {
  it('getUpcomingGames returns games for the requested sport only', async () => {
    const fetchMock = vi.fn().mockImplementation(() => scoreboardWith([NFL_EVENT]));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new EspnOddsProvider();
    const games = await provider.getUpcomingGames('NFL', 14);

    expect(games).toHaveLength(1);
    expect(games[0].externalId).toBe('1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0] as string).toContain('/nfl/scoreboard');
  });

  it('getMarkets fans out to both sports and filters by the wanted external IDs', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/nfl/scoreboard')) return scoreboardWith([NFL_EVENT]);
      return scoreboardWith([NCAAF_EVENT]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new EspnOddsProvider();
    await provider.getUpcomingGames('NFL', 14);
    await provider.getUpcomingGames('NCAAF', 14);

    const markets = await provider.getMarkets(['1', '2']);

    expect(markets.filter((m) => m.gameExternalId === '1')).toHaveLength(1);
    expect(markets.filter((m) => m.gameExternalId === '2')).toHaveLength(1);
    // 2 calls for getUpcomingGames (NFL, NCAAF) + 2 for getMarkets' fan-out (NFL, NCAAF)
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('getSkipped accumulates across both getUpcomingGames and getMarkets calls', async () => {
    const brokenEvent = {
      ...NFL_EVENT,
      competitions: [{ ...NFL_EVENT.competitions[0], competitors: [] }],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => scoreboardWith([brokenEvent])),
    );

    const provider = new EspnOddsProvider();
    await provider.getUpcomingGames('NFL', 14);
    await provider.getUpcomingGames('NCAAF', 14);
    await provider.getMarkets([]);

    const skipped = provider.getSkipped();
    expect(skipped).toEqual({ games: 2, markets: 0 });
  });
});

describe('EspnScoreProvider', () => {
  it('getResults fans out to both sports and filters by the wanted external IDs', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/nfl/scoreboard')) return scoreboardWith([NFL_EVENT]);
      return scoreboardWith([NCAAF_EVENT]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new EspnScoreProvider();
    const results = await provider.getResults(['1', '2']);

    expect(results.map((r) => r.gameExternalId).sort()).toEqual(['1', '2']);
  });

  it('requests a backward-looking window, not a forward-only one', async () => {
    const fetchMock = vi.fn().mockImplementation(() => scoreboardWith([NFL_EVENT]));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new EspnScoreProvider();
    await provider.getResults(['1']);

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    const [from, to] = url.searchParams.get('dates')!.split('-');
    expect(from < to).toBe(true);
    // from must be before today: verifies daysBack > 0 was actually applied
    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    expect(from < todayStr).toBe(true);
  });
});
