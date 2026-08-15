# Plan 3, Track A — The betting screens (Worker A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** A member on a phone can browse the slate, tap odds into a slip, place a single or a
parlay, and watch it settle — the four screens that make this feel like a sportsbook rather than
a database.

**Scope:** Worker A's half of Plan 3 only. B's half (Standings, Me/ledger, Admin, and the
`sync-odds` / `allowance` / `reconcile` cron routes) is a separate document B writes. The
**pair phase** — auth, app shell, tab bar, session helpers, shared UI primitives — precedes both
and is built together.

**Prerequisites:** Plan 2 merged on both sides, and the Plan 3 pair phase complete.

---

## Files you own in this plan

| Path | Contents |
|---|---|
| `src/domain/**` | Yours since Plan 1 |
| `src/server/bets/**` | Yours since Plan 2 |
| `src/app/(app)/games/**` | Games board, game detail |
| `src/app/(app)/bets/**` | My Bets, and the placement server action |
| `src/components/bet-slip/**` | The slip |
| `src/app/api/cron/settle/**` | The settle cron route |

## Files you must not touch

`src/db/**` · `drizzle/**` · `src/server/{money,seasons,admin,odds}/**` · `src/fixtures/**` ·
`src/test/**` · `src/app/(app)/standings/**` · `src/app/(app)/me/**` · `src/app/admin/**` ·
`src/app/api/cron/{sync-odds,allowance,reconcile}/**`

**Shared, so pair-phase only:** `src/app/layout.tsx`, the tab bar, `src/components/ui/**`,
auth config, and the session helpers. Once the pair phase ends, changing a shared primitive is a
conversation, not a commit. Two people independently restyling the same button is the exact
failure this split exists to prevent.

---

## What you need from the pair phase

Bring this to the sitting. Your screens do not compile without it.

```ts
// session and authorization helpers — the shape matters more than the names
requireApprovedMember(): Promise<{
  userId: string;
  membershipId: string;
  seasonId: string;
  balanceCents: bigint;
}>   // redirects PENDING users to the holding screen, throws 403 in actions

getSessionUser(): Promise<SessionUser | null>
```

