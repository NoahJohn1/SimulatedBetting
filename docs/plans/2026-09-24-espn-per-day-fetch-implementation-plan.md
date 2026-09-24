# ESPN Per-Day Fetch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `sync-odds` work again by fetching ESPN's scoreboard one day per request, because ESPN now rejects every `?dates=` range with a 400. The two-week odds window and the results window stay the same.

**Architecture:** `fetchScoreboard` keeps its signature and return shape. Internally it lists the days in the window, fetches each with `?dates=YYYYMMDD` at no more than 4 requests at once, and merges the results without duplicates. `EspnOddsProvider` keeps each sport's result from `getUpcomingGames` so that `getMarkets` doesn't fetch the window a second time. `EspnScoreProvider` needs no change.

**Tech Stack:** TypeScript, Next.js route handlers, Vitest (the `node` project, with `fetch` stubbed via `vi.stubGlobal`).

**Spec:** [2026-09-24-espn-per-day-fetch-design.md](../specs/2026-09-24-espn-per-day-fetch-design.md)

## Global Constraints

Copied from the spec:

- **Windows do not change.** Odds: `daysBack: 0, daysForward: 14` (`DEFAULT_WITHIN_DAYS = 14`). Results: `SCORE_LOOKBACK_DAYS = 3`, `SCORE_LOOKAHEAD_DAYS = 1`.
- **Days are UTC calendar days**, from `today − daysBack` to `today + daysForward`, both ends included. That is `daysBack + daysForward + 1` requests per sport.
- **At most 4 requests in flight** at once, through a small local helper. No new dependency.
- **Duplicates are dropped by `game.externalId`,** and the first occurrence in day order wins.
- **`skippedGames` and `skippedMarkets` are summed across days.**
- **No partial success.** Any failed day makes `fetchScoreboard` reject. The message names the sport, the day, and the HTTP status.
- **`groups=80&limit=200` goes on `NCAAF` requests only.**
- **Stored results last one run.** `getMarkets` falls back to fetching when a sport wasn't fetched earlier in the run.
- **Callers do not change.** `sync.ts`, `results.ts`, and the `sync-odds` route are untouched.

## File map

| File                                                      | Change                                                                              |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/server/odds/espn/fetch-scoreboard.ts`                | Per-day URL, day list, concurrency helper, one fetch per day, merge. Task 1         |
| `src/server/odds/espn/__tests__/fetch-scoreboard.test.ts` | Rewritten for per-day behaviour. Task 1                                             |
| `src/server/odds/espn/provider.ts`                        | `EspnOddsProvider` stores each sport's result for `getMarkets`. Task 2              |
| `src/server/odds/espn/__tests__/provider.test.ts`         | Request counts and the results-window test updated in Task 1. Reuse tests in Task 2 |
| `docs/decisions.md`                                       | D80. Task 3                                                                         |
| `docs/specs/2026-08-22-espn-adapter-design.md`            | Dated note on the range finding. Task 3                                             |
| `docs/specs/2026-09-24-espn-per-day-fetch-design.md`      | Status set to built. Task 3                                                         |
| `docs/README.md`                                          | Lists the new spec and plan. Task 3                                                 |

---

### Task 1: Fetch one day per request

**Files:**

- Modify: `src/server/odds/espn/fetch-scoreboard.ts` (whole file below)
- Test: `src/server/odds/espn/__tests__/fetch-scoreboard.test.ts` (whole file below)
- Test: `src/server/odds/espn/__tests__/provider.test.ts` (three expectations and one test that encode the old single range)

**Interfaces:**

- Consumes: `mapGame`, `mapMarkets`, `mapResult` from `./mappers` (unchanged).
- Produces: `fetchScoreboard(sport: Sport, opts: { daysBack: number; daysForward: number }): Promise<FetchScoreboardResult>`, the same signature and types as today (`ParsedGame`, `FetchScoreboardResult` exported unchanged). It now makes `daysBack + daysForward + 1` requests.

- [ ] **Step 1: Replace the fetch-scoreboard tests**

Overwrite `src/server/odds/espn/__tests__/fetch-scoreboard.test.ts` with:

```ts
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
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/server/odds/espn/__tests__/fetch-scoreboard.test.ts`
Expected: FAIL. The per-day tests fail because the current code makes one request with a `YYYYMMDD-YYYYMMDD` range: expected 15 calls, received 1. The 503 test fails because the message doesn't contain the day. `maps a well-formed event`, `skips a malformed event`, and `keeps a game ... only once` may already pass.

- [ ] **Step 3: Rewrite `fetch-scoreboard.ts`**

Overwrite `src/server/odds/espn/fetch-scoreboard.ts` with:

```ts
import type { Sport } from '@/db/schema';
import type { ProviderGame, ProviderMarket, ProviderResult } from '../types';
import { mapGame, mapMarkets, mapResult } from './mappers';
import type { EspnScoreboardResponse } from './espn-types';

