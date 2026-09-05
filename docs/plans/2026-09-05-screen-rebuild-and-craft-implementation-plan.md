# Screen rebuild and craft — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild every screen on the 7b vocabulary — hot path first, shippable after each one —
then land 7d's craft (motion, skeletons, a11y, the dark toggle, the accent picker) on the rebuilt
screens without reopening them.

**Architecture:** Twenty-one tasks in two rungs. 7c (Tasks 1–13): the token layer gains six
accent hues, one date vocabulary and a Toast layer land as shared infrastructure, the shell gains
its desktop shape, and the seven screen groups are rebuilt in the order Games/slip → Feed →
Standings → Bets/Wagers → Events → Me → Admin, with `Sheet`, `Toast`, `Table`, and `Dialog` each
born in the commit that first needs it (D53). 7d (Tasks 14–21): the component harness (D79),
motion, skeletons, the dark-mode toggle, the accent picker, an a11y pass, and a copy pass. Each
rung ends with a browser audit against the real local ESPN slate.

**Tech Stack:** Next.js 16.3 (App Router), TypeScript, Drizzle ORM + Postgres, Tailwind v4 with
this repo's semantic token layer, Vitest (plus jsdom + React Testing Library, dev-only, arriving
in Task 14). No new runtime dependency anywhere in the plan.

