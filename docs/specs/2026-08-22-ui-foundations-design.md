# UI Foundations — Design Spec

**Date:** 2026-08-22
**Status:** Specified
**Scope:** Phase 7a of the UI ladder (see [../roadmap.md](../roadmap.md#7a--foundations))
**Depends on:** nothing. 7a touches no server code, no schema, and no money path.
**Blocks:** [Phase 9 — hardening](../roadmap.md#9--hardening), which wants the error states to
exist before a smoke checklist can check them.

## Purpose

Make the app survivable and installable. Today a throw anywhere inside the members-only shell
destroys the shell; the browser tab says "Create Next App"; `public/` is the five SVGs
`create-next-app` left behind; and nothing has been looked at on a phone on purpose.

7a is the smallest rung of the ladder and the only one that is not optional. It adds no
features and restyles nothing. When it is done the app is still ugly — it is just no longer
capable of showing a member a white screen with no way back.

### What the roadmap got wrong about this phase

The roadmap's 7a section was written before the deploy-groundwork and repo-health lanes landed,
and two of its four bullets are already satisfied. Recording that here so the phase is not
re-scoped from a stale description:

- **"The app currently has zero `error.tsx`, `loading.tsx`, or `not-found.tsx` files."** Half
  true. [`src/app/error.tsx`](../../src/app/error.tsx),
  [`src/app/global-error.tsx`](../../src/app/global-error.tsx), and
  [`src/app/not-found.tsx`](../../src/app/not-found.tsx) all exist and are well-written. There
  are still zero `loading.tsx` files anywhere, and — the gap the roadmap does not name — the
  three that exist are all at the **root**, so they replace the entire page rather than
  rendering inside the shell.
- **"Pending states on every form."** Already done, on all twelve client forms. Every one uses
  `useTransition` and every submit control is both `disabled={pending}` and label-swapped
  ("Placing…", "Voiding…", "Confirm resolution" → "Resolving…"). This bullet needs a
  regression test, not an implementation.

The two bullets that are genuinely untouched — metadata/icons/manifest, and the mobile audit —
are untouched completely.

## Success criteria

7a is done when all of the following are true:

1. A throw in any member-facing page renders an error boundary **inside** the app shell: the
   header, the tab bar, and the bet slip are still there, and the member can navigate away
   without a full reload.
2. A throw in any admin page renders an error boundary rather than the root one.
3. "Try again" actually tries again — every boundary calls `retry()`, which re-fetches, rather
   than `reset()`, which does not.
4. Every `notFound()` call in the app lands on a not-found boundary that keeps the shell.
5. Every top-level feature segment shows a loading state on navigation instead of a blank
   pause.
6. Error boundaries display the error's `digest`, so a member can read eight characters aloud
   and have them grep the server log.
7. The browser tab, the app switcher, and an installed home-screen icon all identify the app as
   SimulatedBetting. The app installs to a phone home screen and opens standalone.
8. Search engines are told not to index it.
9. `docs/mobile-audit.md` records every screen viewed at 375×812, with each finding assigned to
   the ladder rung that owns its fix.
10. `npm run verify` passes, including new tests that fail if a boundary is deleted or a form
   loses its pending state.

## Non-goals

- **Any restyling.** No token layer, no dark-mode rework, no component consolidation. That is
  7b, and pulling it forward would make 7a unshippable on its own.
- **Fixing what the mobile audit finds, with one exception.** The audit produces a document.
  Its findings are 7b/7c/7d work by construction — an inline Tailwind screen that reads badly
  at 375px is going to be rebuilt anyway, and fixing it twice is waste. The exception is the
  narrow class of finding that makes a screen *unusable* rather than ugly, which 7a fixes for
  the same reason it fixes white screens; see [the mobile audit](#the-mobile-audit).
- **Skeleton loaders.** 7d owns "skeleton loaders in place of spinners" explicitly. 7a's
  loading UI is a neutral placeholder that reserves vertical space; it is deliberately not a
  per-screen skeleton, because a skeleton that does not match the screen it precedes is worse
  than no skeleton.
- **Error reporting.** No Sentry, no reporter seam, no transport. Phase 6 owns that. 7a's only
  concession to it is rendering the digest, which is useful today with nothing but the server
  log.
- **`generateMetadata` on detail routes.** Static metadata on the eight top-level pages; detail
  routes inherit the title template. Per-entity titles are 7c's business, when those screens
  are rebuilt anyway.
- **Rebuilding the twelve forms' pending states.** They are correct. They get a test.

## Architecture

### The one structural idea

Every convention file in this phase is a thin route-level file that delegates to a shared
presentational component in [`src/components/ui/`](../../src/components/ui/). There are eleven
of them and they are near-identical; written out longhand, eleven copies of the same markup
drift apart the first time someone improves the copy.

This is not a new pattern — it is the one
[`empty-state.tsx`](../../src/components/ui/empty-state.tsx) already established: a
`title`/`body` component that route code composes. 7a adds two siblings to it, and 7b restyles
one file per state instead of eleven.

```
src/components/ui/
  empty-state.tsx      (exists)
  status-screen.tsx    (new)  — the shared centered title/body/actions layout
  loading-screen.tsx   (new)  — the neutral placeholder
```

`status-screen.tsx` is what error and not-found boundaries render. It takes a title, a body, an
optional digest, and children for actions.

### Where boundaries go, and why not everywhere

A `loading.tsx` covers its segment **and everything nested below it**, so `feed/loading.tsx`
also serves `feed/[eventId]`. One per top-level feature segment covers all eighteen pages with
eight files.

The alternative — a file in every segment — was rejected. It produces twelve additional
identical files nobody will ever see, and it is uniform for the sake of being easy to assert
rather than because a navigation crosses those boundaries.

| File | Catches |
|---|---|
| `src/app/(app)/error.tsx` | any throw in a member page, rendered inside the shell |
| `src/app/(app)/not-found.tsx` | the four `notFound()` calls, rendered inside the shell |
| `src/app/admin/error.tsx` | any throw in an admin page |
| `src/app/(app)/games/loading.tsx` | `/games` |
| `src/app/(app)/events/loading.tsx` | `/events`, `/events/new`, `/events/[eventId]`, `…/resolve` |
| `src/app/(app)/feed/loading.tsx` | `/feed`, `/feed/[eventId]` |
| `src/app/(app)/bets/loading.tsx` | `/bets` |
| `src/app/(app)/wagers/loading.tsx` | `/wagers`, `/wagers/new`, `/wagers/[wagerId]` |
| `src/app/(app)/standings/loading.tsx` | `/standings` |
| `src/app/(app)/me/loading.tsx` | `/me`, `/me/feed-preferences` |
| `src/app/admin/loading.tsx` | `/admin`, `/admin/events`, `/admin/wagers` |

`/members/[membershipId]` sits directly under `(app)` with no feature segment of its own; it
inherits `(app)`'s error and not-found boundaries and gets no loading state. Adding
`members/loading.tsx` for one route reached only from the feed and standings is not worth a
file.

There is no `admin/not-found.tsx`: no admin page calls `notFound()`. The structural test in
[Testing](#testing) is what keeps that honest — the day one does, the test fails.

### The two existing boundaries have a bug

Next 16 hands an error boundary both `retry` and `reset`. `retry()` re-fetches and re-renders
the boundary's children; `reset()` only clears the error state. The bundled docs are explicit
that `retry()` is the one you want in almost every case.

Both boundaries currently in the repo were written against `reset`, so a member who hits a
transient database failure and clicks "Try again" is re-shown the same failed render. That is
a behavior bug, not a naming preference, and it is in this phase's lane — 7a exists to make
"something broke" recoverable, and the recovery button does not currently recover. All four
boundaries end this phase on `retry`.

### Two behaviors that look like gaps and are not

**`redirect()` is unaffected.** [`requireApprovedMember()`](../../src/server/auth/session.ts)
calls `redirect()` ten times across the auth guard, and `redirect` works by throwing. Next
resolves that control-flow error before any error boundary sees it, so the pending/disabled/
no-season/join redirects keep working exactly as they do now. Nothing in this phase should try
to special-case them.

**A throw in `(app)/layout.tsx` still hits the root boundary.** An error boundary renders
*inside* the layout of its own segment, so `(app)/error.tsx` cannot catch a failure of the very
layout that would have to render it — the credits-balance query at
[`(app)/layout.tsx:21`](<../../src/app/(app)/layout.tsx>), for instance. That case correctly
falls through to the existing root [`error.tsx`](../../src/app/error.tsx). This is why the root
boundary stays, rather than being replaced.

## Metadata, icons, and the manifest

### Root metadata

[`src/app/layout.tsx`](../../src/app/layout.tsx) currently exports the `create-next-app`
default. It gets:

- `title` as a template — `%s · SimulatedBetting` with a default of `SimulatedBetting` — so the
  eight per-page titles compose rather than each repeating the app name.
- `description` from the README's one-liner: a play-money sportsbook for a small private group.
- `applicationName` and `appleWebApp.title`, which is what iOS uses under a home-screen icon.
- `metadataBase`, read from the deployment URL env var with a localhost fallback.
- **`robots: { index: false, follow: false }`.** This is a private group behind Google OAuth.
  It has no business in a search index, and the fact that every route requires auth is not a
  reason to skip saying so.

### Viewport

A `viewport` export, which Next requires to be separate from `metadata`:

- `width: 'device-width'`, `initialScale: 1`
- `viewportFit: 'cover'`, so a notched phone can use the full screen — relevant because the tab
  bar is fixed to the bottom
- `themeColor` with light and dark entries matching the two values already defined in
  [`globals.css`](../../src/app/globals.css) (`#ffffff` / `#0a0a0a`), so the browser chrome
  stops fighting the app's background

### Per-page metadata

A static `metadata` export on the eight top-level pages, matching the eight segments in the
table above: Games, Events, Feed, My Bets, Wagers, Standings, Me, and Admin. One export each,
titles only. `/` is a bare `redirect('/games')` with no UI of its own and gets nothing.

### Icons

Generated in code with `ImageResponse` rather than checked in as binaries — a wordmark glyph,
versionable as a diff, and trivially replaced in 7b when there is an actual brand.

- `src/app/icon.tsx` — the browser-tab and PWA icon
- `src/app/apple-icon.tsx` — 180×180, the iOS home-screen icon
- `src/app/favicon.ico` is **deleted.** A `favicon.ico` at the root of `app/` outranks a
  generated `icon`, and the one in the repo is the stock Next.js file.

The exact `ImageResponse` API and the mechanism for emitting more than one size are to be read
from the bundled Next 16 docs during implementation, not recalled — see
[Constraints](#constraints-the-implementation-must-respect).

### Manifest

`src/app/manifest.ts`, returning `MetadataRoute.Manifest`:

- `name` / `short_name` / `description` matching the root metadata
- `start_url: '/games'` — the app's real front door; `/` only redirects there
- `display: 'standalone'`
- `background_color` and `theme_color` matching the viewport theme colors
- `icons` pointing at the generated icon routes

### Cleanup

`public/file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, and `window.svg` are referenced from
nowhere in `src/`. Deleted.

## Testing

7a is the first UI-layer work in a repo whose 73 test files are all `environment: 'node'` and
all under `src/server`, `src/domain`, `src/db`, or `src/fixtures`. It deliberately does not
change that — see [D51](../decisions.md#d51--ui-conventions-are-tested-structurally-not-with-a-component-test-harness).

### Structural conventions

One new file, `src/app/__tests__/route-conventions.test.ts`, which matches the existing
`src/**/__tests__/**/*.test.ts` glob and needs no new dependency. It walks the filesystem and
asserts:

1. Every top-level feature segment listed in [the table above](#where-boundaries-go-and-why-not-everywhere)
   has a `loading.tsx`.
2. `(app)` has both `error.tsx` and `not-found.tsx`; `admin` has `error.tsx`; the root retains
   `error.tsx`, `global-error.tsx`, and `not-found.tsx`.
3. **Every `page.tsx` that calls `notFound()` sits under a segment with a not-found boundary.**
   This is the assertion that earns its keep. The others describe today's tree; this one stays
   true as routes are added, and fails the day someone adds a detail route with no boundary
   above it.
4. `layout.tsx` contains neither "Create Next App" nor "Generated by create next app".
5. `manifest.ts`, `icon.tsx`, and `apple-icon.tsx` exist, and `favicon.ico` does not.
6. None of the five stock SVGs remain in `public/`.

### The pending-state guard

In the same file or beside it: every file under `src/app` or `src/components` that calls
`useTransition` must also disable a control on the resulting flag. This asserts, rather than
rebuilds, the twelve forms that are already correct — which is the whole of the roadmap's
"pending states on every form" bullet.

The check is a source-text assertion, which is coarse. That is acknowledged and accepted: its
job is to fail loudly when a form is added without a pending state, not to prove the twelve
existing ones are perfect. They were read individually during this design session.

### The browser pass

Structural tests prove the files exist. They cannot prove the boundaries render. Against the
running dev server:

- force a throw in a member page and confirm the error boundary renders **with the header, tab
  bar, and bet slip still present**, that "Try again" resets, and that the digest is visible
- request a nonexistent `/wagers/[wagerId]` and confirm the not-found boundary keeps the shell
- confirm a loading state appears on navigation into a feature segment
- confirm the admin boundary is the admin one, not the root one

Screenshots are the evidence. This is a one-time verification, not a suite.

## The mobile audit

Every screen driven at 375×812 — the iPhone viewport the tab bar and bet slip were designed
around — and written up in `docs/mobile-audit.md`. Per screen: what breaks, how badly, and
which rung owns the fix.

Findings are classified as they are recorded:

- **7b** — anything that is a token or shared-component problem: inconsistent spacing, a tap
  target under 44px, a type size that is only wrong because there is no scale
- **7c** — anything that needs the screen rebuilt: layout that does not reflow, a table that
  overflows
- **7d** — density and craft: the CFB Saturday board, focus states, motion
- **7a** — the rare case where something is *broken*, not ugly: content trapped under the fixed
  tab bar, a horizontal scroll on the body, a form control that cannot be reached. These are in
  scope, because they are the same class of problem as a white screen.

That last bucket is the only path by which the audit adds code to this phase, and it is
expected to be nearly empty. If it is not, that is worth knowing before 7b starts.

## Constraints the implementation must respect

**This is Next.js 16.3.1, and it is not the Next.js in anyone's training data.** Per
[`AGENTS.md`](../../AGENTS.md), the relevant guides under `node_modules/next/dist/docs/` are to
be read before writing any of these files. Specifically:

- `03-file-conventions/error.md`, `loading.md`, `not-found.md`
- `03-file-conventions/01-metadata/app-icons.md`, `manifest.md`
- `04-functions/generate-viewport.md`, `generate-metadata.md`

The `error.tsx` prop signature, the `ImageResponse` import path, the multi-size icon mechanism,
and the `Viewport` type's field names are all things to confirm from those files rather than
recall. The two boundary files that already exist in the repo are a reliable local reference
for the `error.tsx` shape.

**Route type safety.** `npm run typecheck` runs `next typegen` first, and the existing layouts
use generated types like `LayoutProps<'/'>`. New route files should use whatever the generated
types provide rather than hand-written prop types.

## What is deliberately skipped

- **A component-test harness.** jsdom and React Testing Library would buy real coverage of the
  boundary components. They are also infrastructure this project has consciously not had, for
  reasons [`repo-health.md`](../repo-health.md) sets out at length. See
  [D51](../decisions.md#d51--ui-conventions-are-tested-structurally-not-with-a-component-test-harness).
- **An `opengraph-image`.** A link preview matters when links are shared publicly. Every route
  here is behind auth and the app is telling crawlers to go away.
- **`unauthorized.tsx` / `forbidden.tsx`.** Next 16 supports them, but the auth guard redirects
  rather than throwing, and the four dedicated states (`/pending`, `/disabled`, `/no-season`,
  `/join`) already exist as real pages. Phase 9 owns reviewing them as a sequence.
- **A service worker.** The manifest makes the app installable. Offline support is a different
  project, and [D50](../decisions.md#d50--notifications-are-opt-out-email-with-per-type-switches)
  already rejected the PWA capability that would have justified one.

## Open questions carried forward

None. Everything this phase touches is self-contained, and the two questions that could have
grown it — what the mobile audit's findings cost, and what the icon should actually look like —
are answered by deferring them to 7b with a written record.
