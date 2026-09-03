# ESPN Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixture odds/score providers with real ESPN-backed ones
(`EspnOddsProvider`, `EspnScoreProvider`), behind an `ODDS_PROVIDER` kill switch, with
defensive per-item parsing so one malformed game or market never kills a sync run.

**Architecture:** A shared `fetchScoreboard(sport, {daysBack, daysForward})` hits ESPN's
public scoreboard JSON and maps each event through pure functions in `mappers.ts`, skipping
(and counting) anything malformed rather than throwing. `EspnOddsProvider` and
`EspnScoreProvider` each call it independently — no shared cache between them, matching the
existing `FixtureOddsProvider`/`FixtureScoreProvider` pattern. `sync.ts` gains two summary
counters (`gamesSkipped`, `marketsSkipped`) fed by a new optional `getSkipped?()` method on
`OddsProvider`, which `FixtureOddsProvider` doesn't implement (so nothing about the fixture
path changes). The cron route picks fixture vs. ESPN off one env var.

**Tech Stack:** TypeScript, Vitest, global `fetch` (this project requires Node >=22 per
`package.json`'s `engines` field, well past Node 18 where `fetch`/`Response`/`URL` became
stable globals — no HTTP client dependency needed),
Drizzle ORM (untouched by this plan — no schema changes).

**Spec:** [docs/specs/2026-08-22-espn-adapter-design.md](../specs/2026-08-22-espn-adapter-design.md)

## Global Constraints

- No new npm dependencies. Mocking `fetch` in tests uses Vitest's built-in `vi.stubGlobal`,
  not a new library like `msw`/`nock` — this codebase has no existing fetch-mocking
  convention, and none is needed for a single external call site.
- Match existing code style exactly: single quotes, semicolons, 2-space indent, trailing
  commas, named exports (no default exports), relative imports within a feature folder
  (`./` / `../`), `@/` alias only when crossing into `src/db`, `src/domain`, etc.
- Every new file lives under `src/server/odds/espn/` except the two edits to existing files
  (`src/server/odds/types.ts`, `src/server/odds/sync.ts`) and the cron route
  (`src/app/api/cron/sync-odds/route.ts`) plus `.env.example`.
- No live network calls in any test. All ESPN responses in tests come from committed fixture
  JSON or inline objects shaped like it.
- `ODDS_PROVIDER` unset (or any value other than `"espn"`) must produce byte-for-byte the same
  behavior as today — this is checked by not modifying any existing fixture-path test.

**Two corrections against the design spec, found while writing this plan — noted so nobody
re-derives them mid-implementation:**

1. **The spec undercounted ESPN requests per cron tick.** It said "4 requests" (NFL+NCAAF ×
   odds-role + results-role). Actually `EspnOddsProvider.getMarkets` and
   `EspnScoreProvider.getResults` don't receive a `sport` parameter (see Task 4) — they fan out
   to _both_ sports internally to resolve a flat list of external IDs. That's `2` (
   `getUpcomingGames` × 2 sports) `+ 2` (`getMarkets` fan-out) `+ 2` (`getResults` fan-out) `= 6`
   requests per tick, not 4. Same accepted tradeoff (independent, uncached fetching) the spec
   already approved — just a corrected count.
