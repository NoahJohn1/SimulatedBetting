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

### Fixed by the final whole-branch review

9. **The events screens still hand-rolled dates** — `/events`'s board inlined `toLocaleString`
   for "Closes …" with no ET suffix, and `/events/[eventId]` kept a private `when()` helper.
   Spec criterion 8 is blanket, not per-task; both now call `formatDateTime`, and `when()` is
   gone.
10. **Wager accept/decline/cancel-offer/claim results bypassed the toast layer** — only the
    propose-cancel path on `/wagers/[wagerId]` announced through `useToast()`; the other four
    outcomes were inline-only (`setError` on failure, a silent `router.refresh()` on success).
    Spec criterion 5 / D76 apply to every submitted action, so `run()` now toasts both outcomes
    too, alongside the inline field marking it already kept.

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

---

# The a11y pass — 7d Task 19

**Date:** 2026-09-05. No live browser in this session, so contrast is measured programmatically
(a throwaway Node script parsing `globals.css`'s `oklch()` stops, not committed) rather than by
the 7b/7c audits' canvas pixel-readback method; the two agree to within 0.01–0.02 on every pair
they share (e.g. green light: 4.94 here vs 4.95 in the 7c canvas reading).

## Keyboard: tab order down the board, into the slip, through Sheet/Dialog

Read (not modified): `game-row.tsx`, `day-section.tsx`, `odds-cell.tsx`, `bet-slip.tsx`,
`slip-panel.tsx`, `slip-rail.tsx`, `sheet.tsx`, `dialog.tsx`, `(app)/layout.tsx`,
`(app)/games/page.tsx`.

- **The board.** `GameRow` is a plain grid whose only focusable children are the six `OddsCell`
  buttons, in source order: away line's three cells left-to-right, then home line's three —
  exactly "cell → cell across a row, row → row." Kickoff time and team abbreviation are
  non-interactive `<span>`s, so they are correctly skipped. `DaySection` is a native
  `<details>/<summary>`; the `<summary>` is a real tab stop and Enter/Space toggles it via
  platform behaviour, no script needed.
- **Into the slip.** `/games`'s two-pane grid (`page.tsx`) renders the board `<div>` then the
  `<aside>` rail in that DOM order, so Tab reaches `SlipRail`'s `SlipPanel` immediately after
  the last board row — not after the tab bar — at `lg+`. Below `lg`, the rail is `hidden`
  (removed from the tab order by `display: none`) and `BetSlip`'s collapsed bar's "Show" button
  is the next stop after the board instead. Verified by reading `layout.tsx`'s render order
  (header → `main` → `BetSlip` → `TabBar`) and `slip-rail.tsx`/`bet-slip.tsx`'s `hidden`/
  `lg:hidden` pair, which never both resolve to visible at once.
- **Through Sheet/Dialog.** Both already carry the behaviour Task 14 wrote jsdom tests for —
  this task did not touch either component's trap logic, only re-ran the suite:
  `npx vitest run src/components/ui/__tests__` → **3 files / 12 tests passed**, unchanged from
  Task 14 (scrim click, Escape, body-scroll lock/restore, and focus-in/focus-restore for
  `Sheet`; `showModal`, Escape, focus-restore, and single-fire `onConfirm` for `ConfirmDialog`).
- **Recorded, not fixed:** `Sheet` is a hand-rolled `<div>` (D79's own comment explains the
  trade — pinned bottom placement over `<dialog>`'s free top-layer trap), and it does not
  implement a Tab-cycling containment loop the way `<dialog>`'s native `showModal()` does for
  `ConfirmDialog`. Tabbing forward past the last element inside an open `Sheet` (or
  Shift+Tab-ing backward past the first) can reach elements outside the panel that the scrim
  only covers visually. This task's brief is explicit — "Task 14's focus traps are already
  tested — verify they still work, don't re-implement" — so this is disclosed debt, not a Task
  19 fix; the tests above confirm everything Task 14 actually wrote a test for still passes.

## Labels: icon-only controls

Swept with `grep -rn "aria-label" src/app src/components` against every `<button>` in
`src/app` and `src/components` (`grep -rn "<button"`, ~50 call sites). Nearly all already carry
a visible text label (Approve/Deny, Take it/Decline/Withdraw, Save/Cancel/Edit, Post, Delete,
Load more, Remove market/outcome, the theme and accent radios, Dismiss) or an existing
`aria-label` (`Remove ${leg.label}` in the slip, the accent swatches, the segmented controls'
`<nav aria-label>`, the toast's `Dismiss`, an outcome's `Remove outcome N`). Day-section
`<summary>`s already show their game count in visible text per the task brief, so none needed
an additional label.

Two real gaps, both fixed in this commit:

1. **The feed's reaction chips** (`reaction-picker.tsx`, both the collapsed row and the
   expanded six-emoji picker) had only an emoji glyph and a count as their accessible name —
   platform emoji-name announcements are inconsistent (VoiceOver vs NVDA read the same emoji
   differently) and say nothing about the count or whether it's yours. Added
   `REACTION_LABEL`/`reactionLabel()` (`src/server/feed/reaction-emoji.ts`) — one fixed English
   word per emoji (Fire, Laughing, Skull, Handshake, Bullseye, Clown) — and an `aria-label` on
   each chip: `"Fire reaction, 3, yours"` / `"React Fire"`.
2. **`OddsCell`'s missing-selection placeholder** (the dashed "—" `<div>`) had no accessible
   name at all — a screen reader either skips a non-interactive div with only a dash glyph or
   reads it ambiguously. Gave it `aria-label="{team}: no line yet"`.

## SR: `OddsCell`'s full descriptive label

`odds-cell.tsx` already had every field the label needs as props: `teamLabel` (abbreviation,
matching this task's own example), `market.type`, `selection.line`, `selection.priceAmerican`.
Added `cellAriaLabel()`, spelling signs as words rather than symbols (a bare `+`/`-` is not
reliably announced):

- Spread: `"ECU spread plus 27.5 at minus 102"`
- Moneyline (no line): `"ALA moneyline at minus 150"`
- Total (no team side of its own — `cellsFor` renders OVER on the away row and UNDER on the
  home row purely for grid layout, so naming the row's team would be a lie):
  `"Over 47.5 at minus 110"`

Also added `aria-pressed={active}` — the cell is a toggle button, and this was the only toggle
button on the board without one (`ReactionPicker`'s chips already had it).

## Contrast: all six accents, both themes, ink-on-accent

Parsed `--acc-{hue}` / `--acc-{hue}-dark` / `--acc-{hue}-ink-dark` straight out of
`globals.css`, converted each `oklch()` to linear sRGB (Björn Ottosson's OKLab matrices), and
applied the WCAG 2.1 relative-luminance/contrast formula. Light ink is `--n-0` (`#fff`,
luminance 1) for every hue, per Task 1.

| Accent          | Light ratio | Dark ratio | Light accent RGB  | Dark accent RGB    | Dark ink RGB     |
| --------------- | ----------- | ---------- | ----------------- | ------------------ | ---------------- |
| Green (default) | 4.94        | 8.40       | `rgb(0,130,54)`   | `rgb(5,223,114)`   | `rgb(3,46,21)`   |
| Blue            | 5.26        | 5.58       | `rgb(21,93,252)`  | `rgb(81,162,255)`  | `rgb(22,36,86)`  |
| Indigo          | 6.44        | 5.14       | `rgb(79,57,246)`  | `rgb(124,134,255)` | `rgb(30,26,77)`  |
| Violet          | 5.88        | 5.36       | `rgb(127,34,254)` | `rgb(166,132,255)` | `rgb(47,13,104)` |
| Teal            | 5.39        | 7.76       | `rgb(0,120,111)`  | `rgb(0,213,190)`   | `rgb(2,47,46)`   |
| Orange          | 5.23        | 6.58       | `rgb(202,53,0)`   | `rgb(255,137,4)`   | `rgb(68,19,6)`   |

**All twelve pairs clear 4.5:1**, matching the 7c canvas measurement to within rounding. No
accent stop needed to move.

## Hue collision: accents vs won/lost/caution

Computed OKLab Euclidean distance (ΔE) and hue distance between each accent stop and the
same-theme outcome token (`positive`/`negative`/`caution`, light stop vs light stop, dark stop
vs dark stop) — the two constructions that actually sit near each other on screen: a selected
cell or primary button (solid accent fill) and a settled leg's status text or badge (tinted
`*-surface` behind `*-on-surface` text).

The closest pairs, smallest ΔE first:

| Pair                           | Δhue  | ΔE (OKLab) |
| ------------------------------ | ----- | ---------- |
| green dark vs positive dark    | 11.5° | 0.057      |
| teal dark vs positive dark     | 18.7° | 0.060      |
| orange light vs negative light | 11.1° | 0.070      |
| green light vs positive light  | 13.2° | 0.078      |
| teal light vs positive light   | 23.2° | 0.109      |
| orange dark vs caution dark    | 28.5° | 0.120      |
| orange light vs caution light  | 19.9° | 0.131      |

Every other accent/outcome pair sits at ΔE ≥ 0.25 (blue, indigo, violet — all far from the
warm/green outcome hues). None of the seven close pairs above is a same-color collision:

- **Green vs positive** was the 7c audit's own finding, deliberately built this way by Task 1
  ("green must sit visibly darker and yellower than emerald") — a solid green-700/-400 fill
  reads as a different, cooler-toned green than the tinted emerald status text next to it.
- **Teal vs positive (dark)** is the closest new pair this pass found: `rgb(0,213,190)` vs
  `rgb(0,212,146)` — R and G channels are within 1 of each other, only B (190 vs 146, a real
  17% swing) separates them. That reads as turquoise vs spring-green, not as one color, and
  the two never share a construction (fill vs tinted text).
- **Orange vs negative (light)** is the other new pair: `rgb(202,53,0)` vs `rgb(231,0,11)` — a
  burnt orange (G=53 gives it visible orange cast) against a near-pure red (G=0). Distinct at a
  glance, and orange's designed-in separation from _caution_ (Task 1's actual design intent)
  is even wider (ΔE 0.131) than its accidental proximity to _negative_.

No accent stop was moved. Every pair is either the 7c audit's already-reviewed, deliberately
close green/positive relationship, or a comparable-or-larger separation the reasoning above
covers the same way. A future accent hue that lands materially closer than 0.05 ΔE to an
outcome token, or with matching lightness _and_ chroma (not just similar hue), would warrant
revisiting this — this pass found nothing that crosses that line.

## Verdict

Keyboard order, icon-only labels, `OddsCell`'s SR description, and all six accents' contrast
and hue separation are in place. `npm run verify` is clean (see the commit). The one disclosed
gap — `Sheet`'s lack of a Tab-cycling containment loop — is explicitly out of this task's scope
per its own brief and is recorded above rather than silently left out.
