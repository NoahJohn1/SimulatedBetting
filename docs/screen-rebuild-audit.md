# Screen rebuild audit — 7c

**Date:** 2026-09-05 (7c pass; the 7d pass appends below when that rung lands)
**Protocol:** the [design-system audit](design-system-audit.md)'s pass, applied to the rebuilt
screens: every route × both themes × 375×812 and 1280×800, against the real local ESPN slate
(179 games / 330 markets synced the day of the audit), signed in as the `@test.local` fixture
admin via a locally-forged Auth.js JWT. Dark mode forced via the browser's
`prefers-color-scheme` emulation — the shipped media query, not edited CSS. Plus the two 7c
additions: the board audited on a ≥60-game day, and the six accents spot-checked on the
selected-cell / primary-button / active-nav trio in both themes.

## Route matrix

All 24 reachable routes were rendered signed-in in both themes at both viewports. Every route
returned 200 with **zero error boundaries** and **zero horizontal overflow** at 375px. Detail
routes carry per-entity titles and back links:

| Route                            | Title                      | Back link   | Notes                                            |
| -------------------------------- | -------------------------- | ----------- | ------------------------------------------------ |
| `/games` (+ `?league=`, `?day=`) | Games                      | —           | Board findings below                             |
| `/feed`, `/feed/[eventId]`       | Feed / actor's headline    | ← Feed      |                                                  |
| `/standings`                     | Standings                  | —           | Table at lg, cards below, current-user highlight |
| `/bets`                          | My Bets                    | —           | Legs name their game; one chip per card          |
| `/wagers`, `/wagers/[wagerId]`   | Wagers / wager description | ← Wagers    | One section per wager                            |
| `/events`, `/events/[eventId]`   | Events / event title       | ← Events    |                                                  |
| `/me`, `/me/notifications`       | Me / Email                 | —           | Ledger in English; settings list                 |
| `/members/[membershipId]`        | member's name              | ← Standings | Fixed during this audit (below)                  |
| `/admin`, `/admin/*`             | Admin / Health / Seasons   | —           | Inside the shell (D78); plain `<h1>`s            |
| `/rules`, status screens         | House rules                | —           | Unchanged by this phase                          |

Form routes (`/events/new`, `/wagers/new`, `/events/[id]/resolve`, `/me/feed-preferences`,
`/admin/events`, `/admin/wagers`) still render the bare "SimulatedBetting" title. Criterion 9
binds detail routes only; these are classified **7d/copy-adjacent follow-up**, not 7c gaps.

## The board on a real Saturday (D77 / D8's stress case)

Audited on `?day=2026-09-12` — **80 games**, the largest day in the synced slate.

- **Page height 9,684px** (was ~34,000px for 179 games in one column; a same-sized day under
  the old card design measures ~15,200px at ~190px/card). A two-line game row lands at
  ~121px/game including section chrome. The spec's "roughly 5,000px" estimate undercounted by
  2× — it priced a _row_ (64px) where a game renders _two_ rows. The density goal is still met:
  ~4× fewer pixels per game, one column-header row per section instead of 180, and the URL
  carries the view.
- Sticky day header verified (`position: sticky` on the `<summary>`, correct offset under the
  app header); the SPREAD/MONEY/TOTAL header renders once per open section.
- Unfiltered, today's section is open and the eleven later days render collapsed with counts.
- League and day chips are server-rendered links; `?league=NFL` narrows; back works.
- Suspended markets render their price disabled and dimmed; the dashed "—" cell appears only
  for missing selections — the two pre-rebuild cases, carried over per the spec's "unchanged".

## The hot path, end to end

Walked at 375×812 dark and light: tap a spread cell → cell fills `--accent` → collapsed bar
shows "1 selection" → Show opens the `Sheet` (`role="dialog"`, `aria-modal`, body scroll
locked, focus moves in; ESC and scrim both dismiss with focus restored) → leg row shows its
price, summary shows combined price and "To return" → Place bet → positive toast announces in
the `role="status"` region → slip clears, sheet closes. At 1280×800 the same selection appears
live in the sticky rail beside the board, and placing from the rail behaves identically.

## Accent spot-check (D75)

All six hues measured on the real `--accent`/`--accent-ink` computed pairs (canvas pixel
readback, WCAG 2.1 ratio), which the selected cell, primary button, and active nav all consume:

| Accent          | Light ratio | Dark ratio |
| --------------- | ----------- | ---------- |
| Green (default) | 4.95        | 8.40       |
| Blue            | 5.25        | 5.55       |
| Indigo          | 6.46        | 5.12       |
| Violet          | 5.89        | 5.34       |
| Teal            | 5.36        | 7.77       |
| Orange          | 5.22        | 6.58       |

