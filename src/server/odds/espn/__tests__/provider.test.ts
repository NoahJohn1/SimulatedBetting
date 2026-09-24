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
    // today + 14 days, one request per day
    expect(fetchMock).toHaveBeenCalledTimes(15);
    for (const call of fetchMock.mock.calls) {
      expect(call[0] as string).toContain('/nfl/scoreboard');
    }
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
    // 15 days × 2 sports, all from getUpcomingGames — getMarkets reuses them
    expect(fetchMock).toHaveBeenCalledTimes(30);
  });

  it('getMarkets fetches a sport itself when getUpcomingGames never did', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/nfl/scoreboard')) return scoreboardWith([NFL_EVENT]);
      return scoreboardWith([NCAAF_EVENT]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new EspnOddsProvider();
    await provider.getUpcomingGames('NFL', 14);
    fetchMock.mockClear();

    const markets = await provider.getMarkets(['1', '2']);

    expect(markets.map((m) => m.gameExternalId).sort()).toEqual(['1', '2']);
    // NFL reused; only NCAAF's 15 days fetched
    expect(fetchMock).toHaveBeenCalledTimes(15);
    for (const call of fetchMock.mock.calls) {
      expect(call[0] as string).toContain('/college-football/scoreboard');
    }
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
    // the mock returns the broken event on each of 15 days, for each of 2 sports
    expect(skipped).toEqual({ games: 30, markets: 0 });
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

    const nflDates = fetchMock.mock.calls
      .map((call) => new URL(call[0] as string))
      .filter((url) => url.pathname.includes('/nfl/'))
      .map((url) => url.searchParams.get('dates')!)
      .sort();
    // 3 days back + today + 1 day forward, one request per day
    expect(nflDates).toHaveLength(5);
    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    // first < today verifies daysBack > 0 was actually applied
    expect(nflDates[0] < todayStr).toBe(true);
    expect(nflDates[nflDates.length - 1] > todayStr).toBe(true);
  });

  describe('reaching back for games still awaiting a result', () => {
    const DAY_MS = 86_400_000;

    async function nflRequestCount(awaitingResultSince?: Date): Promise<number> {
      const fetchMock = vi.fn().mockImplementation(() => scoreboardWith([NFL_EVENT]));
      vi.stubGlobal('fetch', fetchMock);

      await new EspnScoreProvider().getResults(['1'], { awaitingResultSince });

      return fetchMock.mock.calls.filter((call) => (call[0] as string).includes('/nfl/')).length;
    }

    it('keeps the default 3-day look-back when nothing is outstanding', async () => {
      // 3 back + today + 1 forward
      expect(await nflRequestCount(undefined)).toBe(5);
    });

    it('keeps the default when the oldest outstanding game is recent', async () => {
      expect(await nflRequestCount(new Date(Date.now() - DAY_MS))).toBe(5);
    });

    it('reaches back to the oldest outstanding game, plus a day for the Eastern date', async () => {
      // 10 days ago → 11 back (the extra day covers a late game filed under the prior ET
      // date) + today + 1 forward
      expect(await nflRequestCount(new Date(Date.now() - 10 * DAY_MS))).toBe(13);
    });

    it('caps the look-back at 30 days', async () => {
      // 30 back + today + 1 forward
      expect(await nflRequestCount(new Date(Date.now() - 100 * DAY_MS))).toBe(32);
    });
  });
});
