# Screen rebuild audit — 7c

**Date:** 2026-09-05 (7c pass; the 7d pass appends below when that rung lands)
**Protocol:** the [design-system audit](design-system-audit.md)'s pass, applied to the rebuilt
screens: every route × both themes × 375×812 and 1280×800, against the real local ESPN slate
(179 games / 330 markets synced the day of the audit), signed in as the `@test.local` fixture
admin via a locally-forged Auth.js JWT. Dark mode forced via the browser's
`prefers-color-scheme` emulation — the shipped media query, not edited CSS. Plus the two 7c
additions: the board audited on a ≥60-game day, and the six accents spot-checked on the
selected-cell / primary-button / active-nav trio in both themes.

## Inherited backlog: what 7a/7b deferred, and 7c's dispositions

Moved here from `roadmap.md` once 7c fully merged with nothing left owed — the roadmap collapsed
to a single row (matching how 7a and 7b collapsed once they closed out), and this is now the
record of what 7c inherited and what it did with each item. The original description of each
item still lives where it was first raised ([mobile-audit.md](mobile-audit.md),
[design-system-audit.md](design-system-audit.md)); this table is 7c's resolution of it.

| Item                                                                                                                                                                                                                                                                                                                                                   | Deferred by              | Why it landed here                                                                                                                                             | Disposition                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Build `Dialog`, `Sheet`, `Table`, and `Toast`                                                                                                                                                                                                                                                                                                          | 7b                       | No call sites existed; each is built in the commit that first needs one ([D53](decisions.md#d53--the-shared-component-set-is-scoped-to-call-sites-that-exist)) | **Done** — each born in its first call site's commit (D53's rule held)                    |
| Normalize the type scale and spacing on existing screens                                                                                                                                                                                                                                                                                               | 7b                       | 7b's sweep was colour-only so that any visual change was provably a bug; normalizing is intentional drift and belongs with a redesign                          | **Done per rebuilt screen** — the subsets are a plan-wide constraint                      |
| Choose a brand accent colour, if the app wants one                                                                                                                                                                                                                                                                                                     | 7b                       | `--accent` makes it a two-line change; picking a hue before any screen is redesigned is a guess                                                                | **Done differently** — D75: six member-choice hues, green default; picker is 7d Task 18   |
| `generateMetadata` on detail routes, for per-entity titles                                                                                                                                                                                                                                                                                             | 7a                       | Those screens are rebuilt here anyway                                                                                                                          | **Done** — feed, event, wager, member detail (member added by the audit)                  |
| Odds-board density at 375px — the SPREAD/MONEY/TOTAL grid is tight                                                                                                                                                                                                                                                                                     | 7a (mobile audit)        | Needs the screen redesigned, not restyled                                                                                                                      | **Done** — D77 rows; an 80-game day is 9,684px vs ~34,000px for the old full board        |
| `datetime-local` inputs cramped two-up on `/events/new` and `/wagers/new`                                                                                                                                                                                                                                                                              | 7a (mobile audit)        | A layout fix                                                                                                                                                   | **Done** — stacked full-width on `/events/new` and `/wagers/new`                          |
| `/admin/events` header runs together as "Event queueBack to admin"                                                                                                                                                                                                                                                                                     | 7a (mobile audit)        | Page-specific markup                                                                                                                                           | **Done** — plain `<h1>` inside the shell (D78)                                            |
| Controls adopted into `Button` grew 6–8px taller — `Button`'s `md` size is `h-11`; the call sites had been `py-2`, `h-9`, or `h-12`                                                                                                                                                                                                                    | 7b (design-system audit) | The spec declared the radius change, not the height. It is a better tap target, so it is recorded rather than reverted                                         | **Accepted** — the rebuild kept `Button`'s `h-11`; better tap target                      |
| `FormField` restyles labels from `text-sm font-medium` to `text-xs font-medium text-ink-secondary` — smaller and quieter than before                                                                                                                                                                                                                   | 7b (design-system audit) | Cosmetic consequence of adoption, not a bug; changing it back is a design call for the rebuild                                                                 | **Accepted** — kept as the design                                                         |
| `Card` adoption gives `/me`'s ledger rows and `/standings`' rank rows a 1px `border-line` and `rounded-card` (12px), where they had a bare fill and `rounded-lg` (8px)                                                                                                                                                                                 | 7b (design-system audit) | Cosmetic consequence of adoption, not a bug                                                                                                                    | **Accepted** — kept; those rows render as `Table` at `lg` now anyway                      |
| "Create an event" on `/events` lost its 1px border — `Button`'s `primary` variant has none. The old border was the same colour as the fill, so the control is 2px smaller and otherwise unchanged                                                                                                                                                      | 7b (design-system audit) | Consequence of adoption; not reverted since it reads as unchanged                                                                                              | **Accepted** — reads unchanged                                                            |
| No screen has a desktop layout at 1280×800 — outside `/admin*`'s `max-w-2xl`, every list runs edge to edge                                                                                                                                                                                                                                             | 7b (design-system audit) | Existing design, not a 7b regression, but it needs the screen redesigned, not restyled                                                                         | **Done** — D74: header nav + content column + the games slip rail                         |
| The bet slip's dark-mode shadow (`shadow-slip`) is measurable but not perceptible — the shadow colour and `--surface` are both pure black in dark mode                                                                                                                                                                                                 | 7b (design-system audit) | Needs a non-black shadow colour or a `--surface` that isn't pure black to read; both are Task 1 token-layer decisions, outside the audit's remit               | **Done** — Task 1's second shadow layer (1px light top edge)                              |
| `/admin/events` and `/admin/wagers` share `/admin`'s `mx-auto` (no `w-full`) container pattern — didn't overflow with current fixture content, but carries the same latent bug                                                                                                                                                                         | 7b (design-system audit) | Not fixed since it wasn't observed to break; worth the same `w-full` fix if content grows                                                                      | **Done** — `w-full` applied in the D78 move                                               |
| `Card` adoption is unfinished — 11 call sites (`bets/page.tsx`, `events/page.tsx`, `dispute-form.tsx` ×2, `market-card.tsx`, `events/[eventId]/page.tsx`, `comment-thread.tsx` ×2, `feed-card.tsx`, `game-card.tsx`, `preferences-form.tsx`) still hand-write the byte-identical `rounded-xl border border-line bg-surface-raised` that `Card` renders | 7b (final review)        | Seven of the eleven are semantic elements (`<article>`/`<section>`/`<li>`), and `Card` hard-codes `<div>` with no element-type escape hatch                    | **Mostly done** — `as` prop shipped and adopted; 5 hand-rolled sites remain, listed above |
| The radius vocabulary (`rounded-card`/`rounded-control`/`rounded-pill`) is adopted at only 10 uses across `src/`, against 45 raw `rounded-xl`/`rounded-lg`/`rounded-full`                                                                                                                                                                              | 7b (final review)        | The phase's "no radii on existing markup" constraint correctly left this alone, but it isn't tracked anywhere                                                  | **Partially absorbed** — 43 raw / 13 vocab after the rebuild; continues per-screen in 7d  |

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

---

# The 7d audit and close-out — Task 21

**Date:** 2026-09-05. No live browser in this session (same constraint as Task 19), so this
pass is structural: reading the final tree's source and re-running the suite, rather than a
Chromium pass. Baseline confirmed before starting: `git log --oneline -10` shows Tasks 14
(`26b8b9a`) through 20 (`46f2d1f`/`6566756`) all merged to `claude/phase-7d-craft`, and
`npm test` measures **121 files / 1237 tests, exit 0** — matching this task's brief exactly.

## Inherited backlog: what 7a/7b deferred, and 7d's dispositions

Moved here from `roadmap.md`, where the "What 7d inherits" and "7d dispositions" tables lived
during the rung. Every row below is now fully dispositioned — 7d's own remaining follow-ups
(Task 18's production migration, Noah's phone pass) are separate items, not part of this
inherited backlog, and stay listed in `roadmap.md`.

| Item                                                                     | Deferred by       | Why it landed here                                                                                                                                                                                  | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A dark-mode toggle — the control, the cookie, and the persistence        | 7b                | The `[data-theme]` selectors already ship; only the control is missing, and a control is craft                                                                                                      | **Done** — Task 17: a three-state (System/Light/Dark) control, a `theme` cookie the root layout reads, `data-theme` stamped only for the two explicit choices                                                                                                                                                                                                                                                                                     |
| Focus management, keyboard paths, and SR labels on the shared components | 7b                | Tokens carry contrast; behaviour is this rung's subject                                                                                                                                             | **Done, with one disclosed gap found by this close-out** — Task 19's board→slip→Sheet/Dialog trace, `OddsCell`'s full SR label, and the icon-only-control label sweep all landed; Task 21's end-to-end extension of that trace (through placement to the toast) additionally found that a successful bet placement drops keyboard focus to `document.body` on both the Sheet and rail surfaces — recorded as debt below, not fixed in this commit |
| Revisit the component-test harness question                              | 7b                | [D54](decisions.md#d54--a-token-lint-test-is-the-harness-7b-earns-revisiting-d51) found 7b's components too simple to earn one. `Dialog` and `Toast` are the ones that would, and they arrive in 7c | **Done** — Task 14: a jsdom + React Testing Library project alongside the existing node suite, with behavioural tests for `Dialog`, `Sheet`, and `Toast`                                                                                                                                                                                                                                                                                          |
| Skeleton loaders replacing the neutral `LoadingScreen`                   | 7a                | A skeleton that does not match its screen is worse than none, and the screens did not exist yet                                                                                                     | **Done** — Task 16: a skeleton shaped to each of games/feed/bets/standings/admin, `LoadingScreen` kept only where no screen shape exists yet                                                                                                                                                                                                                                                                                                      |
| The admin section renders with no header or tab bar on mobile            | 7a (mobile audit) | A structural decision about whether admin joins the app shell, not a styling one                                                                                                                    | **Done, ahead of 7d** — resolved by 7c's Task 12 (D78, admin joins the app shell) before any 7d task touched admin; listed here only because the original backlog entry predates that fix                                                                                                                                                                                                                                                         |

## Re-running the Task 13 protocol on the final tree

Task 13's live-browser pass (route × theme × viewport, the board on a real slate, the accent
spot-check) cannot be repeated here — same constraint as Task 19, unchanged since. What a
structural pass over Tasks 14–20's diff can actually confirm, read directly out of the source
Task 13 audited:

- **`[data-theme]` selectors.** `globals.css` still carries the exact three-context pattern the
  7c audit verified — a plain `:root:not([data-theme='light'])` media-query copy for OS-dark,
  and a `:root[data-theme='dark']` copy for the explicit choice. Task 17's dark-mode toggle adds
  a fourth _reader_ of this contract (`src/app/layout.tsx`'s `readThemeCookie` stamps
  `data-theme` only for `'light'`/`'dark'`, leaving it entirely absent for System — verified by
  reading the function, which returns `undefined` rather than a third string literal, so React
  drops the attribute) but writes no new selector and does not touch the existing three.
- **The six accents.** `grep -c "data-accent=" src/app/globals.css` returns **18** — exactly
  6 hues × 3 selector contexts (light, media-dark, explicit-dark), unchanged from Task 1's
  original shape and from the 7c/Task-19 audits' counts. Task 18's accent picker
  (`appearance-form.tsx`) is a new _writer_ — it derives its six swatch values from the schema's
  `ACCENT_VALUES` (not a second hand-typed list) and previews each with `var(--acc-{hue})`,
  reading Tier-1 tokens directly only for that static swatch preview, never overriding what
  `--accent` itself resolves to. `src/app/layout.tsx` stamps `data-accent` from the signed-in
  user's row, lowercased, with no attribute (green default) for signed-out pages — exactly D75's
  contract. The dark slip-shadow fix (`--slip-shadow`'s second `rgb(255 255 255 / 0.08)` layer,
  Task 1 Step 4) is untouched in both dark blocks.
- **Responsive breakpoints.** `grep -n "lg:hidden\|hidden lg:\|lg:grid\|lg:flex\|lg:block"`
  across `(app)/layout.tsx`, `tab-bar.tsx`, `games/page.tsx`, and `(column)/layout.tsx` finds
  every breakpoint Task 4/5/6/8/11 built still in place: `TabBar`'s `lg:hidden`, `HeaderNav`'s
  `hidden … lg:flex`, `/games`'s `lg:grid lg:grid-cols-[minmax(0,1fr)_21rem]` two-pane grid
  (twice — the `<lg` and `lg+` render branches share the class), `SlipRail`'s
  `hidden lg:block`. None of Tasks 14–20 touch these files' breakpoint classes; Task 15's motion
  additions to `odds-cell.tsx`/`sheet.tsx`/`toast.tsx` and Task 16's skeletons are new markup
  alongside the existing responsive classes, not replacements for them.
- **The odds-board density approach.** `game-row.tsx`, `day-section.tsx`, and `odds-cell.tsx`
  (D77) are structurally unchanged by 14–20 except for the additions each task's brief names:
  Task 15 added a `transition-colors duration-[var(--motion-fast)]` to `OddsCell` (inert at
  `--motion-fast: 0s` unless `prefers-reduced-motion: no-preference`, confirmed in
  `globals.css`), and Task 19 added `cellAriaLabel`/`aria-pressed`. The two-line row, the sticky
  `<details>/<summary>` day section, and the shared `MARKET_ORDER`/`MARKET_LABEL` header row are
  the same shapes the 7c audit measured at 9,684px for an 80-game day — nothing in 14–20 changes
  row height, grid columns, or the collapse mechanism.
- **The suite as evidence.** `npx vitest run src/app/__tests__/token-layer.test.ts
src/app/__tests__/token-lint.test.ts src/app/__tests__/board-structure.test.ts
src/app/__tests__/sheet-structure.test.ts src/app/__tests__/toast-structure.test.ts` — **5
  files / 380 tests passed.** These are exactly the structural assertions that would fail if
  14–20 had regressed the accent remaps, the raw-colour lint, the board's link-driven filters,
  the Sheet's dialog contract, or the toast's live region — they didn't move.

**What still needs a live browser, and why this is new surface, not a repeat of Task 13's
gap.** Task 13 could not check contrast or rendering in a real Chromium session either, but it
had no dark-mode _control_ and no accent _picker_ to check — 7c's accents were spot-checked via
`data-accent` applied directly in devtools, and dark mode only ever meant OS-level
`prefers-color-scheme`. Tasks 17 and 18 add two real UI controls (`AppearanceForm`'s theme
radiogroup and accent radiogroup) that a member actually clicks, and their combination —
**six accents × two explicit theme states (Light/Dark), not just System** — is surface no
audit in this plan has ever driven through a live browser. The contrast math in Task 19's
programmatic pass covers the color values themselves and does not change based on whether
`data-theme` was set by a media query or by the cookie, so the _numbers_ are not in question;
what is unverified is the actual click-through — does the accent swatch group render legibly
against both `Light` and `Dark` explicit choices, does the radiogroup's own selected-state
styling (which itself consumes `--accent`) ever collide with an accent it's picturing, does
`router.refresh()` visibly repaint the whole page without a flash of the old accent. **This is
the one row of this close-out that a human/browser pass should specifically cover** — not
because anything is suspected broken, but because it is the only combination in the whole plan
that has never been through a real renderer.

## Keyboard walk, end to end: board cell → slip → place → toast

Task 19 traced board → slip → into Sheet/Dialog. This extends that trace through placement and
the toast, reading `slip-panel.tsx`, `bet-slip.tsx`, `slip-rail.tsx`, `sheet.tsx`, and
`toast.tsx` together, and reconciling one place where the trace showed something the file list
alone would not: a focus destination that depends on _which_ state updates land in the same
render.

**Board → slip (unchanged from Task 19, re-confirmed):** `GameRow`'s six `OddsCell` buttons are
the only focusable elements in a row, tab order away-then-home, left-to-right within each; the
board leads into `SlipRail` immediately at `lg+` (both live in `/games/page.tsx`'s
`lg:grid lg:grid-cols-[minmax(0,1fr)_21rem]` two-pane `<div>`, board first, `<aside>` second) or
into `BetSlip`'s collapsed bar's "Show" `<button>` at `<lg` (the rail is `hidden`, out of the tab
order; the bar keeps `lg:hidden` off itself only on `/games`, so it correctly never overlaps the
rail).

**Into the panel:** Activating "Show" (`<lg`) calls `setOpen(true)`; `Sheet`'s open-effect fires
synchronously with the render that mounts it — `restoreFocusRef.current = document.activeElement`
(captures the "Show" button), then `panelRef.current?.focus()` moves focus onto the panel
`<div role="dialog" aria-modal="true" tabIndex={-1}>`. At `lg+` there is no Sheet to enter —
`SlipRail`'s `<aside>` is already in the DOM and its `SlipPanel` is simply the next focusable
region after the board, no focus jump needed. From the panel, Tab reaches, in source order: the
notice's Dismiss button (if a notice is showing), each leg's Remove button, the stake `<input>`,
Clear, then Place bet (`<Button onClick={submit} disabled={pending}>` — `pending` is
`useTransition`'s flag, satisfying D51's every-pending-form-disables-a-control rule; verified by
reading `slip-panel.tsx`'s `submit()`, which wraps the whole placement in
`startTransition`). Tabbing forward past Place bet inside the Sheet (or Shift+Tab back past
Dismiss/the first Remove) is the same non-looping gap Task 19 already disclosed for `Sheet` —
re-confirmed unchanged, not re-litigated here.

**Activating Place bet, and a finding this trace surfaces that Task 19's board-to-slip trace
did not reach:**

Reading `submit()` in `slip-panel.tsx`: on a successful `placeBetAction`, three state updates
fire in the same synchronous continuation (no `await` between them) — `toast({tone: 'positive',
title: 'Bet placed', ...})`, `slip.clear()`, and `onPlaced?.()` (which is `() =>
setOpen(false)` from `bet-slip.tsx`, or `undefined` from `slip-rail.tsx` — the rail passes
nothing to close). Because these land in one batched render:

- `slip.clear()` empties `slip.legs`, so `BetSlip`'s own guard
  (`if (slip.legs.length === 0) return null;`) removes the **entire** collapsed-bar `<div>` —
  including the "Show" button that `Sheet`'s `restoreFocusRef` is holding a reference to — in
  the same commit that unmounts the `Sheet` itself.
- `Sheet`'s open-effect cleanup (`restoreFocusRef.current?.focus()`) still runs on unmount, but
  by the time it fires the referenced button is no longer attached to the document.

I confirmed this empirically rather than by inspection alone: a small throwaway jsdom test in
this session (`@testing-library/react`, the real `Sheet` component, a harness mimicking
`BetSlip`'s "unmount on empty legs" guard around it — not committed, since it exists only to
answer this one question) reproduces `bet-slip.tsx`'s exact shape and shows
`document.activeElement` lands on **`document.body`** after the simulated placement, with the
"Show" button confirmed removed from the document. The same loss happens on the `lg+` rail path
too, and more directly — `SlipRail`'s `SlipPanel` has no `Sheet` and thus no restore attempt at
all, so the "Place bet" button the user's focus was on simply disappears when `slip.clear()`
empties the panel.

**The consequence:** after successfully placing a bet from the keyboard — on either surface —
focus is silently dropped to `<body>`. The positive toast still announces correctly through its
`role="status"`/`aria-live="polite"` region for a screen-reader user (D76's contract holds
regardless of focus), but a sighted keyboard user gets no visible focus indicator anywhere on
the page, and the next Tab press restarts from the top of the document (the header wordmark)
rather than continuing anywhere near where they were — the toast's own Dismiss button, being
portalled last into `document.body`, ends up one of the last stops in that restarted traversal
rather than the first.

**Classification:** this is a real, reproducible gap, not a regression Tasks 14–20 introduced —
the "whole bar unmounts on an empty slip" behavior is Task 6's original design (D53), and every
piece here (the guard, the restore-focus effect, the batched updates) is exactly as its own task
built it and tested it. It surfaced only because this trace, unlike Task 19's, was asked to
follow the path all the way through a successful placement rather than stopping at "into
Sheet/Dialog." Recorded as disclosed debt below, not fixed in this commit — Task 21's brief is
an audit and close-out, not a source change, and a fix here (e.g., moving focus to a stable
anchor — the main landmark, or the toast region itself — when the invoking control is about to
be unmounted alongside the slip) deserves its own reviewed change with a jsdom test guarding it,
the way Task 14 did for the rest of `Sheet`'s contract.

**Toast, the last leg of the trace:** `ToastProvider`'s portal renders `role="status"
aria-live="polite"`, unchanged since Task 3 and re-confirmed by
`toast-structure.test.ts` passing. Task 15 added the enter/exit `data-state` transition (inert
under reduced motion) and Task 19 did not touch this file; nothing here regresses the polite
announcement Task 13's hot-path walk exercised.

## Screen-reader transcript — `[MANUAL]`

Not attempted. This session has no VoiceOver or NVDA available (no live browser, no assistive
technology host) — recording an invented transcript would be fabrication, not evidence. Marking
this row `[MANUAL]` exactly as the task's own brief anticipates: a real VoiceOver or NVDA pass
over board cell → slip → place → toast, on whichever surface (iOS/mobile Safari or a desktop
browser) the eventual reviewer has to hand, is the only way to close it. The keyboard trace
above is the closest a cloud session can get, and it already found one gap (focus lands on
`<body>` after placement) that a screen-reader pass would also need to characterize — does the
screen reader re-announce anything useful at that point, or does it go silent along with the
visual focus indicator.

## Open items this close-out does not attempt

- **`[LOCAL]` Task 18's production migration** (`ENV_FILE=.env.production npm run db:migrate`)
  — not run, no `.env.production` created. The accent column ships `notNull().default('GREEN')`
  so every existing production row is valid the instant the migration applies; nothing about
  7d's own work makes this more or less urgent than it already was.
- **`[MANUAL]` Noah, on a real phone against the live Saturday slate** — scrolling the board,
  placing a bet, feeling the Sheet and the toasts, picking an accent and confirming it follows
  to a second device. Not attempted; per the plan, findings from this pass do not block a merge.

## Verdict

Nothing in Tasks 14–20 regressed anything Task 13 or Task 19 verified — the accent remaps, the
dark-mode selectors, the responsive breakpoints, and the board's density approach are all
structurally intact, and the 380 structural tests plus the full 121-file/1237-test suite back
that up. The keyboard trace now runs board cell → slip → place → toast end to end and surfaces
one real, reproducible, previously-undocumented gap (focus drops to `document.body` after a
successful placement on both the Sheet and rail surfaces) — recorded above as disclosed debt,
not fixed here. Two rows stay explicitly open and unattempted, exactly as scoped: the production
migration (`[LOCAL]`) and Noah's phone pass (`[MANUAL]`), neither of which blocks anything. The
screen-reader transcript is `[MANUAL]` rather than fabricated. **7d is built; what remains of it
is not `[CLOUD]` work.**