`requireApprovedMember` is called at the top of every screen you build and inside your placement
action. Authorization is server-side on every request, never by hiding UI
([spec, failure handling](../specs/2026-08-14-core-betting-engine-design.md#failure-handling)).

**UI primitives you will need** — agree these exist before you start: `Button`, `Sheet` (bottom
sheet with drag-to-dismiss), `Tabs`, `Skeleton`, `EmptyState`, `Toast`, `NumericInput`, and a
`Money` display component that takes cents and renders `formatCents`.

**Tab bar:** Games · My Bets · Standings · Me, with Games as the default landing route
([D8](../decisions.md)).

---

## Decisions this plan makes

These answer the three open questions in
[worker-a-brief.md](worker-a-brief.md#what-you-need-to-work-out). Raise them with B, then promote
them to [decisions.md](../decisions.md) as new entries.

### A-D11 — The slip is client state in a context reducer, persisted to `sessionStorage`

Legs live in a `BetSlipProvider` context backed by `useReducer`, mirrored to `sessionStorage` on
every change. It survives navigating from the board to a game detail and back, and a reload. It
clears on successful placement, on sign-out, and when the stored `seasonId` no longer matches the
active season.

A server-side slip would mean a round trip per tapped price — the single most frequent interaction
in the app — to store something that is not money and does not need durability.

Each leg stores everything needed to render the slip without refetching: `selectionId`, `gameId`,
`marketId`, `marketType`, `side`, `line`, `priceAmerican`, plus display strings (team names, a
market label). Denormalized on purpose; the slip must render instantly and offline-ish.

### A-D12 — A moved line is caught by the server's 409, and the slip re-prices in place

No polling, no optimistic re-pricing. The slip submits what it displayed; if it moved, `placeBet`
returns `LINE_MOVED` with every changed leg and the recomputed payout, and the slip swaps into a
compare state: old price struck through, new price beside it, one **Accept new odds** button that
updates the stored legs and resubmits.

This is [D14](../decisions.md) made visible. The alternative — polling the slip every few seconds
— adds a request loop to catch a case the server already catches correctly, and still races.

The Games board revalidates every 30 seconds anyway (A-D13), so in practice a slip opened from a
fresh board is rarely stale. The 409 path is the correctness guarantee, not the common path.

### A-D13 — The odds board is a globally cached server component; per-user data is separate

The board is identical for every member — the same games, the same house lines
([D9](../decisions.md)). It renders as a server component from **one flat join query** with
`revalidate: 30`, cached once and served to everyone.

Nothing user-specific renders inside it. The balance lives in the header, the slip is client
state, and My Bets is its own route. Mixing a per-user field into the board would make the cache
per-user and multiply the query load by the membership count.

Sixty games times three markets is about 400 interactive elements — heavy enough to demand one
query and light enough not to need virtualization. **The filter defaults to one sport and one
week, and there is no "all" option.** Constraining the query is what keeps the page fast; a
scrolling technique that rescues an unbounded one is solving the wrong problem.

### A-D14 — Placement goes through a server action, not a route handler

`placeBetAction` in `src/app/(app)/bets/actions.ts` calls `placeBet` directly. It is typed
end-to-end, co-located with the screens, and keeps every HTTP concern out of your directory —
which also means you need no ownership carve-out under `src/app/api/`. The `PlaceBetError` codes
map to UI states directly; the HTTP table in Plan 2 Task A2 stays documentation for a future
public API rather than something to build now.

Your one route handler is `/api/cron/settle`, which Vercel invokes and which therefore has to be
a real endpoint.

### A-D15 — `bigint` never crosses the server/client boundary

Every server component and action marshals money as a **decimal string** at the boundary and
formats it with `formatCents` on the server, or re-parses to `bigint` on receipt. Stakes arrive
from the client as strings and go through `dollarsToCents`.

Verify React's serialization behavior for `bigint` in this Next.js version in Task A9 before
relying on either answer. String DTOs are correct regardless of what that check finds, which is
why they are the default rather than the fallback.

### A-D16 — The payout preview calls `payoutCents`, never arithmetic in a component

The number the slip shows and the number the server charges must come from the same function.
A component computing `stake * 1.909` for display is how a UI ends up promising a payout the
engine will not pay.

---

## Tasks

| Task | Produces | Depends on |
|---|---|---|
| A9. Board query and DTO boundary | `src/app/(app)/games/queries.ts` | pair phase |
| A10. Games board screen | `src/app/(app)/games/page.tsx` | A9 |
| A11. Game detail with line history | `src/app/(app)/games/[gameId]/page.tsx` | A9 |
| A12. Bet slip reducer | `src/components/bet-slip/reducer.ts` | A9 |
| A13. Bet slip sheet | `src/components/bet-slip/**` | A12 |
| A14. Placement action and the moved-line flow | `src/app/(app)/bets/actions.ts` | A13, Plan 2 A4 |
| A15. My Bets | `src/app/(app)/bets/page.tsx` | A14 |
| A16. Settle cron route | `src/app/api/cron/settle/route.ts` | Plan 2 A7 |

A12 is pure and testable with no database and no browser — build it while the pair phase is still
settling if you want a head start.

Branch naming continues: `a/task-a13-bet-slip`.

---

### Task A9: Board query and the DTO boundary

**Files:**
- Create: `src/app/(app)/games/queries.ts`
- Create: `src/app/(app)/games/dto.ts`
- Test: `src/app/(app)/games/__tests__/queries.test.ts`

**Interfaces:**

```ts
export interface SelectionDTO {
  id: string;
  side: Side;
  line: string | null;        // normalized (Plan 2 Task A1)
  priceAmerican: number;
  displayPrice: string;       // '-110', '+150' — the leading + matters
}

export interface MarketDTO {
  id: string;
  type: MarketType;
  status: 'OPEN' | 'SUSPENDED' | 'SETTLED';
  stale: boolean;             // last_synced_at older than 30 minutes
  selections: SelectionDTO[];
}

export interface GameRowDTO {
  id: string;
  sport: 'NFL' | 'NCAAF';
  startsAt: string;           // ISO
  status: string;
  home: TeamDTO;
  away: TeamDTO;
  markets: MarketDTO[];       // ordered SPREAD, MONEYLINE, TOTAL
}

export function getBoard(filter: { sport: Sport; week: number }): Promise<GameRowDTO[]>;
export function getGameDetail(gameId: string): Promise<GameDetailDTO | null>;
```

- [ ] **Step 1: Settle the `bigint` question**

Render a trivial server component passing a `bigint` prop to a client component and run it. Record
what happens in a comment in `dto.ts`. Either way, DTOs stay string-based (A-D15) — this is
about knowing the ground truth rather than guessing at it later during a bug.

- [ ] **Step 2: Write the failing test**

- `getBoard` issues **one** query for a slate of 60 games with three markets each. Assert the
  query count, not the wall-clock time — a timing assertion is flaky and an N+1 is a fact.
- Markets come back ordered spread, moneyline, total, matching the display grid.
- A market with `last_synced_at` 31 minutes old is `stale: true`; 29 minutes is `false`.
- Prices render `+150` and `-110` — the leading `+` is present.
- A game with a suspended market still appears on the board, with that market marked.
- A game with no markets at all does not appear.

- [ ] **Step 3: Implement**

One join across `games`, `teams` (twice), `markets`, `selections`, assembled into the DTO shape in
memory. Filter by sport, week, and `status = 'SCHEDULED'` with a future kickoff.

- [ ] **Step 4: Run the test — expect PASS**
- [ ] **Step 5: Commit** — `feat: add odds board query and DTOs`

---

### Task A10: The Games board

**Files:**
- Create: `src/app/(app)/games/page.tsx`, `sport-week-filter.tsx`, `game-row.tsx`, `odds-button.tsx`

- [ ] **Step 1: Build the screen**

Server component, `export const revalidate = 30`. Sport toggle and week selector drive
`searchParams`, so filter state is in the URL and shareable. Games grouped by day with a sticky
date header.

One row per game: away over home, kickoff time, and a three-column grid of spread / moneyline /
total. Each cell is a tappable `OddsButton` showing line above price. A selected button is
visibly active — the board is the primary surface for knowing what is in the slip.

- [ ] **Step 2: Handle the states that are not the happy path**

- Suspended or stale market → the cell renders as a lock, not a price, and is not tappable.
  Serving a dead line is worse than serving none.
- A game inside its kickoff minute → whole row disabled.
- Empty week → `EmptyState`, not a blank page.
- Loading → `loading.tsx` with skeleton rows matching the real row height, so the layout does not
  jump.

- [ ] **Step 3: Check it on a phone-sized viewport**

375px wide. The three-column grid must not wrap, and the bottom tab bar plus a collapsed slip must
not cover the last row — reserve the space in the page padding.

- [ ] **Step 4: Commit** — `feat: add the games board`

---

### Task A11: Game detail with line movement

**Files:**
- Create: `src/app/(app)/games/[gameId]/page.tsx`, `line-history.tsx`

- [ ] **Step 1: Build the screen**

Every market for one matchup, with the same tappable odds cells. Below each selection, its
`odds_snapshots` history — a compact sparkline or a short list of "opened at −3, now −3.5".

This screen is why `odds_snapshots` exists. It is also the cheapest place to make the app feel
like a real book rather than a form.

- [ ] **Step 2: Bound the history query**

Cap it — last 20 snapshots or last 7 days. An unbounded history query on a popular game is a slow
page that gets slower every sync.

- [ ] **Step 3: Handle a game that has started or finished**

Show the score and final markets rather than a 404. Members will open old games from My Bets.

- [ ] **Step 4: Commit** — `feat: add game detail with line movement history`

---

### Task A12: The bet slip reducer

Pure, no React, no DOM, no database. Fully unit tested.

**Files:**
- Create: `src/components/bet-slip/reducer.ts`, `types.ts`
- Test: `src/components/bet-slip/__tests__/reducer.test.ts`

**Interfaces:**

```ts
export interface SlipLeg {
  selectionId: string; gameId: string; marketId: string;
  marketType: MarketType; side: Side;
  line: string | null; priceAmerican: number;
  gameLabel: string; selectionLabel: string;
}

export interface SlipState {
  seasonId: string;
  legs: SlipLeg[];
  mode: 'SINGLES' | 'PARLAY';
  stakeByLegId: Record<string, string>;   // dollar strings, singles mode
  parlayStake: string;
  clientRequestId: string;
}

export type SlipAction =
  | { type: 'ADD_LEG'; leg: SlipLeg }
  | { type: 'REMOVE_LEG'; selectionId: string }
  | { type: 'TOGGLE_LEG'; leg: SlipLeg }
  | { type: 'SET_MODE'; mode: 'SINGLES' | 'PARLAY' }
  | { type: 'SET_STAKE'; selectionId: string | null; value: string }
  | { type: 'ACCEPT_MOVEMENTS'; movements: LineMovement[] }
  | { type: 'CLEAR' };
```

- [ ] **Step 1: Write the failing test**

- Adding a leg already present is a **replace**, not a duplicate.
- Tapping the same odds button twice removes the leg (`TOGGLE_LEG`).
- Adding a second selection **from the same market** replaces the first — you cannot bet both
  sides of one market on one slip.
- Adding a second leg **from the same game** is allowed in `SINGLES` and forces `SINGLES` mode
  if the slip was in `PARLAY` ([D13](../decisions.md): no same-game parlays). Assert the mode flips
  and the reason is surfaced.
- Going from one leg to two makes the Singles/Parlay toggle available; dropping back to one hides
  it and returns to `SINGLES`.
- An 11th leg is refused, and the state is unchanged.
- `ACCEPT_MOVEMENTS` updates exactly the moved legs' line and price and leaves the others alone.
- `SET_STAKE` accepts `'12.50'`, `'0'`, and `''`, and rejects `'12.505'` and `'abc'` without
  throwing — a reducer that throws on a keystroke crashes the screen.
- `CLEAR` produces a **new** `clientRequestId`, so the next submission is not deduplicated against
  the last one (Plan 2, A-D5).

- [ ] **Step 2: Run it and confirm it fails**
- [ ] **Step 3: Implement, then add persistence**

Pure reducer first. Then a thin `sessionStorage` mirror that validates the stored `seasonId` on
hydrate and discards a slip from a previous season.

- [ ] **Step 4: Run the test — expect PASS**
- [ ] **Step 5: Commit** — `feat: add bet slip state reducer`

---

### Task A13: The bet slip sheet

The hardest screen in the app: one sheet that is a single bet at one leg and reveals a
Singles/Parlay toggle at two.

**Files:**
- Create: `src/components/bet-slip/bet-slip-sheet.tsx`, `slip-leg-row.tsx`, `stake-input.tsx`,
  `payout-preview.tsx`, `bet-slip-provider.tsx`

- [ ] **Step 1: Build the collapsed state**

A bar above the tab bar: leg count and combined odds. Tapping expands the sheet. Zero legs renders
nothing at all.

- [ ] **Step 2: Build the expanded sheet**

One leg: selection label, game, price, stake input, payout preview, **Place bet**.
Two or more legs: a Singles/Parlay segmented control above the legs. Singles gives each leg its own
stake row and totals at the bottom; Parlay gives one stake, the combined price, and one payout.

- [ ] **Step 3: Stake input**

Numeric keypad on mobile (`inputMode="decimal"`). Quick chips: $5 / $25 / $100 / Max, where Max is
the balance. Two decimal places maximum, enforced at the keystroke.

Below the input, always visible: current balance, and balance after this bet.

- [ ] **Step 4: Payout preview**

`payoutCents(dollarsToCents(stake), combine(legs.map(americanToRational)))` — the domain functions,
in the browser, on `bigint` (A-D16). Show total return and profit separately; members read both.

- [ ] **Step 5: Disabled states**

Stake below $1, stake above balance, a leg whose market went suspended while the slip was open,
and the in-flight submission. Each with its own message. A greyed button with no explanation is
the worst version of every one of these.

- [ ] **Step 6: Check the whole thing at 375px with the keyboard open**

The sheet must not be taller than the visible viewport with a soft keyboard up, and **Place bet**
must stay reachable. This is the single most common way a mobile betting flow breaks.

- [ ] **Step 7: Commit** — `feat: add the bet slip sheet`

---

### Task A14: Placement action and the moved-line flow

**Files:**
- Create: `src/app/(app)/bets/actions.ts`
- Modify: `src/components/bet-slip/bet-slip-sheet.tsx`
- Test: `src/app/(app)/bets/__tests__/actions.test.ts`

**Interfaces:**

```ts
'use server';
export async function placeBetAction(input: {
  legs: { selectionId: string; line: string | null; priceAmerican: number }[];
  mode: 'SINGLES' | 'PARLAY';
  stakes: { selectionId: string | null; dollars: string }[];
  clientRequestId: string;
}): Promise<PlaceBetActionResult>;
```

- [ ] **Step 1: Write the failing test**

- A parlay submission calls `placeBet` **once**; a four-leg singles submission calls it **four
  times**, each with a distinct derived `clientRequestId` (`<id>:0` … `<id>:3`) — Plan 2's A-D4.
- Singles where one leg is rejected and three succeed returns a per-leg result. Three placed bets
  exist. A partial failure must not roll back the successes.
- A `PENDING` user gets `NOT_APPROVED` and no bet exists — assert the server rejects it, not the
  UI. The action never trusts the client's claim about who it is.
- The action calls `requireApprovedMember` before anything else.
- `dollarsToCents` runs server-side; a client sending `'12.505'` is rejected there too.

- [ ] **Step 2: Run it and confirm it fails**
- [ ] **Step 3: Implement the action**

`requireApprovedMember` → parse stakes with `dollarsToCents` → one `placeBet` call per bet →
`revalidatePath` on My Bets and the board.

Never re-implement a validation rule here. The action is a translator between the form and
`placeBet`; duplicating a rule creates two places for it to drift.

- [ ] **Step 4: Wire the moved-line flow (A-D12)**

On `LINE_MOVED`, the sheet enters compare state: each moved leg shows old price struck through
next to the new one, the payout updates from `newPotentialPayoutCents`, and one **Accept new odds**
button dispatches `ACCEPT_MOVEMENTS` and resubmits. A **Cancel** removes the moved legs.

Handle the other codes too: `INSUFFICIENT_FUNDS` offers **Bet max**; `MARKET_CLOSED` and
`GAME_NOT_BETTABLE` mark the offending leg with a remove action; `DUPLICATE_REQUEST` is treated as
success and shows the existing bet.

- [ ] **Step 5: On success**

Clear the slip, toast with the payout, and revalidate. Do not navigate away from the board — the
next bet is usually two rows down.

- [ ] **Step 6: Run the test — expect PASS**
- [ ] **Step 7: Commit** — `feat: add bet placement action with re-confirmation on line movement`

---

### Task A15: My Bets

**Files:**
- Create: `src/app/(app)/bets/page.tsx`, `bet-card.tsx`, `queries.ts`

- [ ] **Step 1: Build the query**

Pending and settled tabs, newest first, paginated. Bets with legs joined through selections to
markets and games. Backed by the `bets (membership_id, status)` index requested in Plan 2.

Render legs from `line_at_placement` and `price_at_placement`, **never from the live selection**.
A member must see the number they actually bet, not today's line ([D10](../decisions.md)).

- [ ] **Step 2: Build the card**

Stake, potential payout, combined price, status badge. Every leg with its frozen line and price,
its game, and — once settled — the final score and the leg's own status.

For a settled parlay where a leg pushed, show the recomputed payout **and** say why it differs
from the quoted one. "One leg pushed, recalculated as a 2-leg parlay" turns the single most
confusing moment in the product into a feature.

- [ ] **Step 3: Empty and pending states**

No bets → an `EmptyState` linking to the board. A pending bet on a live game → show the current
score if the game is in progress.

- [ ] **Step 4: Commit** — `feat: add my bets screen`

---

### Task A16: The settle cron route

**Files:**
- Create: `src/app/api/cron/settle/route.ts`
- Test: `src/app/api/cron/__tests__/settle-route.test.ts`

- [ ] **Step 1: Agree the cron authentication with B in the pair phase**

Three cron routes are theirs and one is yours; all four must authenticate identically. B's brief
lists this as an open question of theirs — settle it once, together, and implement the same check.

- [ ] **Step 2: Write the failing test**

- No credential → 401, and `settleFinalGames` is never called.
- Wrong credential → 401.
- Valid credential → 200 with the `SettleRunSummary` as JSON.
- A thrown error → 500 with a logged message, and the response body carries no internal detail.

- [ ] **Step 3: Implement**

A thin wrapper: authenticate, call `settleFinalGames()`, return the summary. `export const dynamic
= 'force-dynamic'` and `maxDuration` set to the plan's limit. No business logic in the route —
that is what makes moving settlement to a real worker later a deployment change rather than a
rewrite ([D3](../decisions.md)).

- [ ] **Step 4: Register the schedule in `vercel.json`**

`/api/cron/settle` every 10 minutes. `vercel.json` is shared with B's three routes — **add your
entry during the deployment rejoin, not on your own branch.** Four cron entries in one file is a
guaranteed merge conflict if you both edit it independently.

- [ ] **Step 5: Run the test — expect PASS**
- [ ] **Step 6: Commit** — `feat: add settle cron route`

---

## Definition of done for your half of Plan 3

- [ ] `npm test -- src/domain/ src/server/bets/ src/app/` passes
- [ ] `npm run typecheck` and `npm run lint` pass
- [ ] Every screen renders correctly at 375px wide
- [ ] A `PENDING` user is refused by the **server** on the board, the detail page, and the
      placement action — verified by test, not by inspection
- [ ] The payout the slip previews equals the payout the ledger writes, proven by one test that
      compares them
- [ ] A line moved between board render and placement produces the re-confirm flow, not a silently
      different price
- [ ] The slip survives navigating from the board to a game detail and back
- [ ] No file outside your ownership table has your name on it, and `vercel.json` was edited
      jointly

## Rejoin with B: deployment

Do this together — hosted Postgres, OAuth credentials for Google and Apple, environment variables,
`vercel.json` with all four cron schedules, and running migrations against production. Both of you
should be able to redeploy this app alone at the end of it.

## Open items to raise before you start

1. The cron authentication scheme — one decision covering all four routes (Task A16 Step 1).
2. The exact shape of `requireApprovedMember`, since every screen you build calls it.
3. Which UI primitives the pair phase produces, so you are not blocked mid-slip on a missing
   `Sheet`.
4. Who owns `vercel.json` and when it gets its cron entries.
5. Whether the board's 30-second revalidation matches B's 15-minute `syncOdds` cadence closely
   enough — there is no point revalidating a cache twice as often as the data changes, and
   halving that request volume is free.
