# Design-system audit — 375×812 and 1280×800, both themes

Every screen viewed in Chromium against captures taken from `c2bb3a9`, the tip of
[phase 7a](specs/2026-08-22-ui-foundations-design.md), so the comparison is mechanical rather
than from memory. The token lint that gates [phase 7b](specs/2026-08-24-design-system-design.md)
is a source-text assertion: it cannot see a token used in the wrong *role*, and this pass is
what catches that. Dark mode was forced with CDP's `Emulation.setEmulatedMedia`, so what is
verified is the shipped media query rather than a hand-set attribute.

**Classification.** `7b` — a difference that is neither one of the spec's four declared changes
nor a consequence the plan records; fixed in this commit and noted as such. `7c` — needs the
screen rebuilt. `none` — a deliberate, documented consequence of the token collapse, recorded so
7c does not re-litigate it.

## Summary

Five things were wrong, and all five are fixed here. Four of them are the same mistake wearing
different clothes: **the sweep had no token for "a control sitting on a card", and reached for
`bg-surface-raised`, which is the card.** `dark:bg-zinc-900` appears fifteen times in the pre-7b
tree; eleven of them — every text input on a card, both odds grids — took the mapping table's
`bg-white` + `dark:bg-zinc-900` → `bg-surface-raised` row, whose dark value is `zinc-950`, the
exact colour of the `Card` behind it.
In dark mode every one of those controls lost the fill that made it read as a control: the
`/games` odds board went from filled, tappable cells to hairline outlines on black. The token
that reproduces the original is `bg-surface-sunken` (`zinc-900` in dark, to the stop), and that
is what they use now. The second systemic one is a contrast regression: bare `text-zinc-400`
(no dark partner, so `zinc-400` in *both* themes) mapped to `text-ink-subtle`, whose dark value
is `zinc-600` — measured contrast against `--surface-raised` fell from about 8.6:1 to about
2.6:1 at fifteen call sites, including all five inactive labels in the bottom tab bar.
`text-ink-muted` restores dark exactly and lifts light mode from ~2.3:1 to ~4.8:1 as a bonus.

Past those, the phase is clean. The four declared changes all landed and are confirmed below —
though two of them are worth reading before they are relied on: the bet slip's new dark shadow
is measurable but not perceptible, because the shadow is pure black and so is `--surface`. The
single biggest pixel difference in the whole audit is not a finding at all: the app now renders
in Geist instead of the `create-next-app` Arial fallback, which is the spec's own success
criterion 8 and moves every glyph on every screen. It is the reason all 108 image pairs differ.

**Coverage.** 27 screen states × 2 themes × 2 viewports = 108 pairs, all captured before and
after. That is the brief's eighteen routes plus the bet slip collapsed and expanded, a resolved
and corrected event, and the five screens outside the app shell (`/sign-in`, `/pending`,
`/join`, `/disabled`, `/no-season`) that Task 4 adopted `Button` on. `/no-season` needed the
season taken out of `ACTIVE` for the duration of its four shots. Fixtures: an ADMIN member with
cash and credit bets (single, parlay, and one on an event they created), a second member, three
peer-to-peer wagers spanning offered/accepted/disputed, a comment thread, and one event resolved
and then corrected so the declared amber chips actually render.

## Findings