2. **Score syncing needs a backward-looking window, not the forward-looking one odds sync
   uses.** `getUpcomingGames`/`getMarkets` want games from now through `withinDays` out — pure
   lookahead. But `getResults` needs the status of games that may have _already started or
   finished_ (e.g. it's Monday and Sunday's late game just went final) — a forward-only
   `dates=` range would silently never see them again. `fetchScoreboard` therefore takes
   `{daysBack, daysForward}`, not a single `withinDays`: odds calls pass `daysBack: 0`, score
   calls pass a small fixed lookback (`daysBack: 3, daysForward: 1` — enough to span a
   weekend's games without re-scanning a whole season on every tick).

---

### Task 1: `parseLine` — strip ESPN's line-string prefixes

ESPN's spread/total lines aren't in the format `normalizeLine` (in
[`src/domain/line.ts`](../../src/domain/line.ts)) accepts: away spreads carry a literal `+`
(`"+1.5"`), and totals carry an `o`/`u` marker (`"o36.5"`, `"u36.5"`). Both fail
`normalizeLine`'s pattern (`^-?\d+(\.\d{1,2})?$`) unmodified. This was verified directly
against a live ESPN response during the design spike (see the spec's Purpose section).

**Files:**

- Create: `src/server/odds/espn/parse-line.ts`
- Test: `src/server/odds/espn/__tests__/parse-line.test.ts`

**Interfaces:**

- Produces: `parseLine(raw: string): string` — used by Task 2's `mapMarkets`.

- [ ] **Step 1: Write the failing test**

```ts
// src/server/odds/espn/__tests__/parse-line.test.ts
import { describe, expect, it } from 'vitest';
import { parseLine } from '../parse-line';

describe('parseLine', () => {
  it('strips the leading + on a positive spread', () => {
    expect(parseLine('+1.5')).toBe('1.5');
  });

  it('leaves a negative spread untouched', () => {
    expect(parseLine('-1.5')).toBe('-1.5');
  });

  it('strips the o prefix on an over total', () => {
    expect(parseLine('o36.5')).toBe('36.5');
  });

  it('strips the u prefix on an under total', () => {
    expect(parseLine('u36.5')).toBe('36.5');
  });

  it('leaves a whole-number line untouched', () => {
    expect(parseLine('-3')).toBe('-3');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/odds/espn/__tests__/parse-line.test.ts`
Expected: FAIL — `Cannot find module '../parse-line'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/odds/espn/parse-line.ts

/**
 * ESPN's line strings carry markers `normalizeLine` doesn't accept: a leading `+` on
 * positive spreads, and a leading `o`/`u` on totals. Both are stripped here so the result
 * always matches `normalizeLine`'s pattern before it reaches `syncOdds`.
 */
export function parseLine(raw: string): string {
  return raw.replace(/^[ou]/, '').replace(/^\+/, '');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/odds/espn/__tests__/parse-line.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/server/odds/espn/parse-line.ts src/server/odds/espn/__tests__/parse-line.test.ts
git commit -m "feat: add parseLine for ESPN's spread/total line format"
```

---

### Task 2: ESPN types, recorded fixtures, and the mappers

The mappers are pure functions: ESPN JSON in, `Provider*` shapes out. They're tested directly
against three real payloads captured during the design spike (2026-08-22), trimmed of fields
nothing reads (tracking/link/logos objects) but otherwise verbatim — same values, same
nesting, same field names.

**Files:**

- Create: `src/server/odds/espn/espn-types.ts`
- Create: `src/server/odds/espn/mappers.ts`
- Create: `src/server/odds/espn/__tests__/fixtures/event-with-odds.json`
- Create: `src/server/odds/espn/__tests__/fixtures/event-without-odds.json`
- Create: `src/server/odds/espn/__tests__/fixtures/event-final.json`
- Test: `src/server/odds/espn/__tests__/mappers.test.ts`

**Interfaces:**

- Consumes: `parseLine(raw: string): string` (Task 1). `ProviderGame`, `ProviderTeam`,
  `ProviderMarket`, `ProviderSelection`, `ProviderResult` from
  [`../types.ts`](../../src/server/odds/types.ts). `Sport`, `GameStatus` from `@/db/schema`.
- Produces (used by Task 3):
  - `mapGame(event: EspnEvent, sport: Sport): ProviderGame`
  - `mapResult(event: EspnEvent): ProviderResult`
  - `mapMarkets(event: EspnEvent): { markets: ProviderMarket[]; skipped: number }`
  - Types `EspnEvent`, `EspnScoreboardResponse` from `espn-types.ts`

- [ ] **Step 1: Create the three fixture files**

`src/server/odds/espn/__tests__/fixtures/event-with-odds.json` — a real NFL game
(Commanders @ Lions) with a DraftKings line posted, captured live on 2026-08-22:

```json
{
  "events": [
    {
      "id": "401873601",
      "date": "2026-08-22T16:00Z",
      "season": { "year": 2026 },
      "week": { "number": 3 },
      "competitions": [
        {
          "id": "401873601",
          "status": {
            "type": { "state": "pre", "name": "STATUS_SCHEDULED", "completed": false }
          },
          "competitors": [
            {
              "homeAway": "home",
              "score": "0",
              "team": {
                "id": "8",
                "abbreviation": "DET",
                "displayName": "Detroit Lions",
                "logo": "https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/det.png"
              }
            },
            {
              "homeAway": "away",
              "score": "0",
              "team": {
                "id": "28",
                "abbreviation": "WSH",
                "displayName": "Washington Commanders",
                "logo": "https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/wsh.png"
              }
            }
          ],
          "odds": [
            {
              "provider": { "displayName": "DraftKings" },
              "pointSpread": {
                "home": { "close": { "line": "-1.5", "odds": "-105" } },
                "away": { "close": { "line": "+1.5", "odds": "-115" } }
              },
              "total": {
                "over": { "close": { "line": "o36.5", "odds": "-105" } },
                "under": { "close": { "line": "u36.5", "odds": "-115" } }
              },
              "moneyline": {
                "home": { "close": { "odds": "-118" } },
                "away": { "close": { "odds": "-102" } }
              }
            }
          ]
        }
      ]
    }
  ]
}
```

`src/server/odds/espn/__tests__/fixtures/event-without-odds.json` — the same real game,
with the `odds` array removed. No live game happened to be in the "scheduled but no line
posted yet" state during the spike (only an already-`FINAL` game had no odds), so this one is
synthesized by deleting the field from a real payload rather than recorded directly — every
other field is identical to `event-with-odds.json`:

```json
{
  "events": [
    {
      "id": "401873601",
      "date": "2026-08-22T16:00Z",
      "season": { "year": 2026 },
      "week": { "number": 3 },
      "competitions": [
        {
          "id": "401873601",
          "status": {
            "type": { "state": "pre", "name": "STATUS_SCHEDULED", "completed": false }
          },
          "competitors": [
            {
              "homeAway": "home",
              "score": "0",
              "team": {
                "id": "8",
                "abbreviation": "DET",
                "displayName": "Detroit Lions",
                "logo": "https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/det.png"
              }
            },
            {
              "homeAway": "away",
              "score": "0",
              "team": {
                "id": "28",
                "abbreviation": "WSH",
                "displayName": "Washington Commanders",
                "logo": "https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/wsh.png"
              }
            }
          ]
        }
      ]
    }
  ]
}
```

`src/server/odds/espn/__tests__/fixtures/event-final.json` — a real completed NFL game
(Raiders @ Texans), captured live on 2026-08-22:

```json
{
  "events": [
    {
      "id": "401873286",
      "date": "2026-08-21T00:00Z",
      "season": { "year": 2026 },
      "week": { "number": 3 },
      "competitions": [
        {
          "id": "401873286",
          "status": {
            "type": { "state": "post", "name": "STATUS_FINAL", "completed": true }
          },
          "competitors": [
            {
              "homeAway": "home",
              "score": "20",
              "team": {
                "id": "34",
                "abbreviation": "HOU",
                "displayName": "Houston Texans",
                "logo": "https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/hou.png"
              }
            },
            {
              "homeAway": "away",
              "score": "22",
              "team": {
                "id": "13",
                "abbreviation": "LV",
                "displayName": "Las Vegas Raiders",
                "logo": "https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/lv.png"
              }
            }
          ]
        }
      ]
    }
  ]
}
```

- [ ] **Step 2: Write `espn-types.ts`** — the minimal typed shape of the fields the mappers
      read (not a full ESPN schema; ESPN's real payload has dozens of fields we never touch):

```ts
// src/server/odds/espn/espn-types.ts

export interface EspnTeamRef {
  id: string;
  abbreviation: string;
  displayName: string;
  logo?: string;
}

export interface EspnCompetitor {
  homeAway: 'home' | 'away';
  score?: string;
  team: EspnTeamRef;
}

export interface EspnStatusType {
  state: string;
  name: string;
  completed: boolean;
}

export interface EspnOddsPriceClose {
  line?: string;
  odds: string;
}

export interface EspnOddsSideClose {
  close: EspnOddsPriceClose;
}

export interface EspnOdds {
  provider: { displayName: string };
  pointSpread?: { home: EspnOddsSideClose; away: EspnOddsSideClose };
  total?: { over: EspnOddsSideClose; under: EspnOddsSideClose };
  moneyline?: { home: EspnOddsSideClose; away: EspnOddsSideClose };
}

export interface EspnCompetition {
  id: string;
  status: { type: EspnStatusType };
  competitors: EspnCompetitor[];
  odds?: EspnOdds[];
}

export interface EspnEvent {
  id: string;
  date: string;
  season: { year: number };
  week?: { number: number };
  competitions: EspnCompetition[];
}

export interface EspnScoreboardResponse {
  events: EspnEvent[];
}
```

- [ ] **Step 3: Write the failing mapper tests**

```ts
// src/server/odds/espn/__tests__/mappers.test.ts
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
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run src/server/odds/espn/__tests__/mappers.test.ts`
Expected: FAIL — `Cannot find module '../mappers'`

- [ ] **Step 5: Write `mappers.ts`**

```ts
// src/server/odds/espn/mappers.ts
import type { GameStatus, Sport } from '@/db/schema';
import type {
  ProviderGame,
  ProviderMarket,
  ProviderResult,
  ProviderSelection,
  ProviderTeam,
} from '../types';
import { parseLine } from './parse-line';
import type {
  EspnCompetition,
  EspnEvent,
  EspnOdds,
  EspnStatusType,
  EspnTeamRef,
} from './espn-types';

/**
 * Buckets ESPN's ~10 detailed status names into our 5-value enum, primarily off `state`
 * (`pre`/`in`/`post`) rather than `name`, since `name` has far more variants than we have
 * buckets for. A `post` status that isn't `completed` and isn't recognizably postponed or
 * canceled falls back to IN_PROGRESS rather than FINAL — an unrecognized status must never
 * silently trigger settlement.
 */
export function mapStatus(type: EspnStatusType): GameStatus {
  if (type.state === 'pre') return 'SCHEDULED';
  if (type.state === 'in') return 'IN_PROGRESS';

  if (type.completed) return 'FINAL';
  if (type.name === 'STATUS_POSTPONED') return 'POSTPONED';
  if (type.name === 'STATUS_CANCELED') return 'CANCELED';
  return 'IN_PROGRESS';
}

function competitors(competition: EspnCompetition): {
  home: EspnCompetition['competitors'][number];
  away: EspnCompetition['competitors'][number];
} {
  const home = competition.competitors.find((c) => c.homeAway === 'home');
  const away = competition.competitors.find((c) => c.homeAway === 'away');
  if (!home || !away) {
    throw new Error(`competition ${competition.id} is missing a home or away competitor`);
  }
  return { home, away };
}

function mapTeam(team: EspnTeamRef): ProviderTeam {
  return {
    externalId: team.id,
    name: team.displayName,
    abbreviation: team.abbreviation,
    logoUrl: team.logo ?? null,
  };
}

/** A game that hasn't started yet has no meaningful score — ESPN reports "0", we report null. */
function mapScore(status: GameStatus, raw: string | undefined): number | null {
  if (status === 'SCHEDULED' || status === 'POSTPONED' || status === 'CANCELED') return null;
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function mapGame(event: EspnEvent, sport: Sport): ProviderGame {
  const competition = event.competitions[0];
  const { home, away } = competitors(competition);

  return {
    externalId: competition.id,
    sport,
    home: mapTeam(home.team),
    away: mapTeam(away.team),
    startsAt: new Date(event.date),
    seasonYear: event.season.year,
    week: event.week?.number ?? null,
    status: mapStatus(competition.status.type),
  };
}

export function mapResult(event: EspnEvent): ProviderResult {
  const competition = event.competitions[0];
  const { home, away } = competitors(competition);
  const status = mapStatus(competition.status.type);

  return {
    gameExternalId: competition.id,
    status,
    homeScore: mapScore(status, home.score),
    awayScore: mapScore(status, away.score),
  };
}

function spreadMarket(gameExternalId: string, sourceBook: string, odds: EspnOdds): ProviderMarket {
  const selections: ProviderSelection[] = [
    {
      side: 'HOME',
      line: parseLine(odds.pointSpread!.home.close.line!),
      priceAmerican: Number(odds.pointSpread!.home.close.odds),
    },
    {
      side: 'AWAY',
      line: parseLine(odds.pointSpread!.away.close.line!),
      priceAmerican: Number(odds.pointSpread!.away.close.odds),
    },
  ];
  return { gameExternalId, type: 'SPREAD', sourceBook, selections };
}

function totalMarket(gameExternalId: string, sourceBook: string, odds: EspnOdds): ProviderMarket {
  const selections: ProviderSelection[] = [
    {
      side: 'OVER',
      line: parseLine(odds.total!.over.close.line!),
      priceAmerican: Number(odds.total!.over.close.odds),
    },
    {
      side: 'UNDER',
      line: parseLine(odds.total!.under.close.line!),
      priceAmerican: Number(odds.total!.under.close.odds),
    },
  ];
  return { gameExternalId, type: 'TOTAL', sourceBook, selections };
}

function moneylineMarket(
  gameExternalId: string,
  sourceBook: string,
  odds: EspnOdds,
): ProviderMarket {
  const selections: ProviderSelection[] = [
    { side: 'HOME', line: null, priceAmerican: Number(odds.moneyline!.home.close.odds) },
    { side: 'AWAY', line: null, priceAmerican: Number(odds.moneyline!.away.close.odds) },
  ];
  return { gameExternalId, type: 'MONEYLINE', sourceBook, selections };
}

/**
 * Each market type is extracted independently so a malformed `pointSpread` doesn't take
 * `moneyline` down with it. A missing `odds` array (no line posted yet) is normal — zero
 * markets, zero skips. A present-but-malformed market — the field exists but doesn't match
 * the expected shape — is what increments `skipped`.
 */
export function mapMarkets(event: EspnEvent): { markets: ProviderMarket[]; skipped: number } {
  const competition = event.competitions[0];
  const odds = competition.odds?.[0];
  if (!odds) return { markets: [], skipped: 0 };

  const gameExternalId = competition.id;
  const sourceBook = odds.provider.displayName;
  const markets: ProviderMarket[] = [];
  let skipped = 0;

  if (odds.pointSpread) {
    try {
      markets.push(spreadMarket(gameExternalId, sourceBook, odds));
    } catch {
      skipped += 1;
    }
  }

  if (odds.total) {
    try {
      markets.push(totalMarket(gameExternalId, sourceBook, odds));
    } catch {
      skipped += 1;
    }
  }

  if (odds.moneyline) {
    try {
      markets.push(moneylineMarket(gameExternalId, sourceBook, odds));
    } catch {
      skipped += 1;
    }
  }

  return { markets, skipped };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/server/odds/espn/__tests__/mappers.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 7: Commit**

```bash
git add src/server/odds/espn/espn-types.ts src/server/odds/espn/mappers.ts \
  src/server/odds/espn/__tests__/fixtures src/server/odds/espn/__tests__/mappers.test.ts
git commit -m "feat: add ESPN payload mappers with recorded fixtures"
```

---

### Task 3: `fetchScoreboard` — the shared fetch + per-game defensive parsing

**Files:**

- Create: `src/server/odds/espn/fetch-scoreboard.ts`
- Test: `src/server/odds/espn/__tests__/fetch-scoreboard.test.ts`

**Interfaces:**

- Consumes: `mapGame`, `mapResult`, `mapMarkets` (Task 2). `Sport` from `@/db/schema`.
  `ProviderGame`, `ProviderMarket`, `ProviderResult` from `../types`.
- Produces (used by Task 4):

```ts
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

export async function fetchScoreboard(
  sport: Sport,
  opts: { daysBack: number; daysForward: number },
): Promise<FetchScoreboardResult>;
```

- [ ] **Step 1: Write the failing test**

```ts
// src/server/odds/espn/__tests__/fetch-scoreboard.test.ts
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
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(loadFixtureText('event-with-odds.json')));
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
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(loadFixtureText('event-with-odds.json')));
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/odds/espn/__tests__/fetch-scoreboard.test.ts`
Expected: FAIL — `Cannot find module '../fetch-scoreboard'`

- [ ] **Step 3: Write `fetch-scoreboard.ts`**

```ts
// src/server/odds/espn/fetch-scoreboard.ts
import type { Sport } from '@/db/schema';
import type { ProviderGame, ProviderMarket, ProviderResult } from '../types';
import { mapGame, mapMarkets, mapResult } from './mappers';
import type { EspnScoreboardResponse } from './espn-types';

const SPORT_PATH: Record<Sport, string> = {
  NFL: 'nfl',
  NCAAF: 'college-football',
};

const MS_PER_DAY = 86_400_000;

function formatEspnDate(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function buildUrl(sport: Sport, opts: { daysBack: number; daysForward: number }): string {
  const now = new Date();
  const from = new Date(now.getTime() - opts.daysBack * MS_PER_DAY);
  const to = new Date(now.getTime() + opts.daysForward * MS_PER_DAY);

  const params = new URLSearchParams({ dates: `${formatEspnDate(from)}-${formatEspnDate(to)}` });
  if (sport === 'NCAAF') {
    params.set('groups', '80');
    params.set('limit', '200');
  }

  return `https://site.api.espn.com/apis/site/v2/sports/football/${SPORT_PATH[sport]}/scoreboard?${params}`;
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
 * Hits ESPN's public scoreboard endpoint once and maps every event it returns. A single
 * malformed event is skipped and counted, not thrown — the rest of the slate still comes
 * back. A request-level failure (unreachable, non-200) is NOT caught here; it propagates so
 * the caller's tick fails openly and the next cron run retries (see the plan's Global
 * Constraints for why this is scoped to the whole tick, not per-sport).
 */
export async function fetchScoreboard(
  sport: Sport,
  opts: { daysBack: number; daysForward: number },
): Promise<FetchScoreboardResult> {
  const response = await fetch(buildUrl(sport, opts));
  if (!response.ok) {
    throw new Error(`ESPN scoreboard request failed: ${response.status} ${response.statusText}`);
  }

  const body = (await response.json()) as EspnScoreboardResponse;

  const items: ParsedGame[] = [];
  let skippedGames = 0;
  let skippedMarkets = 0;

  for (const event of body.events ?? []) {
    try {
      const game = mapGame(event, sport);
      const result = mapResult(event);
      const { markets, skipped } = mapMarkets(event);
      skippedMarkets += skipped;
      items.push({ game, markets, result });
    } catch {
      skippedGames += 1;
    }
  }

  return { items, skippedGames, skippedMarkets };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/server/odds/espn/__tests__/fetch-scoreboard.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/server/odds/espn/fetch-scoreboard.ts src/server/odds/espn/__tests__/fetch-scoreboard.test.ts
git commit -m "feat: add fetchScoreboard with per-event defensive parsing"
```

---

### Task 4: `EspnOddsProvider` and `EspnScoreProvider`

`getMarkets(gameExternalIds)` and `getResults(gameExternalIds)` don't receive a `sport`
parameter — `sync.ts`/`results.ts` call them once with external IDs pooled across every synced
sport. Both providers resolve this by fanning out to `NFL` and `NCAAF` internally and filtering
by the wanted ID set, same as `FixtureOddsProvider`/`FixtureScoreProvider` do against their
in-memory slate.

`getUpcomingGames(sport, withinDays)` _is_ told a `withinDays`, but `getMarkets` isn't told
anything — so `EspnOddsProvider` remembers the `withinDays` its own last `getUpcomingGames`
call used, and reuses it for `getMarkets`'s fan-out. `syncOdds` always calls
`getUpcomingGames` for every sport before calling `getMarkets` once, so by the time
`getMarkets` runs, `getUpcomingGames` has already run at least once with the real value —
this doesn't depend on which sport it was called with, since `syncOdds` passes the same
`withinDays` for every sport in its loop.

**Files:**

- Create: `src/server/odds/espn/provider.ts`
- Test: `src/server/odds/espn/__tests__/provider.test.ts`

**Interfaces:**

- Consumes: `fetchScoreboard` (Task 3). `OddsProvider`, `ScoreProvider`, `ProviderGame`,
  `ProviderMarket`, `ProviderResult` from `../types`. `Sport` from `@/db/schema`.
- Produces: `EspnOddsProvider` (implements `OddsProvider`, plus
  `getSkipped(): { games: number; markets: number }`), `EspnScoreProvider` (implements
  `ScoreProvider`) — both consumed by Task 6's cron route.

- [ ] **Step 1: Write the failing test**

```ts
// src/server/odds/espn/__tests__/provider.test.ts
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
    const fetchMock = vi.fn().mockResolvedValue(scoreboardWith([NFL_EVENT]));
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(scoreboardWith([brokenEvent])));

    const provider = new EspnOddsProvider();
    await provider.getUpcomingGames('NFL', 14);
    await provider.getUpcomingGames('NCAAF', 14);
    await provider.getMarkets([]);

    const skipped = provider.getSkipped();
    expect(skipped.games).toBeGreaterThan(0);
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
    const fetchMock = vi.fn().mockResolvedValue(scoreboardWith([NFL_EVENT]));
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/odds/espn/__tests__/provider.test.ts`
Expected: FAIL — `Cannot find module '../provider'`

- [ ] **Step 3: Write `provider.ts`**

```ts
// src/server/odds/espn/provider.ts
import type { Sport } from '@/db/schema';
import type {
  OddsProvider,
  ProviderGame,
  ProviderMarket,
  ProviderResult,
  ScoreProvider,
} from '../types';
import { fetchScoreboard } from './fetch-scoreboard';

const ALL_SPORTS: Sport[] = ['NFL', 'NCAAF'];
const DEFAULT_WITHIN_DAYS = 14;
/** Enough to span one weekend of games without re-scanning further back on every tick. */
const SCORE_LOOKBACK_DAYS = 3;
const SCORE_LOOKAHEAD_DAYS = 1;

export class EspnOddsProvider implements OddsProvider {
  private lastWithinDays = DEFAULT_WITHIN_DAYS;
  private skippedGames = 0;
  private skippedMarkets = 0;

  async getUpcomingGames(sport: Sport, withinDays: number): Promise<ProviderGame[]> {
    this.lastWithinDays = withinDays;

    const { items, skippedGames } = await fetchScoreboard(sport, {
      daysBack: 0,
      daysForward: withinDays,
    });
    this.skippedGames += skippedGames;

    return items.map((item) => item.game);
  }

  async getMarkets(gameExternalIds: string[]): Promise<ProviderMarket[]> {
    const wanted = new Set(gameExternalIds);
    const markets: ProviderMarket[] = [];

    for (const sport of ALL_SPORTS) {
      const { items, skippedGames, skippedMarkets } = await fetchScoreboard(sport, {
        daysBack: 0,
        daysForward: this.lastWithinDays,
      });
      this.skippedGames += skippedGames;
      this.skippedMarkets += skippedMarkets;

      for (const item of items) {
        if (wanted.has(item.game.externalId)) markets.push(...item.markets);
      }
    }

    return markets;
  }

  getSkipped(): { games: number; markets: number } {
    return { games: this.skippedGames, markets: this.skippedMarkets };
  }
}

export class EspnScoreProvider implements ScoreProvider {
  async getResults(gameExternalIds: string[]): Promise<ProviderResult[]> {
    const wanted = new Set(gameExternalIds);
    const results: ProviderResult[] = [];

    for (const sport of ALL_SPORTS) {
      const { items } = await fetchScoreboard(sport, {
        daysBack: SCORE_LOOKBACK_DAYS,
        daysForward: SCORE_LOOKAHEAD_DAYS,
      });

      for (const item of items) {
        if (wanted.has(item.game.externalId)) results.push(item.result);
      }
    }

    return results;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/server/odds/espn/__tests__/provider.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/server/odds/espn/provider.ts src/server/odds/espn/__tests__/provider.test.ts
git commit -m "feat: add EspnOddsProvider and EspnScoreProvider"
```

---

### Task 5: Skip counters on `SyncOddsSummary`

`OddsProvider` gains an _optional_ `getSkipped?()` method — optional so `FixtureOddsProvider`
(which never skips anything) needs no change at all, and no existing test's expectations move.

**Files:**

- Modify: `src/server/odds/types.ts`
- Modify: `src/server/odds/sync.ts`
- Test: `src/server/odds/__tests__/sync.test.ts` (add to existing file)

**Interfaces:**

- Consumes: nothing new.
- Produces: `SyncOddsSummary` gains `gamesSkipped: number` and `marketsSkipped: number`.
  `OddsProvider` gains `getSkipped?(): { games: number; markets: number }`.

- [ ] **Step 1: Write the failing test** — append to the end of
      `src/server/odds/__tests__/sync.test.ts`, after the existing `describe('syncOdds', ...)`
      block closes. Do **not** add any new import statements: `OddsProvider`, `ProviderGame`,
      `ProviderMarket`, `FixtureOddsProvider`, `describe`, `it`, `expect`, `beforeEach`, `syncOdds`,
      and `resetDb` are all already imported at the top of this file (verify with
      `grep -n "^import" src/server/odds/__tests__/sync.test.ts` — every name below must appear
      there before proceeding):

```ts
class SkippingProvider implements OddsProvider {
  async getUpcomingGames(): Promise<ProviderGame[]> {
    return [];
  }
  async getMarkets(): Promise<ProviderMarket[]> {
    return [];
  }
  getSkipped(): { games: number; markets: number } {
    return { games: 2, markets: 5 };
  }
}

describe('syncOdds skip counters', () => {
  beforeEach(resetDb);

  it('surfaces getSkipped() on the summary when the provider implements it', async () => {
    const summary = await syncOdds({ provider: new SkippingProvider() });
    expect(summary.gamesSkipped).toBe(2);
    expect(summary.marketsSkipped).toBe(5);
  });

  it('defaults skip counts to zero for a provider that does not implement getSkipped', async () => {
    const summary = await syncOdds({ provider: new FixtureOddsProvider() });
    expect(summary.gamesSkipped).toBe(0);
    expect(summary.marketsSkipped).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/odds/__tests__/sync.test.ts -t "skip counters"`
Expected: FAIL — `summary.gamesSkipped` is `undefined`, not `2`

- [ ] **Step 3: Modify `types.ts`** — add the optional method to `OddsProvider`:

```ts
// src/server/odds/types.ts — change this block:
export interface OddsProvider {
  getUpcomingGames(sport: Sport, withinDays: number): Promise<ProviderGame[]>;
  getMarkets(gameExternalIds: string[]): Promise<ProviderMarket[]>;
  /**
   * Games/markets skipped due to malformed provider data since this instance was
   * constructed. Optional — the fixture provider never skips, so it doesn't implement this.
   */
  getSkipped?(): { games: number; markets: number };
}
```

- [ ] **Step 4: Modify `sync.ts`** — extend `SyncOddsSummary` and populate it:

```ts
// src/server/odds/sync.ts — change this block:
export interface SyncOddsSummary {
  gamesUpserted: number;
  marketsUpserted: number;
  selectionsUpserted: number;
  snapshotsWritten: number;
  gamesSkipped: number;
  marketsSkipped: number;
}
```

```ts
// src/server/odds/sync.ts — change the summary initializer inside syncOdds:
const summary: SyncOddsSummary = {
  gamesUpserted: 0,
  marketsUpserted: 0,
  selectionsUpserted: 0,
  snapshotsWritten: 0,
  gamesSkipped: 0,
  marketsSkipped: 0,
};
```

```ts
// src/server/odds/sync.ts — immediately before the final `return summary;`, add:
const skipped = options.provider.getSkipped?.();
if (skipped) {
  summary.gamesSkipped = skipped.games;
  summary.marketsSkipped = skipped.markets;
}

return summary;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/server/odds/__tests__/sync.test.ts`
Expected: PASS — every existing test in the file still passes, plus the 2 new ones (this file
has multiple `it()` blocks already; all must stay green, not just the new ones)

- [ ] **Step 6: Commit**

```bash
git add src/server/odds/types.ts src/server/odds/sync.ts src/server/odds/__tests__/sync.test.ts
git commit -m "feat: surface gamesSkipped/marketsSkipped on SyncOddsSummary"
```

---

### Task 6: The `ODDS_PROVIDER` kill switch

Wires `EspnOddsProvider`/`EspnScoreProvider` into the cron route behind an env var that
defaults to the fixture path. No existing test covers `route.ts` (no route-level tests exist
anywhere in this codebase today), so this task is verified by typecheck plus a manual curl
against the local dev server — consistent with how the rest of `src/app/api` is tested.

**Files:**

- Modify: `src/app/api/cron/sync-odds/route.ts`
- Modify: `.env.example`

**Interfaces:**

- Consumes: `EspnOddsProvider`, `EspnScoreProvider` (Task 4).

- [ ] **Step 1: Modify `route.ts`**

```ts
// src/app/api/cron/sync-odds/route.ts — full file:
import { FixtureOddsProvider, FixtureScoreProvider } from '@/fixtures/providers';
import { EspnOddsProvider, EspnScoreProvider } from '@/server/odds/espn/provider';
import { authorizeCronRequest, jsonSafe } from '@/server/cron/auth';
import { syncResults } from '@/server/odds/results';
import { suspendStaleMarkets, syncOdds } from '@/server/odds/sync';

/**
 * Every 15 minutes. Pulls the slate and prices, applies any reported results, then
 * suspends anything that has gone stale.
 *
 * ODDS_PROVIDER=espn switches to the real ESPN adapter; anything else (including unset)
 * keeps the fixture providers, so this ships inert until deliberately flipped in an
 * environment's config.
 */
export async function GET(request: Request): Promise<Response> {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  const useEspn = process.env.ODDS_PROVIDER === 'espn';
  const oddsProvider = useEspn ? new EspnOddsProvider() : new FixtureOddsProvider();
  const scoreProvider = useEspn ? new EspnScoreProvider() : new FixtureScoreProvider();

  const odds = await syncOdds({ provider: oddsProvider });
  const results = await syncResults({ provider: scoreProvider });
  const suspended = await suspendStaleMarkets();

  return Response.json(jsonSafe({ odds, results, suspended }));
}
```

- [ ] **Step 2: Modify `.env.example`** — append after the `CRON_SECRET` block:

```bash
# Real odds/score adapter. "espn" pulls live NFL/CFB slates and lines from ESPN's public
# JSON. Unset, or anything else, uses the fixture providers — the safe default with zero
# external calls.
ODDS_PROVIDER=
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 4: Manually verify the fixture path is unchanged**

```bash
npm run db:up
npm run dev
```

In another terminal:

```bash
curl -s -H "Authorization: Bearer $(grep CRON_SECRET .env.local | cut -d= -f2)" \
  http://localhost:3000/api/cron/sync-odds | head -c 500
```

Expected: a JSON body with `odds.gamesUpserted > 0` and `odds.gamesSkipped: 0` — confirms the
new fields are present and the default path is still the fixtures (ESPN would show 6+ real
game IDs like `401873601`, fixtures show IDs like `nfl-2026-w1-buf-nyj`).

- [ ] **Step 5: Manually verify the ESPN path against the real feed**

```bash
ODDS_PROVIDER=espn npm run dev
```

In another terminal, same curl as above. Expected: `odds.gamesUpserted` reflects a real NFL +
CFB slate; spot-check one row directly:

```bash
docker compose exec -T db psql -U simbet -d simbet -c \
  "select external_id, sport, starts_at, status from games order by starts_at desc limit 5;"
```

Expected: real ESPN external IDs (numeric strings like `401873601`), not fixture-style ones.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/cron/sync-odds/route.ts .env.example
git commit -m "feat: wire ODDS_PROVIDER kill switch into the sync-odds cron route"
```

---

## Final verification

- [ ] Run: `npm run verify`
- [ ] Expected: typecheck, lint, and the full test suite (including every new file above) all
      pass, with zero changes to any existing test's expectations.