const SPORT_PATH: Record<Sport, string> = {
  NFL: 'nfl',
  NCAAF: 'college-football',
};

const MS_PER_DAY = 86_400_000;
/** Enough to keep a 15-day window quick without hammering an unofficial endpoint. */
const MAX_IN_FLIGHT = 4;

function formatEspnDate(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * One day only. ESPN's scoreboard used to accept `dates=YYYYMMDD-YYYYMMDD`, but since
 * September 2026 it answers any range — even two days — with a 400 (D80).
 */
function buildUrl(sport: Sport, day: string): string {
  const params = new URLSearchParams({ dates: day });
  if (sport === 'NCAAF') {
    params.set('groups', '80');
    params.set('limit', '200');
  }

  return `https://site.api.espn.com/apis/site/v2/sports/football/${SPORT_PATH[sport]}/scoreboard?${params}`;
}

/** Every UTC calendar day in the window, oldest first, both ends included. */
function windowDays(opts: { daysBack: number; daysForward: number }): string[] {
  const now = Date.now();
  const days: string[] = [];
  for (let offset = -opts.daysBack; offset <= opts.daysForward; offset++) {
    days.push(formatEspnDate(new Date(now + offset * MS_PER_DAY)));
  }
  return days;
}

/**
 * `Promise.all` over `items` with at most `limit` calls running at once, results in input
 * order. The first failure rejects the whole call and stops workers from starting new items.
 */
async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;

  async function worker() {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index]);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export interface ParsedGame {
  game: ProviderGame;
  markets: ProviderMarket[];
  result: ProviderResult;
}

export interface FetchScoreboardResult {
  items: ParsedGame[];
  skippedGames: number;
  skippedMarkets: number;
}

/**
 * One scoreboard request for one day. A single malformed event is skipped and counted, not
 * thrown — the rest of the day still comes back. A request-level failure (unreachable,
 * non-200) is NOT caught here; it propagates so the caller's tick fails openly and the next
 * cron run retries (see the plan's Global Constraints for why this is scoped to the whole
 * tick, not per-sport).
 */
async function fetchScoreboardDay(sport: Sport, day: string): Promise<FetchScoreboardResult> {
  const response = await fetch(buildUrl(sport, day));
  if (!response.ok) {
    throw new Error(
      `ESPN ${sport} scoreboard request for ${day} failed: ${response.status} ${response.statusText}`,
    );
  }

  const body = (await response.json()) as EspnScoreboardResponse;

  const items: ParsedGame[] = [];
  let skippedGames = 0;
  let skippedMarkets = 0;

  for (const event of body.events ?? []) {
    let game: ProviderGame;
    let result: ProviderResult;
    try {
      game = mapGame(event, sport);
      result = mapResult(event);
    } catch {
      skippedGames += 1;
      continue;
    }

    // Market parsing is isolated from game/result parsing: a game whose odds block is
    // malformed in a way mapMarkets's own per-market try/catch doesn't cover must still
    // sync its schedule and score — losing a game's result because its odds were bad
    // would silently block that game from ever settling.
    let markets: ProviderMarket[] = [];
    try {
      const mapped = mapMarkets(event);
      markets = mapped.markets;
      skippedMarkets += mapped.skipped;
    } catch {
      skippedMarkets += 1;
    }

    items.push({ game, markets, result });
  }

  return { items, skippedGames, skippedMarkets };
}