| Screen | Finding | Severity | Rung |
|---|---|---|---|
| `/games`, `/events/[eventId]`, and nine form fields | `bg-white`/no-light-fill + `dark:bg-zinc-900` → `bg-surface-raised`, whose dark value is `zinc-950` — identical to the `Card` behind it. In dark mode every odds cell, outcome cell and text input lost its fill and reads as a hairline outline. The fix's light value is `n-50` (`#fafafa`), not `n-0` (`#ffffff`), so the same 11 sites also gain a faint light-mode tint they did not have before (previously `#ffffff` or transparent-on-white, now `#fafafa`) — unavoidable, since `token-lint.test.ts` bans `dark:` variants outright and so no single token can be `n-0` in light and `n-900` in dark. | blocks use | 7b — fixed (`bg-surface-sunken`, dark `zinc-900`, in `game-card.tsx`, `market-card.tsx` ×3, `event-form.tsx` ×2, `resolve-form.tsx`, `dispute-form.tsx`, `bet-slip.tsx`, `void-form.tsx`, `arbitration-form.tsx`) |
| Bottom tab bar, and 14 other sites | Bare `text-zinc-400` (no dark partner) → `text-ink-subtle`, whose dark value is `zinc-600`. Contrast on `--surface-raised` fell ~8.6:1 → ~2.6:1, below WCAG AA, on the five inactive tab labels, both bet-slip remove controls, `/standings` ranks, `/me` dates and running balances, `/feed` timestamps, the `/games` column headers, and four "Remove"/"Delete" links. | blocks use | 7b — fixed (`text-ink-muted`; the one correctly-paired site, `status-screen.tsx`, keeps `text-ink-subtle`) |
| `/games` | The "no line offered" `—` placeholder was bare `text-zinc-300`; `text-ink-subtle` took it to `zinc-600` in dark. Fixed with the row above; light mode goes `zinc-300` → `zinc-500`, which makes the dash legible rather than nearly invisible. | cosmetic | 7b — fixed (`game-card.tsx`) |
| `/sign-in` | The Google button was adopted as the default `primary` `Button` — a solid black (light) / solid near-white (dark) fill where it had been an outlined white/`zinc-900` control. The spec declares that an adopted control takes `Button`'s *radius*, not that it changes weight. | awkward | 7b — fixed (`variant="secondary" className="bg-surface-sunken"`, which is the exact token spelling of the original; the radius change stands) |
| `/admin` | Page overflowed a 375px viewport by 2px (document `scrollWidth` 377). `mx-auto` disables cross-axis stretch inside the root layout's flex `<body>`, leaving the container fit-content; the pending member's `truncate`d email contributes its full min-content, which Geist renders 2px wider than Arial did. | cosmetic | 7b — fixed (`w-full` on the page container) |
| Bet slip | The dark-mode shadow (`shadow-slip`) is measurable (8→6/255 over the card it overlaps) but not perceptible — the shadow colour and `--surface` are both pure black in dark mode. Would need either a non-black shadow colour or a `--surface` that isn't pure black to actually read; both are Task 1 token-layer decisions, outside this audit's remit. | cosmetic | 7c |
| `/admin/events`, `/admin/wagers` | Same `mx-auto` (no `w-full`) container pattern as `/admin`'s overflow bug — didn't overflow with current fixture content, but shares the latent issue. Not fixed here since it wasn't observed to break; worth the same `w-full` if content grows. | cosmetic | 7c |
| `/events/[eventId]`, `/events/[eventId]/resolve`, `/events/new`, `/events`, `/me/feed-preferences`, `/sign-in`, `/join` | Controls adopted into `Button` grew 6–8px taller: `Button`'s `md` size is `h-11`, and the call sites were `py-2`, `h-9` or `h-12`. The spec declared the radius; the height comes with the component. It is a better tap target, so it is recorded rather than reverted. | cosmetic | 7c |
| `/wagers/new` and the other converted forms | `FormField` restyles labels from `text-sm font-medium` to `text-xs font-medium text-ink-secondary`. Smaller and quieter than before. | cosmetic | 7c |
| `/me`, `/standings` | `Card` adoption gives the ledger rows and rank rows a 1px `border-line` and `rounded-card` (12px) where they had a bare fill and `rounded-lg` (8px). | cosmetic | 7c |
| `/events` | "Create an event" lost its 1px border — `Button`'s `primary` variant has none. The old border was the same colour as the fill, so the control is 2px smaller and otherwise unchanged. | cosmetic | 7c |
| Every screen at 1280×800 | No screen has a desktop layout: outside `/admin*`'s `max-w-2xl`, every list runs edge to edge. Identical before and after — existing design, not a 7b regression, but it is what 1280px looks like. | awkward | 7c |
| `/wagers/[wagerId]` | `bg-zinc-100` + `dark:bg-zinc-900` → `bg-surface-muted` lightens the description block one stop in dark (`zinc-900` → `zinc-800`). Mapping-table row, deliberate. | cosmetic | none |
| `/bets`, `/bets?currency=CREDITS`, `/events`, `/events/[eventId]` | `border-zinc-100` + `dark:border-zinc-800` → `border-line-subtle` darkens the leg-row separator one stop in dark (`zinc-800` → `zinc-900`). Mapping-table row, deliberate. | cosmetic | none |
| Everywhere | Three mapping-table rows raise dark-mode contrast by one stop: bare `text-zinc-500` → `text-ink-muted` (`zinc-500` → `zinc-400`, ~288 elements), `text-zinc-600 dark:text-zinc-400` → `text-ink-secondary` (`zinc-400` → `zinc-300`), and bare `text-amber-600` → `text-caution` on `/wagers`' `disputed` chip. All improvements. | cosmetic | none |
| `/events/[eventId]` (resolved) | The won-outcome box's `bg-emerald-50` + `dark:bg-emerald-950` → `bg-positive-surface` darkens the light value one stop (`emerald-50` → `emerald-100`). The alternative, `bg-positive-surface-soft`, is a 30%-alpha dark value that all but vanished; documented in Task 12's report and confirmed here as the better of the two. | cosmetic | none |
| Outside the app shell (`/sign-in`, `/pending`, `/join`, `/disabled`, `/no-season`) | The `create-next-app` `--background`/`--foreground` pair is gone: the page goes `#ffffff` → `#fafafa` in light and `#0a0a0a` → `#000000` in dark, and base ink `#171717` → `zinc-900` / `#ededed` → `zinc-50`. Invisible inside the shell, which already painted `bg-zinc-50 dark:bg-black`. Part of the token layer's own job (spec, "the token layer"), not one of the four. | cosmetic | none |
| `/feed`, `/feed/[eventId]` | The reaction emoji `😂` renders from a different fallback font under the new `var(--font-geist-sans), ui-sans-serif, system-ui` stack than under `Arial, Helvetica, sans-serif`. Reproduced outside the app with a bare `setContent`, so it is this capture container's font set, not a shipped change. | cosmetic | none |