**All twelve pairs ≥ 4.5:1.** Outcome-colour separation holds: light green-700 `rgb(0 130 54)`
vs emerald positive `rgb(0 153 102)` (darker, yellower), light orange-700 `rgb(202 53 0)` vs
amber caution `rgb(225 113 0)` (redder, deeper). In dark, green-400 `rgb(5 223 114)` sits
nearer emerald-400 `rgb(0 212 146)` than in light, but a selected cell (solid accent fill,
accent ink) and a settled badge (tinted `--positive-surface` behind `--positive-on-surface`
text) are different constructions and do not read as each other. The violet remap was applied
live (`data-accent="violet"`) and recoloured exactly the active-control trio; everything else
stayed monochrome.

## Findings

### Fixed during 7c (before this audit's write-up)

1. **`/games` crashed at runtime** — `MARKET_ORDER`/`MARKET_LABEL` lived in the `'use client'`
   odds-cell module and arrived in the server components as client-reference proxies. Invisible
   to typecheck and the whole suite; caught only by rendering. Fixed by `market-meta.ts`
   (commit d7312da) with a structural assertion pinning the module directive-free.
2. **Hydration failure on every full page load** — the toast portal's `typeof document` render
   guard differed between the server pass and hydration. Fixed with a `useSyncExternalStore`
   mounted gate (ee2bf74).
3. Reaction chips rendered in unspecified DB order; canonical `REACTION_EMOJI` order restored
   (23d960e).
4. `LegLine` hand-rolled `Line`'s sign convention; now composes `<Line>` (7e04bd1).
5. Moneyline slip rows showed the price twice (persisted label bakes it in); render-side strip
   (f1f2eb6).
6. Server-rejected placements stopped marking the slip inline; restored alongside the toast
   (e161ece).

### Fixed in this audit's commit

7. **The feed still spoke the old date vocabulary** — "closes Wed 11:25am" on event-opened
   cards came from a private `formatDeadline` helper no task's brief covered. Spec criterion 8
   demands one vocabulary; the card now uses `formatDateTime`.
8. **`/members/[membershipId]` had no title and no back link** — the one detail route criterion
   9 missed, because it wasn't on any screen task's file list. `generateMetadata` (member's
   name) and `← Standings` added.

### Classified — 7d owns them

- Floating empty states on admin and elsewhere ("Nobody is waiting" centered in void) — Task 20.
- The neutral "Loading admin" flash and all other `LoadingScreen` uses — Task 16 skeletons.
- Sheet/Dialog/Toast enter/exit motion — Task 15. Keyboard paths, SR labels, focus-order
  audit — Task 19. Component behaviour tests — Task 14.
- Form-route `<title>`s (list above).

### Classified — deliberate, or recorded debt

- **A marketless game renders six dashed cells** (a real Sep 12 game had no markets in the
  feed). Real-slate behaviour the spec didn't predict; harmless but pure noise on the board.
  Candidate for a "lines pending" row treatment in 7d's copy pass.
- **The spec's ~5,000px board estimate was per-row arithmetic** — measured ~9.7k for 80 games
  (~121px/game). Density criterion still met; the number is recorded so nobody chases it.
- `bar-offset.ts` centralizes the tab-bar height constant but cannot enforce the coupling to
  `TabBar`'s rendered height (Tailwind's static class scanning precludes deriving the class
  from the constant). Disclosed debt.
- `generateMetadata` + page each load detail data twice on feed/event/wager/member detail
  (uncached double read, pre-existing pattern). Wrap the loaders in React `cache()` some rung.
- Radius vocabulary: 43 raw `rounded-xl/lg/full` vs 13 vocabulary uses (was 45 vs 10). The
  rebuilt structural surfaces speak the vocabulary; absorption continues per-screen as 7d
  touches them. Hand-rolled card markup is down from 11 files to 5
  (`bets/page.tsx`, `comment-thread.tsx` textarea, `preferences-form.tsx`,
  `notification-form.tsx`, `events/[eventId]/page.tsx` Resolution section).
- `money.tsx:35` and `odds-cell.tsx:36` carry stale doc comments naming the deleted
  `game-card.tsx`.

## Verdict

Every 7c success criterion is met on the real slate: the board handles an 80-game day without
blind scrolling, the desktop shape exists (D74), the four components are born at real call
sites, all action results announce through the toast layer, legs name their games, one date
vocabulary, per-entity titles with back links, admin inside the shell, both themes hold at both
viewports, and all twelve accent pairs measure ≥ 4.5:1. **7c is shippable.**