/**
 * Every game in the window, fetched one day per request (ESPN rejects ranges — D80) and
 * merged. A game that appears on more than one day is kept once, first day wins. Any
 * failed day rejects the whole call: a slate with a silent hole in it is worse than a tick
 * that fails and retries.
 */
export async function fetchScoreboard(
  sport: Sport,
  opts: { daysBack: number; daysForward: number },
): Promise<FetchScoreboardResult> {
  const perDay = await mapWithLimit(windowDays(opts), MAX_IN_FLIGHT, (day) =>
    fetchScoreboardDay(sport, day),
  );

  const seen = new Set<string>();
  const items: ParsedGame[] = [];
  let skippedGames = 0;
  let skippedMarkets = 0;

  for (const day of perDay) {
    skippedGames += day.skippedGames;
    skippedMarkets += day.skippedMarkets;
    for (const item of day.items) {
      if (seen.has(item.game.externalId)) continue;
      seen.add(item.game.externalId);
      items.push(item);
    }
  }

  return { items, skippedGames, skippedMarkets };
}
```

- [ ] **Step 4: Run the fetch-scoreboard tests and confirm they pass**

Run: `npx vitest run src/server/odds/espn/__tests__/fetch-scoreboard.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Update the provider tests that encode the old single range**

Run `npx vitest run src/server/odds/espn/__tests__/provider.test.ts` first. It should fail in exactly these four places, because every window is now one request per day. Make these edits in `src/server/odds/espn/__tests__/provider.test.ts`:

(a) In `getUpcomingGames returns games for the requested sport only`, replace

```ts
expect(fetchMock).toHaveBeenCalledTimes(1);
expect(fetchMock.mock.calls[0][0] as string).toContain('/nfl/scoreboard');
```

with

```ts
// today + 14 days, one request per day
expect(fetchMock).toHaveBeenCalledTimes(15);
for (const call of fetchMock.mock.calls) {
  expect(call[0] as string).toContain('/nfl/scoreboard');
}
```

(b) In `getMarkets fans out to both sports ...`, replace

```ts
// 2 calls for getUpcomingGames (NFL, NCAAF) + 2 for getMarkets' fan-out (NFL, NCAAF)
expect(fetchMock).toHaveBeenCalledTimes(4);
```

with

```ts
// 15 days × 2 sports for getUpcomingGames + the same again for getMarkets' fan-out
expect(fetchMock).toHaveBeenCalledTimes(60);
```

(c) In `getSkipped accumulates across both getUpcomingGames and getMarkets calls`, the broken event now comes back on each of the 15 days for each sport. Replace

```ts
expect(skipped).toEqual({ games: 2, markets: 0 });
```

with

```ts
// the mock returns the broken event on each of 15 days, for each of 2 sports
expect(skipped).toEqual({ games: 30, markets: 0 });
```

(d) Replace the whole `requests a backward-looking window, not a forward-only one` test with:

```ts
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
```

- [ ] **Step 6: Run all ESPN and odds tests**

Run: `npx vitest run src/server/odds`
Expected: PASS. If `sync.test.ts` or `sync-odds-route.test.ts` need a database and Postgres is down, start it with `npm run db:up` and rerun. Those files don't touch `fetchScoreboard`, so they shouldn't change.

- [ ] **Step 7: Commit**

```bash
git add src/server/odds/espn/fetch-scoreboard.ts src/server/odds/espn/__tests__/fetch-scoreboard.test.ts src/server/odds/espn/__tests__/provider.test.ts
git commit -m "fix: fetch ESPN scoreboard one day per request

ESPN now answers any ?dates= range with a 400, which failed every
sync-odds run. fetchScoreboard keeps its signature and fetches each day
in the window, at most 4 at once, merging and de-duplicating by game."
```