**Spec:** [`docs/specs/2026-09-05-screen-rebuild-and-craft-design.md`](../specs/2026-09-05-screen-rebuild-and-craft-design.md).
Read it before Task 1. Decisions [D74–D79](../decisions.md#d74--desktop-is-a-content-column-plus-a-games-slip-rail-not-a-redesign)
are recorded — do not re-litigate them, and do not add new ones without the decision-log skill.

---

## Global Constraints

These apply to every task and are not repeated per task.

- **Lane tags are mandatory.** Every task carries `[CLOUD]`, `[LOCAL]`, `[MANUAL]` or `[NOAH]`.
  Do not start a task whose lane you are not in.
- **The design canvas refines visuals; this plan binds structure.** DOM structure, component
  APIs, behaviour, copy, and tests in this plan are binding. Tailwind classes shown for new
  markup are starting values the approved design canvas may adjust — a class delta from the
  canvas is not a plan deviation; a structural or behavioural delta is.
- **The rungs stay separate.** No 7c task (1–13) may depend on a 7d task (14–21). The app must
  ship at the end of Task 13.
- **`npm ci` first.** `node_modules` may be absent or stale at session start.
- **`npm test` DOES run in a cloud session.** Measured 2026-09-05 on this plan's base:
  **109 files / 1121 tests, exit 0, 56s**. If the session-start hook fails to bring Postgres up,
  say so explicitly and mark DB tests written-but-not-run rather than claiming they passed.
- **`npm run verify` is the gate** — typecheck, lint, full suite. Run before every commit that
  touches `src/`. Run `npm run format` before every commit.
- **No raw colour classes in `.tsx`.** `src/app/__tests__/token-lint.test.ts` fails the build on
  a raw palette class, hex value, or `dark:` variant outside its allowlist. Speak only the
  semantic vocabulary. Task 1 extends the *token layer*; it does not loosen the lint.
- **Type and spacing subsets are law.** Type: `text-xs` … `text-2xl` only. Spacing: the 4px
  scale in steps `0.5 1 2 3 4 6 8 12 16`. Rebuilt screens must land inside these (spec §success
  criteria 11).
- **Every form using `useTransition` disables a control while pending** (D51 structural test).
- **This plan adds no `postEntry` call and edits nothing under `src/server/money`,
  `src/server/bets`, `src/server/p2p`, or `src/server/events/resolve.ts`.** This phase renders
  differently; it computes nothing differently. If a task seems to need a server-logic edit,
  re-read the task. (Exception: none. Task 9's leg query is a new read in the page, not an edit
  to bet logic. Task 18's migration touches `src/db/schema/identity.ts` only.)
- **Money is `bigint` cents everywhere; render through `Money`/`Price`/`Line`.** Never `Number`
  an amount. Client payout math in Task 6 uses `src/domain/odds.ts` (bigint-safe) — do not
  reimplement it.
- **Server components by default.** A file gains `'use client'` only for state or handlers the
  task names. Filters are links, not client state (D77).
- **Commit after every task** (some tasks name intermediate commits). Imperative subject, a body
  explaining *why*, and this repo's attribution footer.

---

## File Structure

| File | New? | Responsibility |
| ---- | ---- | -------------- |
| `src/app/globals.css` | modify | Tier-1 accent ramps, `[data-accent]` remaps, green default, dark slip-shadow fix |
| `src/app/__tests__/token-layer.test.ts` | modify | Assert the six accent remaps |
| `src/domain/dates.ts` | new | `formatDayHeading`, `formatKickoff`, `formatDateTime` — the one date vocabulary |
| `src/domain/__tests__/dates.test.ts` | new | Fixed-date tests for all three |
| `src/components/ui/toast.tsx` | new | `ToastProvider`, `useToast` — the announcement layer (D76) |
| `src/components/ui/sheet.tsx` | new | Bottom sheet: portal, scrim, ESC, focus trap, scroll lock |
| `src/components/ui/dialog.tsx` | new | `ConfirmDialog` over native `<dialog>` |
| `src/components/ui/table.tsx` | new | `Table`/`THead`/`TBody`/`Tr`/`Th`/`Td` token-speaking primitives |
| `src/components/ui/card.tsx` | modify | `as` element prop (the 7b review's escape hatch) |
| `src/components/ui/tab-bar.tsx` | modify | Export `NAV_ITEMS`; hide below the header at `lg` |
| `src/app/(app)/layout.tsx` | modify | Header nav at `lg`, ToastProvider mount, slip placement |
| `src/app/(app)/(column)/layout.tsx` | new | The centered `max-w-2xl` content column (D74) |
| `src/app/(app)/(column)/…` | move | `feed`, `standings`, `bets`, `wagers`, `events`, `me`, `members` move under the column group (URLs unchanged) |
| `src/app/(app)/games/page.tsx` | modify | Filters, day sections, two-pane grid at `lg` |
| `src/app/(app)/games/game-row.tsx` | new | The compact two-line row (D77) |
| `src/app/(app)/games/day-section.tsx` | new | Sticky-header, collapsible `<details>` day group |
| `src/app/(app)/games/odds-cell.tsx` | new | Extracted from `game-card.tsx`; shared cell button |
| `src/app/(app)/games/game-card.tsx` | delete | Replaced by `game-row.tsx` (Task 5, once the row ships) |
| `src/components/bet-slip/bet-slip.tsx` | modify | Sheet container below `lg`; leg prices; To-return line; toasts |
| `src/components/bet-slip/slip-rail.tsx` | new | The `lg+` rail on `/games` (same panel, second container) |
| `src/app/(app)/(column)/feed/feed-card.tsx` | modify | Reaction row collapses to a trigger |
| `src/app/(app)/(column)/feed/[eventId]/page.tsx` | modify | `generateMetadata`, back link |
| `src/app/(app)/(column)/standings/page.tsx` | modify | `Table` at `lg`, cards below |
| `src/app/(app)/(column)/bets/page.tsx` | modify | Leg describer with teams, one status chip, merged controls |
| `src/app/(app)/(column)/bets/leg-label.tsx` | new | `LegLine` — game legs name their game everywhere |
| `src/app/(app)/(column)/wagers/page.tsx` | modify | One section per wager |
| `src/app/(app)/(column)/wagers/[wagerId]/*` | modify | `ConfirmDialog` on call-it-off; dates via `domain/dates` |
| `src/app/(app)/(column)/events/…` | modify | Stacked datetimes, metadata, back links, drop "Book: —" |
| `src/app/(app)/(column)/me/page.tsx` | modify | English ledger labels, settings list, ledger `Table` at `lg` |
| `src/app/admin/*` → `src/app/(app)/(column)/admin/*` | move | Admin joins the shell (D78); `requireAdmin` stays in its layout |
| `docs/screen-rebuild-audit.md` | new | The 7c and 7d browser audits |
| `vitest.config.ts` | modify (Task 14) | Projects split: node + jsdom |
| `src/components/ui/__tests__/*.test.tsx` | new (Task 14) | Dialog/Sheet/Toast behaviour (D79) |
| `src/db/schema/identity.ts` | modify (Task 18) | `users.accent` column |
| `src/app/(app)/(column)/me/appearance-*.tsx` | new (Tasks 17–18) | Dark toggle + accent picker |
| `docs/roadmap.md`, `docs/README.md` | modify | Status rows at each rung's end |

---

## Before you start

- [ ] `npm ci`
- [ ] `git switch -c claude/phase-7c-<suffix>` from latest `main` (7d work later branches as
      `claude/phase-7d-<suffix>` after 7c merges)
- [ ] Read the spec, and D74–D79
- [ ] Confirm Postgres: `pg_isready` (if not up, every **DB** task is written-but-unrun — say so)
- [ ] Baseline: `npm test` — expect 109 files / 1121 tests passing
- [ ] **Real data for anything visual:** `ODDS_PROVIDER=espn` in `.env.local`, `npm run dev`,
      then `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/sync-odds`.
      Fixture fallback: `npm run db:seed` — but the Task 13 board audit needs the real slate.

---

### Task 1 [CLOUD]: Six accent hues in the token layer

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/__tests__/token-layer.test.ts`

**Interfaces:**
- Produces: `[data-accent="green"|"blue"|"indigo"|"violet"|"teal"|"orange"]` remapping exactly
  `--accent` and `--accent-ink` in both themes; green as the `:root` default (no attribute
  needed); the dark slip shadow's second layer. Consumed by Task 18's picker; visible to every
  screen immediately.

- [ ] **Step 1: Extend the token-layer test to fail**

Add to `src/app/__tests__/token-layer.test.ts` (follow the file's existing helpers for parsing
`globals.css` blocks):

```ts
const ACCENTS = ['green', 'blue', 'indigo', 'violet', 'teal', 'orange'] as const;

describe('accent remaps', () => {
  it.each(ACCENTS)('defines %s in light, media-dark, and data-theme-dark', (hue) => {
    // Three selector contexts, matching how the neutrals handle [data-theme]:
    expect(css).toMatch(new RegExp(`\\[data-accent='${hue}'\\]`));
    // Each accent block sets exactly these two tokens and nothing else:
    for (const block of accentBlocksFor(hue)) {
      expect(Object.keys(block)).toEqual(['--accent', '--accent-ink']);
    }
  });

  it('defaults :root --accent to the green ramp, not the neutral ramp', () => {
    expect(lightRootBlock['--accent']).toBe('var(--acc-green)');
  });
});
```

Write `accentBlocksFor` beside the file's existing block parser. Run
`npx vitest run src/app/__tests__/token-layer.test.ts` — expect FAIL (no accent blocks exist).

- [ ] **Step 2: Copy the Tier-1 ramp stops**

The exact `oklch()` values come from the installed Tailwind, never from memory — the same rule
7b used:

```bash
grep -E -- '--color-(green|blue|indigo|violet|teal|orange)-(400|600|700|950):' node_modules/tailwindcss/theme.css
```

Add to the Tier-1 section of `globals.css`, per hue, the stops the table below names (copied
values, `--acc-*` prefix so Tier-1 privacy holds):

| Hue | Light `--accent` | Dark `--accent` | Light ink | Dark ink |
| --- | --- | --- | --- | --- |
| green (default) | green-700 | green-400 | white (`--n-0`) | green-950 |
| blue | blue-600 | blue-400 | white | blue-950 |
| indigo | indigo-600 | indigo-400 | white | indigo-950 |
| violet | violet-600 | violet-400 | white | violet-950 |
| teal | teal-700 | teal-400 | white | teal-950 |
| orange | orange-700 | orange-400 | white | orange-950 |

Green and teal and orange use the 700 stop in light deliberately: green must sit visibly darker
and yellower than emerald (`--positive`), orange redder and deeper than amber (`--caution`), and
the 600 stops fail 4.5:1 with white ink. If a measured pair in Task 13's audit misses 4.5:1,
move that stop one step darker (light) or lighter (dark) — the table is the intent, the ratio is
the requirement.

- [ ] **Step 3: Write the remap blocks**

Pattern, shown for blue — repeat for all six (green additionally becomes the `:root` default by
pointing the existing `--accent`/`--accent-ink` lines at the green ramp):

```css
:root[data-accent='blue'] {
  --accent: var(--acc-blue);        /* blue-600 */
  --accent-ink: var(--n-0);
}
@media (prefers-color-scheme: dark) {
  :root[data-accent='blue']:not([data-theme='light']) {
    --accent: var(--acc-blue-dark); /* blue-400 */
    --accent-ink: var(--acc-blue-ink-dark); /* blue-950 */
  }
}
:root[data-theme='dark'][data-accent='blue'] {
  --accent: var(--acc-blue-dark);
  --accent-ink: var(--acc-blue-ink-dark);
}
```

- [ ] **Step 4: Fix the dark slip shadow**

Find the slip shadow token (`grep -n slip src/app/globals.css`). Its dark value gains a 1px
light top edge so elevation reads against a pure-black page (the 7b audit's finding):

```css
/* dark: */ 0 -8px 24px rgb(0 0 0 / 0.5), 0 -1px 0 rgb(255 255 255 / 0.08);
```

- [ ] **Step 5: Verify and commit**

Run: `npx vitest run src/app/__tests__/token-layer.test.ts src/app/__tests__/token-lint.test.ts`
— expect PASS. Then `npm run verify`, `npm run format`, and view `/games` in both themes: every
formerly-black selected/primary control now renders green; nothing else moved.

```bash
git add src/app/globals.css src/app/__tests__/token-layer.test.ts
git commit -m "feat: six accent hues under [data-accent], green default"
```

---

### Task 2 [CLOUD]: One date vocabulary

**Files:**
- Create: `src/domain/dates.ts`
- Test: `src/domain/__tests__/dates.test.ts`

**Interfaces:**
- Produces: `formatDayHeading(d: Date): string` → `"Saturday, Sep 5"`;
  `formatKickoff(d: Date): string` → `"12:00 PM ET"`;
  `formatDateTime(d: Date, now?: Date): string` → `"Sep 7, 11:25 AM ET"`, adding the year
  (`"Sep 7, 2027, 11:25 AM ET"`) only when it differs from `now`'s. All in
  `America/New_York`. Consumed by Tasks 5, 9, 10, 11.

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { formatDayHeading, formatKickoff, formatDateTime } from '@/domain/dates';

const kickoff = new Date('2026-09-05T16:00:00Z'); // noon ET

describe('dates', () => {
  it('formats a day heading', () => {
    expect(formatDayHeading(kickoff)).toBe('Saturday, Sep 5');
  });
  it('formats a kickoff time', () => {
    expect(formatKickoff(kickoff)).toBe('12:00 PM ET');
  });
  it('omits the year when it matches now', () => {
    expect(formatDateTime(kickoff, new Date('2026-09-01T00:00:00Z'))).toBe('Sep 5, 12:00 PM ET');
  });
  it('includes the year when it differs', () => {
    expect(formatDateTime(kickoff, new Date('2027-01-01T00:00:00Z'))).toBe(
      'Sep 5, 2026, 12:00 PM ET',
    );
  });
});
```

Run: `npx vitest run src/domain/__tests__/dates.test.ts` — FAIL, module not found.

- [ ] **Step 2: Implement**

```ts
const ET = 'America/New_York';
const opt = (o: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions => ({ timeZone: ET, ...o });

export function formatDayHeading(d: Date): string {
  return d.toLocaleDateString('en-US', opt({ weekday: 'long', month: 'short', day: 'numeric' }));
}

export function formatKickoff(d: Date): string {
  return `${d.toLocaleTimeString('en-US', opt({ hour: 'numeric', minute: '2-digit' }))} ET`;
}

export function formatDateTime(d: Date, now: Date = new Date()): string {
  const sameYear =
    d.toLocaleDateString('en-US', opt({ year: 'numeric' })) ===
    now.toLocaleDateString('en-US', opt({ year: 'numeric' }));
  const date = d.toLocaleDateString(
    'en-US',
    opt({ month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }),
  );
  return `${date}, ${formatKickoff(d)}`;
}
```

- [ ] **Step 3: Pass, then commit**

`npx vitest run src/domain/__tests__/dates.test.ts` → PASS. `npm run verify`, format, commit
(`feat: one date vocabulary in domain/dates`). Adoption happens screen by screen (Tasks 5, 9,
10, 11) — do not sweep call sites here.

---

### Task 3 [CLOUD]: Toast — the announcement layer (D76)

**Files:**
- Create: `src/components/ui/toast.tsx`
- Modify: `src/app/(app)/layout.tsx`
- Test: `src/app/__tests__/toast-structure.test.ts`

**Interfaces:**
- Produces: `ToastProvider` (client), `useToast(): { toast(t: { tone: 'positive' | 'negative' | 'neutral'; title: string; description?: string }): void }`.
  Consumed by every form task (6, 7, 9, 10, 11, 12) — one `toast()` per submitted action's
  result, success and failure both; field-level validation additionally marks the field inline.

- [ ] **Step 1: Failing structural test**

D51-style source assertions (behaviour tests arrive with the harness in Task 14):

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const toast = readFileSync('src/components/ui/toast.tsx', 'utf8');
const shell = readFileSync('src/app/(app)/layout.tsx', 'utf8');

describe('toast layer', () => {
  it('announces via a polite live region', () => {
    expect(toast).toMatch(/role="status"/);
    expect(toast).toMatch(/aria-live="polite"/);
  });
  it('is mounted once, in the app shell', () => {
    expect(shell).toMatch(/<ToastProvider>/);
  });
});
```

- [ ] **Step 2: Implement `toast.tsx`**

Client component. Core (complete; classes are canvas-adjustable):

```tsx
'use client';
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Tone = 'positive' | 'negative' | 'neutral';
interface ToastInput { tone: Tone; title: string; description?: string }
interface ToastItem extends ToastInput { id: string }

const ToastContext = createContext<{ toast: (t: ToastInput) => void } | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast outside ToastProvider');
  return ctx;
}

const DISMISS_MS = 5000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    timers.current.delete(id);
    setItems((all) => all.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((input: ToastInput) => {
    const id = crypto.randomUUID();
    setItems((all) => [...all.slice(-2), { ...input, id }]); // queue of 3
    timers.current.set(id, setTimeout(() => dismiss(id), DISMISS_MS));
  }, [dismiss]);

  const pause = (id: string) => clearTimeout(timers.current.get(id));
  const resume = (id: string) => timers.current.set(id, setTimeout(() => dismiss(id), DISMISS_MS));

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {typeof document !== 'undefined' &&
        createPortal(
          <div role="status" aria-live="polite"
               className="pointer-events-none fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6">
            {items.map((t) => (
              <div key={t.id} onMouseEnter={() => pause(t.id)} onMouseLeave={() => resume(t.id)}
                   className="pointer-events-auto flex w-full max-w-sm items-start justify-between gap-3 rounded-card border border-line bg-surface-raised p-3 shadow-slip">
                <div className="flex flex-col gap-0.5">
                  <span className={`text-sm font-semibold ${t.tone === 'negative' ? 'text-negative' : t.tone === 'positive' ? 'text-positive' : ''}`}>{t.title}</span>
                  {t.description && <span className="text-xs text-ink-muted">{t.description}</span>}
                </div>
                <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)}
                        className="text-xs text-ink-muted">✕</button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}
```

- [ ] **Step 3: Mount in the shell**

Wrap `(app)/layout.tsx`'s returned tree in `<ToastProvider>` (inside the outer `<div>` is fine —
the portal escapes it). No screen consumes it yet; call sites arrive with their screens.

- [ ] **Step 4: Verify and commit**

`npx vitest run src/app/__tests__/toast-structure.test.ts` → PASS; `npm run verify`; commit
(`feat: toast announcement layer (D76)`).

---

### Task 4 [CLOUD]: The desktop shell (D74)

**Files:**
- Modify: `src/components/ui/tab-bar.tsx` — export `NAV_ITEMS: { href: string; label: string }[]`
  (the six existing destinations, single source); root nav element gains `lg:hidden`
- Modify: `src/app/(app)/layout.tsx` — header renders `NAV_ITEMS` as links in a
  `hidden lg:flex items-center gap-4` list between the wordmark and the Admin/balance cluster,
  active state via `usePathname` in the same client component the TabBar uses (reuse its active
  logic — one implementation, two placements)
- Create: `src/app/(app)/(column)/layout.tsx`
- Move: `feed`, `standings`, `bets`, `wagers`, `events`, `me`, `members` from `src/app/(app)/`
  into `src/app/(app)/(column)/` (`git mv` — route groups leave URLs unchanged)

**Interfaces:**
- Produces: the `(column)` group whose layout is exactly
  `<div className="mx-auto w-full max-w-2xl flex-1">{children}</div>`; `NAV_ITEMS`. `/games`
  stays outside the group (its `lg` two-pane grid arrives in Task 6). Task 12 moves admin in.

- [ ] **Step 1:** `git mv` the seven route directories; create the `(column)` layout; build must
      stay green: `npm run build`. Expect the same routes in the route manifest.
- [ ] **Step 2:** `NAV_ITEMS` export + header nav + `lg:hidden` on the tab bar. Check
      `src/app/__tests__/` for structural tests naming the moved paths (`grep -rn "(app)/" src/app/__tests__`)
      and update path literals — the assertions themselves must not weaken.
- [ ] **Step 3:** Verify at 1280×800: header shows the six links + Admin + balance, no bottom
      bar; at 375: bottom bar unchanged. `npm run verify`; commit
      (`feat: desktop shell — header nav and the content column (D74)`).

---

### Task 5 [CLOUD]: The odds board (D77)

**Files:**
- Create: `src/app/(app)/games/odds-cell.tsx` — extract the cell `<button>` (selected state,
  suspended `—` rendering, slip-context toggle) from `game-card.tsx` verbatim; both render it
  during this task; `game-card.tsx` is deleted at the end
- Create: `src/app/(app)/games/game-row.tsx`
- Create: `src/app/(app)/games/day-section.tsx`
- Modify: `src/app/(app)/games/page.tsx`
- Delete: `src/app/(app)/games/game-card.tsx`
- Test: `src/app/__tests__/board-structure.test.ts`

**Interfaces:**
- Consumes: `getSlate()` from `src/server/odds/board.ts` (`BoardGame[]` — has `sport`,
  `startsAt`, teams, markets) — **read-only; do not edit `src/server/odds/`**; `formatDayHeading`/
  `formatKickoff` (Task 2); the slip context (unchanged).
- Produces: `GameRow({ game: BoardGame })`, `DaySection({ heading, count, defaultOpen, children })`.

- [ ] **Step 1: Failing structural test** — asserts the URL-driven filters and the collapse
      element exist:

```ts
const page = readFileSync('src/app/(app)/games/page.tsx', 'utf8');
const section = readFileSync('src/app/(app)/games/day-section.tsx', 'utf8');
it('filters are links driven by searchParams, not client state', () => {
  expect(page).toMatch(/searchParams/);
  expect(page).not.toMatch(/'use client'/);
});
it('day sections are native details/summary', () => {
  expect(section).toMatch(/<details/);
  expect(section).toMatch(/<summary/);
});
```

- [ ] **Step 2: `GameRow`** — a two-line grid; each line: team + its three `OddsCell`s. Kickoff
      in the leading column. Starting markup:

```tsx
<article className="grid grid-cols-[minmax(0,1fr)_repeat(3,4rem)] items-center gap-x-2 gap-y-1 border-b border-line-subtle px-1 py-2 lg:grid-cols-[3.5rem_minmax(0,1fr)_repeat(3,4.5rem)]">
  <span className="hidden text-xs text-ink-muted lg:block row-span-2">{formatKickoff(game.startsAt)}</span>
  {/* away line: abbr + spread/money/total cells; home line below; time shown inline before
      the away abbr at <lg. Suspended market → the existing dashed “—” cell. */}
</article>
```

- [ ] **Step 3: `DaySection`** — `<details open={defaultOpen}>`; `<summary>` is the sticky
      header (`sticky top-12 z-10 bg-surface`) carrying `formatDayHeading` + "· N games", and
      the single SPREAD/MONEY/TOTAL column-header row renders once under it inside the open
      section. First (today's) section `defaultOpen`, later days collapsed.
- [ ] **Step 4: Page** — parse `searchParams` `league` (`NFL`|`NCAAF`) and `day`
      (`YYYY-MM-DD`, ET); filter the slate server-side; render two `SegmentedControl` chip rows
      (league: All/NFL/NCAAF; day: All + each day with a count, horizontally scrollable in an
      `overflow-x-auto` row). Chips are links carrying both params. Group by ET day as today,
      through `formatDayHeading`.
- [ ] **Step 5:** Delete `game-card.tsx`; fix imports. `npm run verify`. **Manual check against
      the real slate:** today's section open with rows, later sections collapsed with counts,
      `?league=NFL` narrows, selected-cell state and slip bar still work (the slip itself is
      still the old one — Task 6). Commit (`feat: compact odds board — rows, day sections, filters (D77)`).

---

### Task 6 [CLOUD]: The bet slip — Sheet born, prices and payout shown

**Files:**
- Create: `src/components/ui/sheet.tsx`
- Modify: `src/components/bet-slip/bet-slip.tsx`
- Create: `src/components/bet-slip/slip-rail.tsx`
- Modify: `src/app/(app)/games/page.tsx` (the `lg` two-pane grid + rail)
- Modify: `src/app/(app)/layout.tsx` (slip placement)
- Test: `src/app/__tests__/sheet-structure.test.ts`

**Interfaces:**
- Consumes: slip context (`slip-context.tsx`, unchanged); `useToast` (Task 3);
  `americanToRational`, `combine`, `payoutCents` from `src/domain/odds.ts`.
- Produces: `Sheet({ open, onClose, label, children })` — portal, scrim (click dismisses), ESC
  dismisses, focus moves in on open and restores on close, `document.body` scroll locked while
  open, `role="dialog" aria-modal="true"`, safe-area bottom padding. `SlipPanel` (the shared
  contents) used by both containers.

- [ ] **Step 1: Failing structural test** — `sheet.tsx` contains `role="dialog"`,
      `aria-modal="true"`, and an `overflow` lock on `document.body`; `bet-slip.tsx` no longer
      contains the string `bottom-[calc(41px` (the magic-number coupling dies here).
- [ ] **Step 2: `Sheet`** — complete implementation: portal to `document.body`; scrim
      `fixed inset-0 z-40 bg-surface-sunken/60`; panel `fixed inset-x-0 bottom-0 z-50 rounded-t-card border-t border-line bg-surface-raised pb-[env(safe-area-inset-bottom)]`;
      `useEffect` for ESC listener + scroll lock + focus (store `document.activeElement`, focus
      the panel, restore on cleanup). No animation yet — motion is Task 15.
- [ ] **Step 3: Split `SlipPanel` out of `bet-slip.tsx`.** The collapsed bar stays a sticky bar
      above the tab bar (`bottom-[calc(41px+env(safe-area-inset-bottom))]` at `<lg`,
      `lg:bottom-0` once the tab bar is hidden); "Show" opens the `Sheet` containing
      `SlipPanel`. Panel additions, both containers:
      - each leg row shows its price: `<Price american={leg.priceAmerican} />` after the line;
      - a summary row before the stake input: combined price and
        `To return <Money cents={payout} …/>`, computed
        `payoutCents(stakeCents, combine(legs.map(l => americanToRational(l.priceAmerican))))`
        — bigint in, bigint out, rendered only through `Money`;
      - on place: success → `toast({ tone: 'positive', title: 'Bet placed', description: <the describeBet line> })`,
        clear slip, close sheet; failure → `toast({ tone: 'negative', title: <the error's human line> })`
        and the existing inline field marking stays.
- [ ] **Step 4: The rail.** `slip-rail.tsx` renders `SlipPanel` inside
      `<aside className="hidden lg:block sticky top-16 self-start">`. `/games`'s page wraps
      content in `<div className="lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-6 lg:px-6">`
      with the board left and the rail right. The `<lg` bar/Sheet render `lg:hidden` so exactly
      one slip is interactive per viewport. On non-games screens at `lg+`, the collapsed bar
      keeps rendering (bottom-0) — selections must stay visible everywhere.
- [ ] **Step 5:** `npm run verify`; manual: select → bar → Show → Sheet (ESC closes, scrim
      closes, background does not scroll); place a bet → toast, slip clears; at 1280 the rail
      shows the same selections live. Commit (`feat: bet slip — Sheet, leg prices, payout line, toasts`).

---

### Task 7 [CLOUD]: Feed

**Files:**
- Modify: `src/app/(app)/(column)/feed/feed-card.tsx`
- Modify: `src/app/(app)/(column)/feed/[eventId]/page.tsx`
- Modify: `src/app/(app)/(column)/feed/[eventId]/comment-thread.tsx` (Card `as` adoption)
- Modify: `src/components/ui/card.tsx`

**Interfaces:**
- Consumes: `useToast` for comment/reaction failures; `Card` gains
  `as?: 'div' | 'article' | 'section' | 'li'` (default `'div'`) — the 7b review's escape hatch,
  landing with its first consumers here.

- [ ] **Step 1:** `Card` `as` prop (render `const Tag = as`), no visual change; adopt it in
      `feed-card.tsx` (`as="article"`) and the comment thread's hand-rolled
      `rounded-xl border border-line bg-surface-raised` call sites.
- [ ] **Step 2:** Reaction row: render only reactions with count > 0 as compact chips plus one
      "Add reaction" trigger button that expands the six-emoji row inline (client state local to
      the card). A card with no reactions shows just the trigger — the card returns to content.
- [ ] **Step 3:** Feed detail: add `generateMetadata` (`title: '<actor's headline sentence, truncated 60ch>'` — build from the same payload the card renders); back link
      `← Feed` at the top (`Link href="/feed"`); comment Post failure → toast.
- [ ] **Step 4:** `npm run verify`; manual at 375: cards shorter, reactions still one tap to
      add; detail has title + back. Commit (`feat: feed — reaction trigger, detail title and back link`).

---

### Task 8 [CLOUD]: Standings — Table born

**Files:**
- Create: `src/components/ui/table.tsx`
- Modify: `src/app/(app)/(column)/standings/page.tsx`

**Interfaces:**
- Produces: `Table`, `THead`, `TBody`, `Tr`, `Th`, `Td` — thin token-speaking primitives
  (`Th`: `text-xs font-semibold uppercase tracking-wide text-ink-muted text-left`; numeric
  cells right-align via `align="right"` prop on `Th`/`Td`). Presentation only, no sorting.
  Consumed by Task 11 (ledger) and available to admin queues.
- Consumes: `src/domain/stats.ts` for the record column (settled bets won–lost per member — the
  standings query already loads members; extend it with a settled-bet aggregate, read-only).

- [ ] **Step 1:** `table.tsx` primitives (~40 lines, complete — each a styled passthrough).
- [ ] **Step 2:** Standings page: below `lg`, the existing rank cards unchanged; at `lg`, a
      `hidden lg:block` `Table` with Rank / Member / Record (`12–4`) / Balance, current user's
      `Tr` highlighted (`bg-surface-muted`). Cards get `lg:hidden`. Both render from one data
      load.
- [ ] **Step 3:** `npm run verify`; manual both widths, both boards (cash + credits). Commit
      (`feat: standings — Table at lg with records`).

---

### Task 9 [CLOUD]: Bets and Wagers — legs name their game, Dialog born

**Files:**
- Create: `src/app/(app)/(column)/bets/leg-label.tsx`
- Modify: `src/app/(app)/(column)/bets/page.tsx`
- Modify: `src/app/(app)/(column)/wagers/page.tsx`
- Modify: `src/app/(app)/(column)/wagers/[wagerId]/page.tsx` and its claim form component
- Modify: `src/app/(app)/(column)/wagers/new/wager-form.tsx` (datetime stack — same fix as Task 10)
- Create: `src/components/ui/dialog.tsx`

**Interfaces:**
- Produces: `LegLine({ leg })` rendering a game leg as
  `ECU @ ALA · Spread · ECU +27.5` with kickoff via `formatKickoff`, and a custom leg as
  `<event title> · <outcome>`; `ConfirmDialog({ open, onClose, onConfirm, title, body, confirmLabel, tone })`
  over native `<dialog>` (`showModal()`, ESC free, scrim click closes, focus restores to the
  invoker, `danger` tone maps to the negative Button variant).
- Consumes: Tasks 2 (dates), 3 (toast).

- [ ] **Step 1: The leg query learns its teams.** In `bets/page.tsx`, extend the existing
      `legRows` select with left joins **through** `events` (the join is already there):
      `games` on `games.eventId = markets.eventId`, then `teams` twice (home/away) — six new
      nullable fields (`homeAbbr`, `awayAbbr`, `startsAt`, plus `side`), null for CUSTOM legs.
      Read-only page query; no server module changes.
- [ ] **Step 2: `LegLine`** renders both kinds; side resolves against the abbreviations
      (`side === 'HOME' ? homeAbbr : side === 'AWAY' ? awayAbbr : side` — OVER/UNDER render as
      `O`/`U` + line, matching the board). Adopt in the bet card. **One chip per card:** the
      bet-level `StatusBadge` stays; leg-level badges render only when the bet is settled AND
      legs diverge (`new Set(legs.map(l => l.status)).size > 1`).
- [ ] **Step 3: Merge the two segmented controls into one row** (`flex gap-2`): Bets|Wagers and
      Cash|Credits side by side; same on `/wagers`.
- [ ] **Step 4: One section per wager.** In `wagers/page.tsx`, a wager renders in exactly one
      section, first match wins: needs-your-verdict → AWAITING YOUR CALL; open offer → OPEN TO
      THE SEASON (or INVITES if directed at you); else LIVE / SETTLED. Encode as a single
      `sectionFor(wager)` function with a unit-style test colocated in
      `src/app/__tests__/wager-sections.test.ts` covering the double-listing case the walk
      found (accepted + claimable → AWAITING YOUR CALL only).
- [ ] **Step 5: `ConfirmDialog`,** first used by "Propose calling it off" (confirm before the
      action fires; success/failure → toast). Wager detail dates move to `formatDateTime` —
      the `9/10/2026, 11:27:03 AM` string dies here. Detail gains `generateMetadata` (wager
      description, truncated) and a `← Wagers` back link.
- [ ] **Step 6:** `npm run verify`; manual: a game bet finally says which game; wager appears
      once; call-it-off confirms then toasts. Commit
      (`feat: bets and wagers — legs name their game, ConfirmDialog, one section per wager`).

---

### Task 10 [CLOUD]: Events

**Files:**
- Modify: `src/app/(app)/(column)/events/new/event-form.tsx` — the two `datetime-local` fields
  stack full-width (`flex flex-col gap-4`, no two-up row); "Book: —" line deleted from the
  market editor
- Modify: `src/app/(app)/(column)/events/[eventId]/page.tsx` — `generateMetadata` (event
  title), `← Events` back link
- Modify: `src/app/(app)/(column)/events/page.tsx`, `[eventId]/market-card.tsx`,
  `dispute-form.tsx` — Card `as` adoption for the audit's hand-rolled call sites; form results
  → toast

- [ ] Steps: stack the datetimes (also confirm `/wagers/new` got the same in Task 9), drop the
      book line, metadata + back link, toasts on create/dispute/resolve results,
      `npm run verify`, manual at 375 (placeholders no longer truncate), commit
      (`feat: events — stacked datetimes, titles, toasts`).

---

### Task 11 [CLOUD]: Me

**Files:**
- Modify: `src/app/(app)/(column)/me/page.tsx`

**Interfaces:**
- Consumes: `Table` (Task 8), `formatDateTime` (Task 2).

- [ ] **Step 1: English ledger labels.** One map from `ledger_entry_type` to copy, in the page:
      `P2P_ESCROW` → `Wager stake held`, `P2P_RELEASE` → `Wager paid out`, refunds → `Stake
      returned`, etc. — cover every value of the enum (`grep ledgerEntryType src/db/schema/money.ts`
      for the full list; the test below pins it). Rows with a `note` keep showing it as the
      second line. A raw enum reaching the screen is a bug: add
      `src/app/__tests__/ledger-labels.test.ts` asserting the page's map covers every enum
      value (import both, compare key sets).
- [ ] **Step 2: Settings list.** "Feed filters" and "Email" become a stacked list of link rows
      (label + one-line description + chevron `›`), leaving room for 7d's Appearance rows.
- [ ] **Step 3: Ledger `Table` at `lg`** (Date / Entry / Amount / Balance), cards below —
      same dual-render pattern as standings. Dates via `formatDateTime`.
- [ ] **Step 4:** `npm run verify`; manual: no enum strings anywhere on `/me`. Commit
      (`feat: me — ledger speaks English, settings list, table at lg`).

---

### Task 12 [CLOUD]: Admin joins the shell (D78)

**Files:**
- Move: `src/app/admin/*` → `src/app/(app)/(column)/admin/*` (`git mv`; URLs unchanged)
- Modify: the moved `admin/layout.tsx` (or create one) — `requireAdmin()` stays exactly as it
  gates today; the bare `<main>`/"Back to app" chrome is deleted (the shell provides chrome)
- Modify: moved pages — the run-together "Event queue / Back to admin" header becomes a plain
  `<h1>` (back link now redundant: the shell nav is present); `w-full` on the two containers
  the audit flagged; approve/adjust results → toast

- [ ] **Step 1:** Move, fix imports, `npm run build` green. **Check the structural tests:**
      `grep -rn "app/admin" src/app/__tests__ src/server` and update path literals; the
      `requireAdmin` assertions must still pass unweakened.
- [ ] **Step 2:** Delete the bare chrome; fix the two flagged containers; verify the admin
      link renders in header/tab nav for admins only (it already does in the header today —
      keep that logic where it is).
- [ ] **Step 3:** `npm run verify`; manual at 375: admin has the header and tab bar, no
      run-together heading. Commit (`feat: admin joins the app shell (D78)`).

---

### Task 13 [CLOUD, LOCAL fallback]: The 7c audit and docs

**Files:**
- Create: `docs/screen-rebuild-audit.md`
- Modify: `docs/roadmap.md` (7c rows → complete, with inherited-table dispositions),
  `docs/README.md` (plan/spec links)

- [ ] **Step 1: Real slate.** ESPN sync per "Before you start". If `site.api.espn.com` is
      unreachable from the session, this task is **[LOCAL]** — say so and stop; do not audit the
      board against 20 fixture games and call the density criterion met.
- [ ] **Step 2: The pass.** Every route × both themes × 375×812 and 1280×800, the 7b audit's
      protocol (CDP `Emulation.setEmulatedMedia` for dark). Plus, specifically: the board on a
      ≥60-game day (scroll length, sticky headers, collapse); the six accents spot-checked on
      selected-cell / primary-button / active-nav in both themes — measured contrast ≥4.5:1 for
      ink-on-accent, and a check that no selected control reads as a won/lost/caution state
      next to a settled leg.
- [ ] **Step 3:** Findings fixed or classified exactly as the 7b audit did (fixed here / 7d /
      deliberate). Write the document; update the roadmap: every 7c inherited-backlog row gets
      its disposition line.
- [ ] **Step 4:** `npm run verify && npm run build`; commit
      (`docs: the 7c screen-rebuild audit`). **7c is shippable here.** Open the PR for the 7c
      branch before starting 7d.

---

### Task 14 [CLOUD]: The component harness (D79) — first 7d task

**Files:**
- Modify: `package.json` (dev deps: `jsdom`, `@testing-library/react`,
  `@testing-library/user-event`), `vitest.config.ts`
- Create: `src/components/ui/__tests__/dialog.test.tsx`, `sheet.test.tsx`, `toast.test.tsx`

**Interfaces:**
- Produces: a `projects` split in `vitest.config.ts` — the existing node project untouched
  (`src/**/__tests__/**/*.test.ts`, `environment: 'node'`, `fileParallelism: false`, existing
  setup), plus a `ui` project (`src/components/ui/__tests__/**/*.test.tsx`,
  `environment: 'jsdom'`). `npm test` runs both.

- [ ] **Step 1:** Config split; `npm test` still passes 109 node files before any `.tsx` test
      exists.
- [ ] **Step 2: The tests — scope is exactly D79's list, nothing more.**
      Dialog: opens via `showModal`, ESC closes, focus returns to the invoker, confirm fires
      `onConfirm` once. Sheet: scrim click and ESC call `onClose`, body scroll locked while
      open and restored after, focus moves in and restores. Toast: `toast()` renders in a
      `role="status"` region, auto-dismisses after 5s (`vi.useFakeTimers`), hover pauses,
      queue caps at 3. Write each test first, watch it fail only if it exposes a real gap —
      these components exist; a failure here is a 7c bug to fix in this task.
- [ ] **Step 3:** `npm run verify`; commit (`test: jsdom harness for Dialog, Sheet, Toast (D79)`).

---

### Task 15 [CLOUD]: Motion

**Files:** `sheet.tsx`, `dialog.tsx`, `toast.tsx`, `odds-cell.tsx`, `globals.css`

- [ ] Sheet slides up / Dialog and Toast fade-and-rise on enter, reverse on exit (CSS
      transitions + a `data-state` attribute flip; exit via a ~150ms close delay). Odds cell:
      a ~120ms background transition on select. Every animation inside
      `@media (prefers-reduced-motion: no-preference)` — with reduce set, state changes are
      instant and the Task 14 tests still pass unmodified (they assert end states, not
      transitions). `npm run verify`; commit (`feat: motion behind prefers-reduced-motion`).

---

### Task 16 [CLOUD]: Skeletons

**Files:** the `loading.tsx` of `games`, `feed`, `bets`, `standings`, `admin`; a shared
`src/components/ui/skeleton.tsx` (`bg-surface-skeleton animate-pulse rounded-control` blocks).

- [ ] Each skeleton mirrors its rebuilt screen's real shape (board: chip row + section header +
      ~10 two-line rows; feed: 4 cards; etc. — draw from the shipped markup, that is why this
      waited for 7d). Wrap `animate-pulse` usage behind reduced-motion. The generic
      `LoadingScreen` remains only where no screen shape exists. `npm run verify`; commit
      (`feat: skeleton loaders matched to their screens`).

---

### Task 17 [CLOUD]: The dark-mode toggle

**Files:**
- Create: `src/app/(app)/(column)/me/appearance-form.tsx` (client), an action in
  `src/app/(app)/(column)/me/actions.ts`
- Modify: `src/app/layout.tsx` (read the cookie, stamp `data-theme`), `me/page.tsx`
  (Appearance row)

- [ ] Three-state control (System / Light / Dark) on `/me`; a `theme` cookie
      (`httpOnly: false` not needed — set via server action, one year); root layout reads
      `cookies()` and stamps `data-theme` only for explicit choices — System stamps nothing,
      exactly what 7b's selectors expect. Structural test: root layout references the cookie
      and conditionally sets `data-theme`. `npm run verify`; manual: all three states × both OS
      schemes. Commit (`feat: dark-mode toggle — cookie plus data-theme`).

---

### Task 18 [CLOUD, then LOCAL]: The accent picker

**DB.** Requires Postgres.

**Files:**
- Modify: `src/db/schema/identity.ts` — `accent` pg enum
  (`GREEN|BLUE|INDIGO|VIOLET|TEAL|ORANGE`), column on `users`, `notNull().default('GREEN')`
- Generated: `drizzle/00NN_*.sql`
- Modify: `src/app/layout.tsx` — stamp `data-accent` from the signed-in user's row (lowercased;
  no attribute for signed-out pages: they get the green default)
- Modify: `appearance-form.tsx` / `actions.ts` — six swatch radio group, saves the column
- Test: `src/db/__tests__/accent-schema.test.ts` (defaults to GREEN), plus the action's test

- [ ] Schema + migration (`npm run db:generate`, migrate test DB); failing test first (column
      not exported), then green. Layout reads the user row it already loads for the session —
      add no extra query if one exists; otherwise one narrow select. Picker renders the six
      swatches from one exported list (reuse the Task 1 names). `npm run verify`; manual: pick
      violet → whole app re-renders violet, new device shows violet too. Commit
      (`feat: per-account accent (D75)`).
- [ ] **[LOCAL] Production migration** once merged:
      `ENV_FILE=.env.production npm run db:migrate` — idempotent, one transaction.

---

### Task 19 [CLOUD]: The a11y pass

- [ ] Keyboard: tab order down the board (cell → cell across a row, row → row), into the slip,
      through Sheet/Dialog (Task 14's traps already tested), to place. Labels: every icon-only
      control (`aria-label` on reaction chips, dismiss buttons, collapse summaries get their
      count in text already). SR: `OddsCell` gains an `aria-label` naming team/market/line/price
      in full ("ECU spread plus 27.5 at minus 102"). Contrast: re-measure the token pairs the
      7b audit measured, now under all six accents. Fix everything found; record the pass in
      `docs/screen-rebuild-audit.md`. Commit (`feat: keyboard, labels, and SR pass`).

---

### Task 20 [CLOUD]: Copy pass

- [ ] Every `EmptyState` and error boundary on the rebuilt screens gets copy a person wrote —
      concrete next action, no floating orphan text (the walk's "Nobody is waiting"
      centered-in-void state gets a designed layout: heading, one line, one action). Toast
      titles reviewed as a set for one voice. Commit (`feat: empty states and errors read like a person wrote them`).

---

### Task 21 [CLOUD + LOCAL + MANUAL]: The 7d audit and close-out

- [ ] **[CLOUD]** The Task 13 protocol re-run on the final tree, plus a keyboard-only walk of
      select → slip → place → toast, and a VoiceOver/NVDA transcript of the same path if the
      session can produce one (else mark that row `[MANUAL]`). Append to
      `docs/screen-rebuild-audit.md`. Roadmap: 7d rows dispositioned; `docs/README.md` links.
- [ ] **[LOCAL]** Task 18's production migration, if not yet run.
- [ ] **[MANUAL]** Noah, on a real phone against the live Saturday slate: scroll the board,
      place a bet, feel the sheet and the toasts; pick an accent and confirm it follows to a
      second device. File anything that grates — it does not block the merge.

---

## What a cloud session can and cannot prove

Measured 2026-09-05 in the session that wrote this plan, not assumed.

| Step | Provable in a cloud session |
| ---- | --------------------------- |
| Tasks 1–3 — tokens, dates, toast structure | ✅ Yes — CSS/source assertions and pure unit tests |
| Tasks 4–12 — builds, structural tests, full suite | ✅ Yes. Baseline measured: 109 files / 1121 tests, exit 0, 56s |
| Task 18's migration | ✅ Against the local test database |
| Real-slate rendering (board density, Task 13/21 audits) | ⚠️ Only if `site.api.espn.com` is reachable from the session — this plan's own session pulled 179 games through the phase-5 local path, so it is likely but must be re-verified; otherwise the audit rows are **[LOCAL]** |
| The 4.5:1 accent contrast measurements | ✅ Computed styles in the audit's Chromium |
| Task 18's **production** migration | ❌ **[LOCAL]** — production connection string |
| The phone-in-hand pass, accent-follows-device check | ❌ **[MANUAL]** — Task 21 |

**If a session's hook cannot start Postgres**, mark every **DB** task written-but-not-run and
say so. Never report a DB test as passing on the strength of having written it.

---

## Dependency order

```
7c:  1 (tokens) ──┐
     2 (dates) ───┤
     3 (toast) ───┼── 5 (board) ── 6 (slip: Sheet, rail)
     4 (shell) ───┘        │
                           ├── 7 (feed)                  ─┐
                           ├── 8 (standings: Table)       │ independent of
                           ├── 9 (bets/wagers: Dialog)    │ one another —
                           ├── 10 (events)                │ run in parallel
                           ├── 11 (me)      [needs 8]     │
                           └── 12 (admin)   [needs 4]    ─┘
     13 (7c audit + docs)  [needs 5–12]     ← 7c ships here

7d:  14 (harness)          [needs 6, 9]
     15 (motion)           [needs 14 — its tests guard the refactor]
     16 (skeletons) ─┐
     17 (dark toggle)│  independent of one another and of 15 — parallel
     18 (accent)     │  [18 is the only DB task]
     20 (copy)      ─┘
     19 (a11y)             [needs 15, 16]
     21 (7d audit + close) [needs all of 14–20]
```

**Parallel dispatch guidance (for `dispatching-parallel-agents`):** Tasks 1–4 are mutually
independent — four agents. Then 5→6 is a chain while 7, 8, 9, 10 fan out (agents for 11 and 12
start when 8 and 4 land). In 7d: 16, 17, 18, 20 fan out after 14. The file-collision surface to
watch: Tasks 4 and 12 both move route directories (4 first, always); Tasks 6 and 5 both edit
`games/page.tsx` (5 first, always); Tasks 17 and 18 both edit `appearance-form.tsx` and
`src/app/layout.tsx` (17 first, or one agent takes both).

---

## Self-review

**Spec coverage.** Success criteria → tasks: 1→5–12 (order/shippable), 2→5, 3→4+6, 4→6/3/9/8,
5→3 + each form task, 6→1, 7→9, 8→2+9/10/11, 9→7/9/10 (metadata+back), 10→12, 11→every screen
task's constraint, 12→every task's gate; 13→15, 14→16, 15→19+14, 16→17, 17→18, 18→20, 19→14.
The spec's deferred table stays deferred — no task builds virtualization, logos, or identity
colours.

**Placeholder scan.** Screen tasks intentionally bind structure/behaviour/tests and leave final
classes to the canvas — declared as a Global Constraint, not an omission. No TBDs; every step
names its files, assertions, or exact edits.

**Type consistency.** `useToast().toast({ tone, title, description? })` is the one toast call
shape (Tasks 3, 6, 7, 9, 10, 12). `Sheet({ open, onClose, label })`, `ConfirmDialog({ open,
onClose, onConfirm, title, body, confirmLabel, tone })`, `LegLine({ leg })`, `NAV_ITEMS`,
`formatDayHeading`/`formatKickoff`/`formatDateTime(d, now?)` are used with those exact names in
every consuming task. Accent enum values are uppercase in the DB (Task 18) and lowercased into
`data-accent` to match Task 1's selectors — stated in both tasks.