## The four declared changes, confirmed

1. **`dark:bg-zinc-100` and `dark:bg-zinc-50` both become `--accent`.** Observed on `/admin`'s
   "Approve" button, the only `dark:bg-zinc-50` site reachable in a capture — its dark fill
   darkens one stop, `zinc-50` → `zinc-100`. The `dark:bg-zinc-100` sites (selected odds cell,
   segmented-control pill, "Place bet") are unchanged, as expected.
2. **The four `feed-card.tsx` disclosure chips gain a dark treatment.** Confirmed on the
   `correction` chip: dark goes `bg-amber-100`/`text-amber-900` → `--caution-surface`
   (`amber-950`) / `--caution-on-surface` (`amber-400`), so it no longer burns bright on a black
   card, and it picks up `Badge`'s pill radius. In light it keeps `amber-100` and the text moves
   `amber-900` → `amber-700`. The `CREATOR` chip is not one of the four — it was already the
   neutral status badge, and the rename to `StatusBadge` left it alone.
3. **The bet slip's shadow becomes visible in dark mode.** In the stylesheet, yes:
   `--slip-shadow` gains a dark value of `0 -8px 24px rgb(0 0 0 / 0.5)`. On screen, barely —
   measured over the card the slip overlaps, the fill goes from 8 to 6 out of 255, and where the
   slip meets the page there is no change at all, because `--surface` in dark is pure black and
   so is the shadow. A dark-mode elevation shadow needs a colour that is not the background;
   worth 7c's attention if the elevation is meant to read.
4. **A control adopted into `Button` takes `Button`'s radius.** Six call sites move
   `rounded-full` or `rounded-xl` → `rounded-control` (8px): "Resolve event", "Submit dispute",
   "Create event", "Confirm resolution", "Create an event", "Save". The odds cells in
   `game-card.tsx` are untouched, as the plan required. `rounded-full` → `rounded-pill` elsewhere
   is a no-op at these sizes (33 554 432px → 9999px, both clamped to a capsule).

## Screens with nothing to report

After the fixes above, these are pixel-identical to the tip of 7a apart from the typeface, the
base surface/ink tokens, and — for the screens carrying one of the 11 `bg-surface-sunken` sites
above — the `#ffffff`→`#fafafa` light-mode tint noted in that row: nothing on them needs 7c's
attention on colour grounds beyond what is already recorded:

`/bets` and `/bets?currency=CREDITS` (both segmented controls, pending and settled rows),
`/wagers` (all four sections), `/wagers/[wagerId]`, `/feed/[eventId]` (card, reactions and
comment thread), `/members/[membershipId]`, `/admin/events`, `/admin/wagers`, `/pending`,
`/join`, `/disabled`, `/no-season`, and the bet slip both collapsed and expanded, at one leg and
at three. `/games`, `/events`, `/events/new`, `/events/[eventId]` (open, resolved, and
corrected), `/events/[eventId]/resolve`, `/feed`, `/standings`, `/me`, `/me/feed-preferences`,
`/admin` and `/sign-in` each carry exactly the rows the table above assigns them and nothing
further.