---

### Task 2: Fetch the odds window once per run

**Files:**

- Modify: `src/server/odds/espn/provider.ts` (`EspnOddsProvider` only)
- Test: `src/server/odds/espn/__tests__/provider.test.ts`

**Interfaces:**

- Consumes: `fetchScoreboard` and `FetchScoreboardResult` from `./fetch-scoreboard` (Task 1).
- Produces: no new public API. `EspnOddsProvider.getMarkets` makes no requests for a sport that `getUpcomingGames` already fetched on the same instance.

- [ ] **Step 1: Update the fan-out test and add a fallback test**

In `src/server/odds/espn/__tests__/provider.test.ts`, inside `getMarkets fans out to both sports and filters by the wanted external IDs`, replace

```ts
// 15 days × 2 sports for getUpcomingGames + the same again for getMarkets' fan-out
expect(fetchMock).toHaveBeenCalledTimes(60);
```

with

```ts
// 15 days × 2 sports, all from getUpcomingGames — getMarkets reuses them
expect(fetchMock).toHaveBeenCalledTimes(30);
```

Then add this test directly after it, inside `describe('EspnOddsProvider', ...)`:

```ts
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
```

- [ ] **Step 2: Run the provider tests and confirm they fail**

Run: `npx vitest run src/server/odds/espn/__tests__/provider.test.ts`
Expected: FAIL. The fan-out test gets 60 calls instead of 30, and the fallback test gets 30 calls instead of 15.

- [ ] **Step 3: Store each sport's window in `EspnOddsProvider`**

In `src/server/odds/espn/provider.ts`, change the import

```ts
import { fetchScoreboard } from './fetch-scoreboard';
```

to

```ts
import { fetchScoreboard, type FetchScoreboardResult } from './fetch-scoreboard';
```

and replace the class body from the field declarations through the end of `getMarkets` with:

```ts
export class EspnOddsProvider implements OddsProvider {
  private lastWithinDays = DEFAULT_WITHIN_DAYS;
  private skippedGames = 0;
  private skippedMarkets = 0;
  /**
   * Each sport's window from getUpcomingGames, so getMarkets doesn't fetch the same 15 days
   * again. The sync-odds route builds a new provider per run, so this never outlives a run.
   */
  private windows = new Map<Sport, FetchScoreboardResult>();

  async getUpcomingGames(sport: Sport, withinDays: number): Promise<ProviderGame[]> {
    this.lastWithinDays = withinDays;

    const window = await fetchScoreboard(sport, {
      daysBack: 0,
      daysForward: withinDays,
    });
    this.windows.set(sport, window);
    this.skippedGames += window.skippedGames;

    return window.items.map((item) => item.game);
  }

  async getMarkets(gameExternalIds: string[]): Promise<ProviderMarket[]> {
    const wanted = new Set(gameExternalIds);
    const markets: ProviderMarket[] = [];

    for (const sport of ALL_SPORTS) {
      const window =
        this.windows.get(sport) ??
        (await fetchScoreboard(sport, { daysBack: 0, daysForward: this.lastWithinDays }));
      // Only skippedMarkets is accumulated here, deliberately mirroring getUpcomingGames's
      // opposite omission (it only accumulates skippedGames): this is the same window
      // getUpcomingGames already fetched, so re-counting skippedGames here would
      // double-count the same malformed events.
      this.skippedMarkets += window.skippedMarkets;

      for (const item of window.items) {
        if (wanted.has(item.game.externalId)) markets.push(...item.markets);
      }
    }

    return markets;
  }
```

Leave `getSkipped()`, `EspnScoreProvider`, and the constants unchanged.

- [ ] **Step 4: Run the provider tests and confirm they pass**

