import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchScoreboard } from '../fetch-scoreboard';

function loadFixtureText(name: string): string {
  return readFileSync(path.join(__dirname, 'fixtures', name), 'utf-8');
}

function jsonResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchScoreboard', () => {
  it('requests the NFL scoreboard URL with a forward-only dates range', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(loadFixtureText('event-with-odds.json')));
    vi.stubGlobal('fetch', fetchMock);

    await fetchScoreboard('NFL', { daysBack: 0, daysForward: 14 });

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe(
      'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
    );
    expect(url.searchParams.get('dates')).toMatch(/^\d{8}-\d{8}$/);
    expect(url.searchParams.has('groups')).toBe(false);
  });

  it('adds groups=80&limit=200 for NCAAF only', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(loadFixtureText('event-with-odds.json')));
    vi.stubGlobal('fetch', fetchMock);

    await fetchScoreboard('NCAAF', { daysBack: 0, daysForward: 14 });

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toContain('/college-football/scoreboard');
    expect(url.searchParams.get('groups')).toBe('80');
    expect(url.searchParams.get('limit')).toBe('200');
  });

  it('maps a well-formed event into one parsed game with markets', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(loadFixtureText('event-with-odds.json'))),
    );

    const result = await fetchScoreboard('NFL', { daysBack: 0, daysForward: 14 });

    expect(result.skippedGames).toBe(0);
    expect(result.skippedMarkets).toBe(0);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].game.externalId).toBe('401873601');
    expect(result.items[0].markets).toHaveLength(3);
  });

  it('skips a malformed event and keeps parsing the rest', async () => {
    const good = JSON.parse(loadFixtureText('event-with-odds.json'));
    const broken = JSON.parse(loadFixtureText('event-final.json'));
    broken.events[0].competitions[0].competitors = [];
    const combined = { events: [...good.events, ...broken.events] };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(JSON.stringify(combined))));

    const result = await fetchScoreboard('NFL', { daysBack: 0, daysForward: 14 });

    expect(result.skippedGames).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].game.externalId).toBe('401873601');
  });

  it('throws on a non-200 response rather than returning an empty result silently', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));

    await expect(fetchScoreboard('NFL', { daysBack: 0, daysForward: 14 })).rejects.toThrow(/503/);
  });
});
