import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchScoreboard } from '../fetch-scoreboard';

function loadFixtureText(name: string): string {
  return readFileSync(path.join(__dirname, 'fixtures', name), 'utf-8');
}

function jsonResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
}

function requestedUrls(fetchMock: ReturnType<typeof vi.fn>): URL[] {
  return fetchMock.mock.calls.map((call) => new URL(call[0] as string));
}

function requestedDates(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return requestedUrls(fetchMock).map((url) => url.searchParams.get('dates')!);
}

// A Response body can only be read once, so every call needs a fresh one — hence
// mockImplementation rather than mockResolvedValue throughout.
function fetchReturning(fixture: string): ReturnType<typeof vi.fn> {
  const text = loadFixtureText(fixture);
  return vi.fn().mockImplementation(async () => jsonResponse(text));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-24T13:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('fetchScoreboard', () => {
  it('requests the NFL scoreboard once per day across the forward window', async () => {
    const fetchMock = fetchReturning('event-with-odds.json');
    vi.stubGlobal('fetch', fetchMock);

    await fetchScoreboard('NFL', { daysBack: 0, daysForward: 14 });

    expect(fetchMock).toHaveBeenCalledTimes(15);
    for (const url of requestedUrls(fetchMock)) {
      expect(url.origin + url.pathname).toBe(
        'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
      );
      expect(url.searchParams.get('dates')).toMatch(/^\d{8}$/);
      expect(url.searchParams.has('groups')).toBe(false);
    }
    const dates = [...requestedDates(fetchMock)].sort();
    expect(dates[0]).toBe('20260924');
    expect(dates[dates.length - 1]).toBe('20261008');
  });

  it('covers every day from daysBack to daysForward, both ends included', async () => {
    const fetchMock = fetchReturning('event-with-odds.json');
    vi.stubGlobal('fetch', fetchMock);

    await fetchScoreboard('NFL', { daysBack: 3, daysForward: 1 });

    expect([...requestedDates(fetchMock)].sort()).toEqual([
      '20260921',
      '20260922',
      '20260923',
      '20260924',
      '20260925',
    ]);
  });

  it('adds groups=80&limit=200 to every NCAAF request', async () => {
    const fetchMock = fetchReturning('event-with-odds.json');
    vi.stubGlobal('fetch', fetchMock);

    await fetchScoreboard('NCAAF', { daysBack: 0, daysForward: 2 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const url of requestedUrls(fetchMock)) {
      expect(url.pathname).toContain('/college-football/scoreboard');
      expect(url.searchParams.get('groups')).toBe('80');
      expect(url.searchParams.get('limit')).toBe('200');
    }
  });

  it('maps a well-formed event into one parsed game with markets', async () => {
    vi.stubGlobal('fetch', fetchReturning('event-with-odds.json'));

    const result = await fetchScoreboard('NFL', { daysBack: 0, daysForward: 0 });

    expect(result.skippedGames).toBe(0);
    expect(result.skippedMarkets).toBe(0);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].game.externalId).toBe('401873601');
    expect(result.items[0].markets).toHaveLength(3);
  });

  it('keeps a game returned on several days only once', async () => {
    vi.stubGlobal('fetch', fetchReturning('event-with-odds.json'));

    const result = await fetchScoreboard('NFL', { daysBack: 0, daysForward: 2 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].game.externalId).toBe('401873601');
  });

  it('skips a malformed event and keeps parsing the rest', async () => {
    const good = JSON.parse(loadFixtureText('event-with-odds.json'));
    const broken = JSON.parse(loadFixtureText('event-final.json'));
    broken.events[0].competitions[0].competitors = [];
    const combined = JSON.stringify({ events: [...good.events, ...broken.events] });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => jsonResponse(combined)),
    );

    const result = await fetchScoreboard('NFL', { daysBack: 0, daysForward: 0 });

    expect(result.skippedGames).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].game.externalId).toBe('401873601');
  });

  it('sums skipped counts across days', async () => {
    const broken = JSON.parse(loadFixtureText('event-final.json'));
    broken.events[0].competitions[0].competitors = [];
    const text = JSON.stringify(broken);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => jsonResponse(text)),
    );

    const result = await fetchScoreboard('NFL', { daysBack: 0, daysForward: 2 });

    expect(result.skippedGames).toBe(3);
    expect(result.items).toHaveLength(0);
  });

  it('rejects when any one day fails, naming that day and the status', async () => {
    const text = loadFixtureText('event-with-odds.json');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(async (url: string) =>
          url.includes('dates=20260925') ? new Response('', { status: 503 }) : jsonResponse(text),
        ),
    );

    await expect(fetchScoreboard('NFL', { daysBack: 0, daysForward: 3 })).rejects.toThrow(
      /20260925.*503/,
    );
  });

  it('never has more than 4 requests in flight', async () => {
    const text = loadFixtureText('event-with-odds.json');
    let inFlight = 0;
    let maxInFlight = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 0));
        inFlight -= 1;
        return jsonResponse(text);
      }),
    );

    await fetchScoreboard('NFL', { daysBack: 0, daysForward: 14 });

    expect(maxInFlight).toBe(4);
  });

  it('gives every request a timeout signal', async () => {
    const fetchMock = fetchReturning('event-with-odds.json');
    vi.stubGlobal('fetch', fetchMock);

    await fetchScoreboard('NFL', { daysBack: 0, daysForward: 1 });

    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit | undefined)?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('rejects naming the day when a request never completes', async () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout));

    await expect(fetchScoreboard('NFL', { daysBack: 0, daysForward: 0 })).rejects.toThrow(
      /NFL scoreboard request for 20260924 failed: .*timeout/,
    );
  });
});