Run: `npx vitest run src/server/odds/espn`
Expected: PASS. `getSkipped` still expects `{ games: 30, markets: 0 }`, because skipped markets are counted once from the stored window.

- [ ] **Step 5: Run the full checks**

Run: `npm run verify`
Expected: typecheck, lint, and all tests pass. The node test project needs Postgres (`npm run db:up`) for the database-backed suites.

Run: `npm run format:check`
Expected: no files reported. If any are, run `npx prettier --write` on them.

- [ ] **Step 6: Commit**

```bash
git add src/server/odds/espn/provider.ts src/server/odds/espn/__tests__/provider.test.ts
git commit -m "perf: reuse the odds window in EspnOddsProvider.getMarkets

With one request per day, re-fetching the window for markets would
double each run to ~60 requests. getMarkets now reads the window
getUpcomingGames already fetched, and fetches only as a fallback."
```

---

### Task 3: Record the decision and update the docs

**Files:**

- Modify: `docs/decisions.md` (append D80)
- Modify: `docs/specs/2026-08-22-espn-adapter-design.md` (the `?dates=` range bullet under "What the spike found")
- Modify: `docs/specs/2026-09-24-espn-per-day-fetch-design.md` (the `**Status:**` line)
- Modify: `docs/README.md` (two table rows)

**Interfaces:**

- Consumes: the D80 anchor that the spec already links to: `../decisions.md#d80--the-espn-adapter-fetches-one-day-per-request-because-date-ranges-stopped-working`. The heading text below must produce exactly that slug.
- Produces: nothing code depends on.

- [ ] **Step 1: Append D80 to `docs/decisions.md`**

Use the `decision-log` skill to confirm D80 is the next free number. Today the last entry is D79. Then append at the end of the file:

```markdown
---

### D80 — The ESPN adapter fetches one day per request, because date ranges stopped working

_Added 2026-09-24 while fixing a failing sync-odds run._

ESPN's scoreboard endpoint now answers any `?dates=YYYYMMDD-YYYYMMDD` range with a 400, even a
two-day one. The [ESPN adapter spec](specs/2026-08-22-espn-adapter-design.md) had confirmed
that a single range request covered a multi-week window, and `fetchScoreboard` relied on it for
both the odds and results syncs, so every `sync-odds` run failed before writing anything.
`fetchScoreboard` now requests each UTC day in the window with `?dates=YYYYMMDD`, at most four
at once, and merges the days without duplicates. The windows are unchanged: 15 days for odds,
5 for results. `EspnOddsProvider` reuses its odds window for markets instead of fetching it
twice, so a run costs about 40 requests.

_Rejected:_ one request per month (`?dates=YYYYMM`), trimmed in code. It loads a month to use
two weeks, and a busy CFB month is over the `limit=200` cap, so games would drop silently.

_Rejected:_ one request per ESPN week (`?week=N&seasontype=N`). It needs the current week and
season type from ESPN's calendar first, which is fragile around preseason, bowls, and the
playoffs, and leans harder on the same undocumented API that just changed.

_What this accepts:_ roughly seven times as many requests per run as before, against an
endpoint with no SLA. They are small single-day requests, and any failure still fails the whole
run loudly, as [D49](#d49--espns-public-json-is-the-odds-and-score-source-superseding-d2)
intended.
```

- [ ] **Step 2: Mark the old finding in the adapter spec**

In `docs/specs/2026-08-22-espn-adapter-design.md`, replace

```markdown
- `?dates=YYYYMMDD-YYYYMMDD` spans multiple weeks in a single call (confirmed: a 2-week range
  returned weeks 3 and 4 together), so `getUpcomingGames(sport, withinDays)` is one request per
  sport, not a per-week loop.
```

with

```markdown
- `?dates=YYYYMMDD-YYYYMMDD` spans multiple weeks in a single call (confirmed: a 2-week range
  returned weeks 3 and 4 together), so `getUpcomingGames(sport, withinDays)` is one request per
  sport, not a per-week loop. _No longer true as of 2026-09-24:_ ESPN now rejects every range
  with a 400, and the adapter makes one request per day — see
  [D80](../decisions.md#d80--the-espn-adapter-fetches-one-day-per-request-because-date-ranges-stopped-working)
  and the [per-day fetch spec](2026-09-24-espn-per-day-fetch-design.md).
```

