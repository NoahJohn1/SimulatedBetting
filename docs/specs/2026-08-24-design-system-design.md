# Design System — Design Spec

**Date:** 2026-08-24
**Status:** Specified
**Scope:** Phase 7b of the UI ladder (see [../roadmap.md](../roadmap.md#7b--design-system))
**Depends on:** [7a](2026-08-22-ui-foundations-design.md), which shipped the six shared
components this phase retokenizes and the structural-test pattern it extends.
**Blocks:** [7c](../roadmap.md#7c--screen-by-screen-rebuild), which rebuilds every screen
against what this phase produces. Blocks nothing outside the ladder.

## Purpose

The app looks like four different apps because it was built as four subsystems, each screen
reaching for whatever Tailwind classes were nearest. There are six shared components and 474
`className` attributes; 144 of those carry a hand-written `dark:` variant, and the neutral
palette is the raw zinc scale used eleven different ways (`text-zinc-500` alone appears 85
times).

7b does not make the app pretty. It replaces the vocabulary the app is written in — one set of
semantic tokens, one small set of components with real call sites — so that 7c can rebuild
screens against something instead of against nothing, and so a colour decision is a one-line
change rather than a 63-file sweep.

When 7b is done the app is *recognizably the same app*, rendered from a vocabulary a person can
hold in their head.

### What the roadmap got wrong about this phase

Recorded here rather than silently re-scoped, following 7a's precedent.

- **"There are four shared components today."** There are six.
  [7a](2026-08-22-ui-foundations-design.md) added `status-screen.tsx` and `loading-screen.tsx`
  to the four the roadmap counted (`badge`, `empty-state`, `money`, `tab-bar`). All six are
  retokenized here; none is rewritten.
- **"The shared set: button, card, sheet, dialog, table, tabs, toast, form field."** Four of
  those eight have **no call site anywhere in the app** — there is not one `<table>` element,
  not one dialog, and not one sheet in 63 `.tsx` files. Building them now means designing
  against imagined requirements. See [D53](../decisions.md#d53--the-shared-component-set-is-scoped-to-call-sites-that-exist) and
  [What 7b defers](#what-7b-defers-and-who-owns-it).
- **"Design tokens: color, type scale, spacing, radii."** Colour and radii get tokens. Type
  scale and spacing do not, because Tailwind v4 already ships both as theme variables and
  aliasing `--text-body` on top of `text-sm` is a layer with no consumer. What this phase owes
  on those two is a decision about *which subset is allowed*, which is a spec statement — see
  [The scales that stay Tailwind's](#the-scales-that-stay-tailwinds).
- **"see [the mobile audit](../mobile-audit.md) for what 7b inherits"** (from the 7a section).
  The audit assigned **no findings to 7b**. Its six findings went 7a (2, fixed), 7c (3), 7d (1).
  7b inherits an empty list from it, which is worth stating so it is not searched for again.

### One bug found while specifying, which 7b owns

**The app has never rendered in Geist.** `src/app/layout.tsx` loads `Geist` and `Geist_Mono`
and puts their variables on `<html>`; `globals.css` wires `--font-sans` to `--font-geist-sans`
inside `@theme inline`. But the same file ends with `body { font-family: Arial, Helvetica,
sans-serif; }`, which wins, and nothing anywhere uses the `font-sans` utility. Every screen in
the app is Arial today. It is a `create-next-app` leftover living in the token layer, so it is
this phase's to fix.

## Success criteria

7b is done when all of the following are true:

1. `src/app/globals.css` defines the complete token layer: two tiers, thirty semantic colour
   tokens, three radii, one shadow, and the font wiring.
2. Dark mode is defined **once**, as a remapping of semantic tokens. Zero `dark:` variants
   remain anywhere in `src/` outside the token layer — all 144 are gone.
3. The five new components — `Button`, `Card`, `Callout`, `SegmentedControl`, `FormField` —
   exist, and every one of them has at least one real call site in the shipped code.
4. `Badge` takes a tone rather than a fixed status map, and the inline chips in
   `feed-card.tsx` and `market-card.tsx` render through it.
5. `Money`, `Price`, and `Line` are the only place American prices and cent amounts are
   formatted; `game-card.tsx`'s private `signed()` is gone.
6. Every `.tsx` file in `src/` speaks only the semantic vocabulary. No raw palette class, no
   hex literal, no arbitrary colour value, outside the allowlist.
7. `token-lint.test.ts` fails if any of criterion 6 is violated by a file added later.
8. The app renders in Geist.
9. `docs/design-system-audit.md` records all 18 routes viewed in both themes at 375px and
   1280px, with any visual difference from before the sweep either justified as a declared
   collapse or fixed.
10. `npm run verify` and `npm run build` both pass.

## Non-goals

- **Any screen redesign.** Layout, spacing, and information hierarchy are untouched. A screen
  that reads badly at 375px today reads exactly as badly afterward — that is 7c's job, and the
  mobile audit already assigned it there.
- **A brand colour.** The app stays monochrome. `--accent` resolves to near-black in light and
  near-white in dark, exactly as today. The token exists so that *choosing* a hue later is a
  two-line change; picking one before a single screen has been redesigned is a decision made
  with no information.
- **A dark-mode toggle.** Tokens flip under `prefers-color-scheme`. The `[data-theme]`
  selectors are written now so a toggle is a later drop-in, but no UI, no cookie, and no
  persistence ship here.
- **Dialog, Sheet, Table, and Toast.** No call sites. Deferred to 7c — see below.
- **A component-test harness.** Still no jsdom, no React Testing Library. See
  [D54](../decisions.md#d54--a-token-lint-test-is-the-harness-7b-earns-revisiting-d51), which revisits [D51](../decisions.md#d51--ui-conventions-are-tested-structurally-not-with-a-component-test-harness) as D51 asked.
- **New dependencies.** The runtime dependency list stays at five.
- **Accessibility work beyond what the tokens carry.** Contrast pairs are chosen deliberately
  here; focus management, keyboard paths, and screen-reader labels are 7d.

## Architecture

### Two tiers, one file

The entire token layer is `src/app/globals.css`. Tailwind v4 is CSS-first — there is no
`tailwind.config.ts` and this phase does not add one.

**Tier 1 — private ramps.** The exact `oklch()` values Tailwind ships for the zinc, red,
emerald, and amber stops the app already uses, copied in as `--n-*`, `--pos-*`, `--neg-*`,
`--cau-*`.

They are *copied* rather than referenced. Tailwind v4 only emits a theme variable into `:root`
when a generated utility uses it, so `var(--color-zinc-200)` is not guaranteed to resolve at
runtime. Copying the values is what makes the sweep pixel-neutral rather than approximately
neutral.

Tier 1 is private. No component, no screen, and no utility may name a Tier 1 variable. Only
Tier 2 reads them.

**Tier 2 — semantic tokens.** The only vocabulary the app is allowed to speak.

| Group | Tokens |
|---|---|
| Surfaces | `--surface`, `--surface-raised`, `--surface-sunken`, `--surface-muted`, `--surface-skeleton` |
| Lines | `--line`, `--line-strong`, `--line-hover`, `--line-subtle` |
| Ink | `--ink`, `--ink-secondary`, `--ink-muted`, `--ink-subtle` |
| Accent | `--accent`, `--accent-ink` |
| Positive | `--positive`, `--positive-surface`, `--positive-surface-soft`, `--positive-line`, `--positive-on-surface` |
| Negative | `--negative`, `--negative-surface`, `--negative-surface-soft`, `--negative-line`, `--negative-on-surface` |
| Caution | `--caution`, `--caution-surface`, `--caution-surface-soft`, `--caution-line`, `--caution-on-surface` |

Thirty tokens. The naming avoids `text-text` and `border-border` — hence `ink` and `line`,
which read correctly as utilities (`text-ink-muted`, `border-line-strong`) and extend cleanly
to `divide-line` and `ring-line`.

Within a tone, the four roles are distinct and all four are used today:

- `--negative` — a standalone colour, on the page background (`text-red-600` on a card)
- `--negative-surface` — a chip's tint (`bg-red-100` behind a badge)
- `--negative-surface-soft` — a full-width callout's tint (`bg-red-50` behind a form error),
  which is deliberately weaker than a chip's because it covers far more area
- `--negative-line` — a tinted border
- `--negative-on-surface` — the text colour used *on* `--negative-surface`, which is not the
  same value as `--negative`

### Exposure to Tailwind

```css
@theme inline {
  --color-surface: var(--surface);
  --color-ink-muted: var(--ink-muted);
  /* … one line per Tier 2 token … */
}
```

`inline` is load-bearing and not decoration. It was verified by compiling Tailwind 4.3.3
directly rather than assumed:

- With `inline`, `.bg-surface` emits `background-color: var(--surface)`. The variable resolves
  **at the element**, so it picks up the media-query and `[data-theme]` overrides. `--color-surface`
  is never emitted into `:root` at all — there is no indirection layer.
- Without `inline`, the utility would emit `var(--color-surface)`, and `--color-surface` would
  be resolved once at `:root`, defeating any scoped override.

Opacity modifiers survive the indirection: `bg-surface-raised/90` compiles to a `color-mix(in
oklab, var(--surface-raised) 90%, transparent)` guarded by `@supports`, with the solid colour
as the fallback declaration. That is what the sticky header and the tab bar need, and it is why
they do not have to become a special case.

### Dark mode is a remap, not a variant

```css
:root                                            { /* light: Tier 2 → Tier 1 */ }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"])                { /* dark:  Tier 2 → Tier 1 */ }
}
:root[data-theme="dark"]                         { /* dark:  Tier 2 → Tier 1 */ }
```

Tier 1 never changes. The dark theme is the same thirty names pointed at different ramp stops.

The third selector ships with no way to set `data-theme`. It is there because writing it later
means restructuring the CSS, and writing it now costs one duplicated block — the difference
between a toggle being a drop-in and a toggle being a refactor.

**The mapping.** Light and dark values for all thirty tokens:

| Token | Light | Dark |
|---|---|---|
| `--surface` | zinc-50 | black |
| `--surface-raised` | white | zinc-950 |
| `--surface-sunken` | zinc-50 | zinc-900 |
| `--surface-muted` | zinc-100 | zinc-800 |
| `--surface-skeleton` | zinc-200 | zinc-800 |
| `--line` | zinc-200 | zinc-800 |
| `--line-strong` | zinc-300 | zinc-700 |
| `--line-hover` | zinc-400 | zinc-600 |
| `--line-subtle` | zinc-100 | zinc-900 |
| `--ink` | zinc-900 | zinc-50 |
| `--ink-secondary` | zinc-600 | zinc-300 |
| `--ink-muted` | zinc-500 | zinc-400 |
| `--ink-subtle` | zinc-400 | zinc-600 |
| `--accent` | zinc-900 | zinc-100 |
| `--accent-ink` | white | zinc-900 |
| `--positive` | emerald-600 | emerald-400 |
| `--positive-surface` | emerald-100 | emerald-950 |
| `--positive-surface-soft` | emerald-50 | emerald-950 @ 30% |
| `--positive-line` | emerald-500 | emerald-700 |
| `--positive-on-surface` | emerald-700 | emerald-400 |
| `--negative` | red-600 | red-400 |
| `--negative-surface` | red-100 | red-950 |
| `--negative-surface-soft` | red-50 | red-950 @ 30% |
| `--negative-line` | red-300 | red-800 |
| `--negative-on-surface` | red-700 | red-400 |
| `--caution` | amber-600 | amber-400 |
| `--caution-surface` | amber-100 | amber-950 |
| `--caution-surface-soft` | amber-50 | amber-950 @ 20% |
| `--caution-line` | amber-300 | amber-800 |
| `--caution-on-surface` | amber-700 | amber-400 |

`--surface` and `--surface-sunken` are the same value in light and diverge in dark. That is not
an oversight — it is what the code does today, and collapsing them would flatten the dark
theme's card-on-page separation.

### The scales that stay Tailwind's

Radii get tokens because the codebase has a genuine unnamed three-way mix: `--radius-card`
(`rounded-xl`), `--radius-control` (`rounded-lg`), `--radius-pill` (`rounded-full`). One
shadow gets a token: `--shadow-slip`, replacing the bet slip's arbitrary
`shadow-[0_-8px_24px_rgba(0,0,0,0.06)]`, which renders as nothing at all against a black page.

Type scale and spacing do **not** get tokens. Tailwind v4 already ships `--text-*` and
`--spacing`, and the app already uses a consistent subset of both. What this phase records is
the allowed subset, enforced by review rather than by a lint rule:

- **Type:** `text-xs`, `text-sm`, `text-base`, `text-lg`, `text-xl`, `text-2xl`. Nothing larger
  appears in the app and nothing should without a screen design behind it.
- **Spacing:** Tailwind's 4px scale, in the steps already in use — `0.5 1 2 3 4 6 8 12 16`.

Normalizing the existing screens onto those subsets is 7c work, done per screen as it is
rebuilt. Doing it here would mean intentional visual drift inside a sweep whose safety property
is that it produces none.

### The component set

Five new, six upgraded in place. Every one has a call site in the shipped diff — that is the
selection rule, not a coincidence.

| Component | File | Real call sites today |
|---|---|---|
| `Button` | `ui/button.tsx` | 46 button-ish elements. Variants `primary` / `secondary` / `ghost` / `danger`, sizes `sm` / `md`. Owns the `disabled` + pending-label contract that [D51](../decisions.md#d51--ui-conventions-are-tested-structurally-not-with-a-component-test-harness)'s structural test asserts, so that test keeps passing through the sweep. |
| `Card` | `ui/card.tsx` | The `rounded-xl border bg-white` block on nearly every screen. |
| `Callout` | `ui/callout.tsx` | Six files hand-roll one: form errors, the overdue-event queue, the void confirmation, the creator-disclosure banner. Tone-scoped, uses `--{tone}-surface-soft`. |
| `SegmentedControl` | `ui/segmented-control.tsx` | The link-based Bets \| Wagers and Cash \| Credits controls, duplicated across `/bets` and `/wagers`. Link-based, not stateful — these are server-rendered navigations and must stay that way. |
| `FormField` | `ui/form-field.tsx` *(new)* | Label + control + hint + error, across the twelve forms. |
| `Badge` | `ui/badge.tsx` *(upgraded)* | Becomes tone-based instead of a fixed five-status map, absorbing the chips `feed-card.tsx` and `market-card.tsx` reimplement inline. The status→tone mapping moves into the component. |
| `Money` / `Price` / `Line` | `ui/money.tsx` *(upgraded)* | `game-card.tsx` has a private `signed()` duplicating `Price`. `Line` is new and absorbs `selectionLabel`'s line formatting. |
| `EmptyState`, `StatusScreen`, `LoadingScreen`, `TabBar` | *(retokenized)* | No API change. Classes only. |

`Button` is the one with a real decision in it. It renders `<button>` by default and accepts an
`asChild`-free escape hatch instead: a sibling `buttonClasses(variant, size)` export that
`<Link>` call sites apply directly. Cloning children to forward props is the thing that makes
button components hard to read, and this app's link-buttons are all plain `next/link`.

### Why no Dialog, Sheet, Table, or Toast

`grep` finds zero `<table>`, zero `role="dialog"`, zero `<dialog>` in `src/`. A component
designed against zero call sites encodes a guess about its API, and the first real consumer
either bends to the guess or rewrites it.

Toast is the closest call and was considered on its merits: twelve forms currently report
results as inline text that can scroll out of view, so there *is* a real problem. It still
loses. A toast needs a client provider, a portal, and a dismissal/timing policy — that is a
design question about how this app reports success, not a styling question, and 7c is where the
screens that would raise it get rebuilt. Deferring costs nothing that is not already the status
quo.

All four are 7c's, built in the commit that first needs one. See
[D53](../decisions.md#d53--the-shared-component-set-is-scoped-to-call-sites-that-exist).

## The sweep

Every `.tsx` file under `src/` moves onto the vocabulary. Colour and `dark:` variants only —
spacing, radii on existing markup, font sizes, and layout are not touched.

That restriction is the safety property, and it is the reason a 63-file diff is reviewable at
all: **any visual difference after the sweep is a token bug, not a judgement call.** The browser
audit can therefore be a diff hunt rather than a taste exercise.

**The sweep matches light/dark *pairs*, not individual classes.** This matters and will
silently corrupt the result if missed: `bg-zinc-50` maps to `--surface` when its partner is
`dark:bg-black` (the page background in the app shell) and to `--surface-sunken` when its
partner is `dark:bg-zinc-900` (an inset row). The light class alone does not determine the
token.

**Declared visible changes.** Four, and only four, are permitted to differ:

1. `dark:bg-zinc-100` (15×) and `dark:bg-zinc-50` (3×) both become `--accent`. The three
   lighter ones darken by one stop.
2. The four "creator bet their own event" chips in `feed-card.tsx` are `bg-amber-100
   text-amber-900` with **no dark variant at all**, so today they burn bright amber on a black
   card. They gain a dark treatment.
3. The bet slip's shadow becomes visible in dark mode, having previously rendered as nothing.
4. **A control adopted into `Button` takes `Button`'s radius.** Today's buttons are a mix of
   `rounded-full` and `rounded-lg`; the component settles on `rounded-control`. This is the one
   declared change that is not a colour, and it is a consequence of having a component at all —
   a `Button` that inherits each call site's radius is a class-name helper wearing a component's
   name. It is bounded by being opt-in: adoption happens at the call sites the plan names, and
   the odds cells in `game-card.tsx` are explicitly not among them, being a selection grid that
   happens to use `<button>`.

Anything else the audit finds is a bug to fix, not a change to justify.

**Sequencing.** One commit per screen group — chrome → games and the bet slip → feed →
bets and wagers → events → admin → the remainder — so a regression bisects to a screen rather
than to "the sweep".

## Testing

Per [D54](../decisions.md#d54--a-token-lint-test-is-the-harness-7b-earns-revisiting-d51): a structural token-lint test, still no component harness.

`src/app/__tests__/token-lint.test.ts` walks `src/` and fails on, outside the allowlist:

- any raw palette class — `(bg|text|border|ring|divide|from|to|shadow|outline|placeholder|decoration)-(zinc|slate|gray|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}`
- `bg-white`, `bg-black`, `text-white`, `text-black` and their `border-` forms
- any `dark:` variant
- any hex literal or arbitrary colour value in a `className`

**Allowlist:** `src/app/globals.css` (the token layer itself), `src/app/icon.tsx` and
`src/app/apple-icon.tsx` (`ImageResponse` renders outside the document and cannot read CSS
variables), `src/app/manifest.ts` (the manifest wants literal hex), and the test file itself.

This is [D51](../decisions.md#d51--ui-conventions-are-tested-structurally-not-with-a-component-test-harness)'s own reasoning applied again. D51 kept the `notFound()`
assertion because it constrains routes not yet written and discarded the rest as descriptions
of a tree that already exists. The token-lint test is entirely of the first kind: it says
nothing about today's code once the sweep lands, and everything about screen nineteen.

The other new structural test is `token-layer.test.ts`, which asserts the token layer itself —
`globals.css`'s custom properties and their light/dark pairing. `route-conventions.test.ts` is
left unmodified: its existing assertions (pending-state disabling, boundary delegation) already
covered what needed covering here, with nothing new to add.

**What this does not catch,** stated plainly: it is a source-text assertion, so it cannot see a
token used in the wrong role — `bg-surface-muted` where `bg-surface-sunken` was meant renders
wrong and passes. The browser audit is what catches that, and it is why the audit is a
deliverable rather than a nicety.

## Verification

A one-time browser pass, written up the way 7a's mobile audit was, producing
`docs/design-system-audit.md`.

- All 18 routes, × both themes, × 375×812 and 1280×800.
- Dark mode is forced via CDP's `Emulation.setEmulatedMedia` rather than by editing the CSS, so
  what is verified is the shipped media query.
- Screenshots captured before and after the sweep for the same route, so the comparison is
  mechanical.
- Each difference is recorded as one of the three declared collapses, or as a bug and fixed.

Chromium is already available to the implementing session; Playwright is configured to find it
via `PLAYWRIGHT_BROWSERS_PATH`. If the browser pass proves impossible in the session's
environment, the fallback is to capture the screenshots and hand them over — **not** to skip
the document, because 7c is the consumer and it needs to know what was checked.

## What 7b defers, and who owns it

The tracking obligation of this phase. Everything named as out of scope above has an owner
recorded in [the roadmap](../roadmap.md#7--the-ui-ladder), not merely a mention here.

| Deferred | Owner | Why not 7b |
|---|---|---|
| `Dialog`, `Sheet`, `Table`, `Toast` | 7c | Zero call sites today; built in the commit that first needs one ([D53](../decisions.md#d53--the-shared-component-set-is-scoped-to-call-sites-that-exist)) |
| Type-scale and spacing normalization on existing screens | 7c | Intentional visual drift inside a sweep whose safety property is producing none |
| A brand accent colour | 7c or later | `--accent` makes it a two-line change; picking it before any screen is redesigned is a guess |
| Dark-mode toggle UI (cookie + control) | 7d | The `[data-theme]` selectors ship here; the control is craft |
| `generateMetadata` on detail routes | 7c | Deferred by [7a](2026-08-22-ui-foundations-design.md), unchanged by this phase |
| Odds-board density at 375px | 7c | Mobile-audit finding; needs the screen redesigned |
| `datetime-local` inputs cramped two-up | 7c | Mobile-audit finding; a layout fix |
| `/admin/events` header running together | 7c | Mobile-audit finding; page-specific markup |
| Admin section has no shell chrome | 7d | Mobile-audit finding; a structural decision, not a token one |
| Focus management, keyboard paths, SR labels on the new components | 7d | Tokens carry contrast; behaviour is craft |
| Skeleton loaders replacing `LoadingScreen` | 7d | Explicitly 7d in the roadmap and in [7a](2026-08-22-ui-foundations-design.md)'s non-goals |
| A component-test harness | Revisit at 7d | [D54](../decisions.md#d54--a-token-lint-test-is-the-harness-7b-earns-revisiting-d51); the components 7b ships still have no behaviour worth a harness |

## Risks

**The sweep is large and mechanical, which is exactly when attention lapses.** Mitigated by the
pair-matching rule, per-screen-group commits, the token-lint test, and a before/after
screenshot comparison rather than a from-memory one.

**A token used in the wrong role passes every automated check.** This is the residual risk the
browser audit exists to absorb, and it is why the audit is a success criterion.

**`color-mix()` in the three `-surface-soft` dark values has no `@supports` fallback,** unlike
the Tailwind-generated opacity modifiers. Accepted: the app is a private group on current
browsers, and the failure mode is a transparent callout tint, not a broken screen.