- [ ] **Step 3: Mark the new spec as built**

In `docs/specs/2026-09-24-espn-per-day-fetch-design.md`, replace

```markdown
**Status:** Designed, not yet built.
```

with

```markdown
**Status:** Built — see the [implementation plan](../plans/2026-09-24-espn-per-day-fetch-implementation-plan.md).
```

- [ ] **Step 4: List the spec and plan in `docs/README.md`**

In the table that holds the `[ESPN adapter spec](specs/2026-08-22-espn-adapter-design.md)` row, add these two rows directly below it:

```markdown
| [ESPN per-day fetch spec](specs/2026-09-24-espn-per-day-fetch-design.md) | Why the adapter now fetches one day per request after ESPN stopped accepting date ranges (D80) |
| [ESPN per-day fetch plan](plans/2026-09-24-espn-per-day-fetch-implementation-plan.md) | The task-by-task plan for that fix |
```

- [ ] **Step 5: Format and check the links**

Run: `npx prettier --write docs/decisions.md docs/README.md docs/specs/2026-08-22-espn-adapter-design.md docs/specs/2026-09-24-espn-per-day-fetch-design.md docs/plans/2026-09-24-espn-per-day-fetch-implementation-plan.md`

Then check that every link added in this task resolves:

```bash
grep -c "^### D80 — The ESPN adapter fetches one day per request, because date ranges stopped working$" docs/decisions.md
ls docs/specs/2026-09-24-espn-per-day-fetch-design.md docs/plans/2026-09-24-espn-per-day-fetch-implementation-plan.md
```

Expected: `1`, then both paths listed.

- [ ] **Step 6: Commit**

```bash
git add docs/decisions.md docs/README.md docs/specs/2026-08-22-espn-adapter-design.md docs/specs/2026-09-24-espn-per-day-fetch-design.md docs/plans/2026-09-24-espn-per-day-fetch-implementation-plan.md
git commit -m "docs: D80, ESPN per-day fetch"
```

---

### Task 4: Verify against live ESPN

No code changes. This is the spec's live check, and it needs network access and the local stack.

- [ ] **Step 1: Make sure Postgres and the dev server are up**

Run: `docker ps --filter name=simbet-db --format '{{.Status}}'`
Expected: `Up ... (healthy)`. If not, run `npm run db:up`.

Start the dev server with the preview tool (`preview_start` with name `simbet-dev`, from `.claude/launch.json`), or reuse one that is already running on port 3000. `.env.local` must have `ODDS_PROVIDER=espn`.

- [ ] **Step 2: Run the sync**

```bash
curl -s -m 120 -w '\nHTTP %{http_code}\n' -H "Authorization: Bearer $(grep '^CRON_SECRET=' .env.local | cut -d= -f2-)" http://localhost:3000/api/cron/sync-odds
```

Expected: `HTTP 200`, and a JSON body whose `odds.gamesUpserted` is greater than 0.

- [ ] **Step 3: Check the run record and the games**

```bash
docker exec simbet-db psql -U simbet -d simbet -c "select started_at, ok, error from job_runs where job='SYNC_ODDS' order by started_at desc limit 1;"
docker exec simbet-db psql -U simbet -d simbet -c "select count(*), min(starts_at), max(starts_at) from games where status='SCHEDULED' and starts_at > now();"
```

Expected: the newest run has `ok = t` and no error. The count is above 0, and `max(starts_at)` is at most about 15 days out.

- [ ] **Step 4: Check the board**

Open `http://localhost:3000/games` while signed in. Expected: upcoming games grouped by day, with odds. If you're not signed in, the page redirects to `/sign-in`, so the database checks in Step 3 are the proof.
