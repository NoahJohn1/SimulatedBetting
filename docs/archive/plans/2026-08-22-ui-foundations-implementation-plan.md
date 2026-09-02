# UI Foundations (Phase 7a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every route in the app survive a thrown error, show something during a load, and identify itself as SimulatedBetting in a browser tab and on a phone home screen.

**Architecture:** Two shared presentational components in `src/components/ui/` back eleven thin route-convention files, following the pattern `empty-state.tsx` already set. Root metadata gains a title template, a viewport export, and a noindex directive; icons and the web manifest are generated in code rather than checked in as binaries. A single filesystem-walking node test enforces that the boundaries exist and that no future route slips through without one.

**Tech Stack:** Next.js 16.3.1 (App Router), React 19.2.8, Tailwind CSS v4, TypeScript, Vitest (node environment).

**Spec:** [docs/specs/2026-08-22-ui-foundations-design.md](../specs/2026-08-22-ui-foundations-design.md)

## Global Constraints

- **This is Next.js 16.3.1 and it differs from training data.** Read the relevant guide under `node_modules/next/dist/docs/` before writing each kind of file. The specific ones are named in each task.
- **`error.tsx` takes `retry`, not `reset`.** Next 16's signature is `{ error: Error & { digest?: string }, retry: () => void }`. `reset()` still exists but the docs state you should use `retry()` in most cases: `retry` re-fetches and re-renders, `reset` only clears error state. Every boundary in this plan uses `retry`, and Task 7 migrates the two existing root boundaries.
- **No new dependencies.** No jsdom, no React Testing Library, no icon libraries. See [D51](../decisions.md#d51--ui-conventions-are-tested-structurally-not-with-a-component-test-harness).
- **No restyling.** Inline Tailwind matching the surrounding code. Do not introduce design tokens, do not touch `globals.css` beyond nothing at all, do not refactor existing screens. That is phase 7b.
- **Colors are the two already in the repo:** `#ffffff` (light background) and `#0a0a0a` (dark background), from `src/app/globals.css`. Text greys follow the existing convention: `text-zinc-500 dark:text-zinc-400` for body, `text-zinc-400 dark:text-zinc-600` for de-emphasized.
- **The app's name is `SimulatedBetting`** — one word, no space, as it appears in `README.md` and the header at `src/app/(app)/layout.tsx:29`.
- **Import alias is `@/`**, mapping to `src/`. Follow existing import ordering: external packages, then `@/` imports, then relative.
- **Verification command is `npm run verify`** (typecheck → lint → test). It must pass at the end of every task.
- Commit messages use the repo's lowercase `type: subject` style and end with:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  ```

## File Structure

**Created:**

| File                                                                     | Responsibility                                                                               |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `src/components/ui/status-screen.tsx`                                    | Centered title / body / actions / digest layout. Used by every error and not-found boundary. |
| `src/components/ui/loading-screen.tsx`                                   | Neutral pulsing placeholder with an accessible label. Used by every `loading.tsx`.           |
| `src/app/(app)/error.tsx`                                                | Error boundary for all member pages, rendered inside the shell.                              |
| `src/app/(app)/not-found.tsx`                                            | Not-found boundary for the four `notFound()` calls.                                          |
| `src/app/admin/error.tsx`                                                | Error boundary for admin pages.                                                              |
| `src/app/(app)/{games,events,feed,bets,wagers,standings,me}/loading.tsx` | Seven loading boundaries.                                                                    |
| `src/app/admin/loading.tsx`                                              | Eighth loading boundary.                                                                     |
| `src/app/icon.tsx`                                                       | Generated app icon at 192 and 512.                                                           |
| `src/app/apple-icon.tsx`                                                 | Generated 180×180 iOS home-screen icon.                                                      |
| `src/app/manifest.ts`                                                    | Web app manifest.                                                                            |
| `src/app/__tests__/route-conventions.test.ts`                            | Structural assertions over the route tree.                                                   |
| `docs/mobile-audit.md`                                                   | The audit's findings, classified by owning rung.                                             |

**Modified:** `src/app/layout.tsx` (metadata + viewport), the eight top-level `page.tsx` files (title metadata), `src/app/error.tsx` and `src/app/global-error.tsx` (`reset` → `retry`), `.env.example` (`NEXT_PUBLIC_SITE_URL`).

**Deleted:** `src/app/favicon.ico`, `public/file.svg`, `public/globe.svg`, `public/next.svg`, `public/vercel.svg`, `public/window.svg`.

---

### Task 1: The structural test's skeleton and the shared components

Establishes the test file that every later task extends, and the two components the boundaries render. The test is written first and fails first.

**Files:**

- Create: `src/app/__tests__/route-conventions.test.ts`
- Create: `src/components/ui/status-screen.tsx`
- Create: `src/components/ui/loading-screen.tsx`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `StatusScreen({ title: string; body: string; digest?: string; children?: ReactNode })` from `@/components/ui/status-screen`
  - `LoadingScreen({ label?: string })` from `@/components/ui/loading-screen`
  - In the test file: `APP` (absolute path to `src/app`), `walk(dir: string): string[]` returning absolute paths of every file beneath `dir`.

**Background:** Read `src/components/ui/empty-state.tsx` first. It is fourteen lines and is the pattern these two components follow — a plain function component taking a `title` and optional `body`, no client directive, no state.

- [ ] **Step 1: Write the failing test**

Create `src/app/__tests__/route-conventions.test.ts`:

```ts
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Structural assertions over the route tree. There is no jsdom in this project and no
 * component-test harness (D51), so what these tests can check is which files exist and
 * what they contain as text. That is coarse, and deliberately so — the job is to fail
 * loudly when a route is added without a boundary, not to prove the boundaries are pretty.
 */

const APP = join(process.cwd(), 'src', 'app');
const COMPONENTS = join(process.cwd(), 'src', 'components');

/** Every file beneath `dir`, recursively, as absolute paths. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('shared status components', () => {
  it('exist for the boundaries to render', () => {
    expect(existsSync(join(COMPONENTS, 'ui', 'status-screen.tsx'))).toBe(true);
    expect(existsSync(join(COMPONENTS, 'ui', 'loading-screen.tsx'))).toBe(true);
  });

  it('are shared rather than duplicated: every boundary file delegates to one of them', () => {
    const boundaries = walk(APP).filter((f) => /(?:^|\/)(error|not-found|loading)\.tsx$/.test(f));
    expect(boundaries.length).toBeGreaterThan(0);

    for (const file of boundaries) {
      const source = readFileSync(file, 'utf8');
      expect(
        source.includes('@/components/ui/status-screen') ||
          source.includes('@/components/ui/loading-screen'),
        `${file} should render a shared status component rather than its own markup`,
      ).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
npx vitest run src/app/__tests__/route-conventions.test.ts
```

Expected: both tests FAIL. The first because `status-screen.tsx` does not exist; the second because `src/app/error.tsx` and `src/app/not-found.tsx` currently write their own markup.

- [ ] **Step 3: Write `StatusScreen`**

Create `src/components/ui/status-screen.tsx`:

```tsx
import type { ReactNode } from 'react';

/**
 * The shared layout for every "this screen is not showing you what you asked for" state:
 * error boundaries and not-found boundaries. Rendered inside the app shell, so it sizes
 * itself against the viewport rather than filling it — the header and tab bar are still
 * there and still take space.
 */
export function StatusScreen({
  title,
  body,
  digest,
  children,
}: {
  title: string;
  body: string;
  digest?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 max-w-sm text-balance text-sm text-zinc-500 dark:text-zinc-400">
          {body}
        </p>
      </div>
      {children ? <div className="flex items-center gap-4">{children}</div> : null}
      {/* The digest is the only thread between a member saying "it broke" and a server log
          line. Phase 6 will attach real error reporting; until then this is the whole of it. */}
      {digest ? (
        <p className="font-mono text-xs text-zinc-400 dark:text-zinc-600">Reference {digest}</p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Write `LoadingScreen`**

Create `src/components/ui/loading-screen.tsx`:

```tsx
/**
 * Deliberately not a skeleton. A skeleton that does not match the screen it precedes reads
 * worse than an honest placeholder, and per-screen skeletons are phase 7d's job — this
 * reserves space and says "working" without pretending to predict the layout.
 */
export function LoadingScreen({ label = 'Loading' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6"
    >
      <span className="sr-only">{label}</span>
      <div
        aria-hidden
        className="h-2 w-24 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800"
      />
      <div
        aria-hidden
        className="h-2 w-16 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800"
      />
    </div>
  );
}
```

- [ ] **Step 5: Make the existing root boundaries delegate**

The second test still fails because `src/app/error.tsx` and `src/app/not-found.tsx` write their own markup. Rewrite both to use `StatusScreen`.

`src/app/error.tsx` — note this keeps `reset` for now; Task 7 migrates it:

```tsx
'use client';

import Link from 'next/link';
import { StatusScreen } from '@/components/ui/status-screen';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <StatusScreen
      title="Something went wrong"
      body="That's on us, not on you. Nothing was lost."
      digest={error.digest}
    >
      <button
        type="button"
        onClick={() => reset()}
        className="text-sm font-medium text-zinc-500 underline"
      >
        Try again
      </button>
      <Link href="/" className="text-sm font-medium text-zinc-500 underline">
        Back home
      </Link>
    </StatusScreen>
  );
}
```

`src/app/not-found.tsx`:

```tsx
import Link from 'next/link';
import { StatusScreen } from '@/components/ui/status-screen';

export default function NotFound() {
  return (
    <StatusScreen title="Page not found" body="There's nothing at this address.">
      <Link href="/" className="text-sm font-medium text-zinc-500 underline">
        Back home
      </Link>
    </StatusScreen>
  );
}
```

**Do not touch `src/app/global-error.tsx`.** It renders its own `<html>`/`<body>` with inline styles precisely because the app's CSS may be what failed; importing a Tailwind-styled component into it would defeat that. Exclude it from the test's boundary glob — the regex in Step 1 already does, since it matches `error.tsx` and not `global-error.tsx`. Confirm that by reading the failure output rather than assuming.

- [ ] **Step 6: Run the test and the full gate**

```bash
npx vitest run src/app/__tests__/route-conventions.test.ts
```

Expected: 2 passed.

```bash
npm run verify
```

Expected: typecheck clean, 0 lint errors, all tests pass (546 + 2 new).

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/status-screen.tsx src/components/ui/loading-screen.tsx src/app/error.tsx src/app/not-found.tsx src/app/__tests__/route-conventions.test.ts
git commit -m "$(cat <<'MSG'
feat(ui): add shared status and loading screens

Both root boundaries wrote their own markup; eleven more were about to.
Follows the empty-state.tsx pattern so 7b restyles one file per state.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: Error and not-found boundaries inside the shell

The gap the roadmap did not name: the only boundaries are at the root, so a throw in `/wagers/[wagerId]` destroys the header, tab bar, and bet slip.

**Files:**

- Create: `src/app/(app)/error.tsx`, `src/app/(app)/not-found.tsx`, `src/app/admin/error.tsx`
- Modify: `src/app/__tests__/route-conventions.test.ts`

**Interfaces:**

- Consumes: `StatusScreen` from Task 1.
- Produces: nothing later tasks import. Task 5's test extends the same file.

**Background:** Read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md` and `not-found.md`. Two behaviors to know and not fight:

1. `redirect()` throws a control-flow error that Next resolves _before_ any error boundary. The ten `redirect()` calls in `src/server/auth/session.ts` are unaffected. Do not special-case them.
2. An error boundary renders _inside_ its own segment's layout, so `(app)/error.tsx` cannot catch a throw from `(app)/layout.tsx` itself — including the credits-balance query at `src/app/(app)/layout.tsx:21`. That case correctly falls through to the root boundary. This is why the root boundary stays.

- [ ] **Step 1: Write the failing test**

Append to `src/app/__tests__/route-conventions.test.ts`:

```ts
describe('error and not-found boundaries', () => {
  it('exist inside the app shell and the admin section, not only at the root', () => {
    expect(existsSync(join(APP, '(app)', 'error.tsx'))).toBe(true);
    expect(existsSync(join(APP, '(app)', 'not-found.tsx'))).toBe(true);
    expect(existsSync(join(APP, 'admin', 'error.tsx'))).toBe(true);
  });

  it('keeps the root boundaries, which catch layout failures the shell ones cannot', () => {
    expect(existsSync(join(APP, 'error.tsx'))).toBe(true);
    expect(existsSync(join(APP, 'global-error.tsx'))).toBe(true);
    expect(existsSync(join(APP, 'not-found.tsx'))).toBe(true);
  });

  /**
   * The assertion that earns its keep. The others describe the tree as it stands; this one
   * constrains routes that do not exist yet. Note it deliberately stops the upward walk at
   * the section root — the root not-found.tsx would satisfy every page trivially and prove
   * nothing, because landing there means the shell was destroyed.
   */
  it('gives every notFound() caller a boundary inside its own section', () => {
    const SECTION_ROOTS = ['(app)', 'admin'];

    const callers = walk(APP)
      .filter((f) => f.endsWith('page.tsx'))
      .filter((f) => readFileSync(f, 'utf8').includes('notFound()'));

    expect(callers.length).toBeGreaterThan(0);

    for (const page of callers) {
      const section = SECTION_ROOTS.find((root) => page.startsWith(join(APP, root) + '/'));
      expect(section, `${page} is outside (app) and admin; extend SECTION_ROOTS`).toBeDefined();

      const stopAt = join(APP, section!);
      let dir = join(page, '..');
      let found = false;
      while (dir.length >= stopAt.length) {
        if (existsSync(join(dir, 'not-found.tsx'))) {
          found = true;
          break;
        }
        if (dir === stopAt) break;
        dir = join(dir, '..');
      }

      expect(found, `${page} calls notFound() with no boundary inside ${section}`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
npx vitest run src/app/__tests__/route-conventions.test.ts
```

Expected: the first and third new tests FAIL. The third should name one of `wagers/[wagerId]/page.tsx`, `feed/[eventId]/page.tsx`, `members/[membershipId]/page.tsx`, or `events/[eventId]/page.tsx`. The second passes already.

- [ ] **Step 3: Write the member-facing error boundary**

Create `src/app/(app)/error.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { StatusScreen } from '@/components/ui/status-screen';

/**
 * Renders inside the shell — header, tab bar and bet slip survive, so a member can navigate
 * away instead of reloading. A failure of the shell's own layout falls through to the root
 * boundary, which is what that one is for.
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <StatusScreen
      title="Something went wrong"
      body="That's on us, not on you. No bet was placed and no balance changed."
      digest={error.digest}
    >
      <button
        type="button"
        onClick={() => retry()}
        className="text-sm font-medium text-zinc-500 underline"
      >
        Try again
      </button>
      <Link href="/games" className="text-sm font-medium text-zinc-500 underline">
        Back to games
      </Link>
    </StatusScreen>
  );
}
```

- [ ] **Step 4: Write the member-facing not-found boundary**

Create `src/app/(app)/not-found.tsx`:

```tsx
import Link from 'next/link';
import { StatusScreen } from '@/components/ui/status-screen';

/**
 * Catches the four notFound() calls: a wager, a feed card, a member profile, or an event
 * that either does not exist or is not in the viewer's season. The two cases are
 * deliberately not distinguished — saying "that exists but not for you" leaks whether it
 * exists.
 */
export default function AppNotFound() {
  return (
    <StatusScreen
      title="Not found"
      body="That game, event, wager, or member isn't here — it may not exist, or may not be part of your season."
    >
      <Link href="/games" className="text-sm font-medium text-zinc-500 underline">
        Back to games
      </Link>
    </StatusScreen>
  );
}
```

- [ ] **Step 5: Write the admin error boundary**

Create `src/app/admin/error.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { StatusScreen } from '@/components/ui/status-screen';

export default function AdminError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <StatusScreen
      title="Something went wrong"
      body="An admin screen failed to load. Nothing was resolved, voided, or arbitrated."
      digest={error.digest}
    >
      <button
        type="button"
        onClick={() => retry()}
        className="text-sm font-medium text-zinc-500 underline"
      >
        Try again
      </button>
      <Link href="/admin" className="text-sm font-medium text-zinc-500 underline">
        Back to admin
      </Link>
    </StatusScreen>
  );
}
```

- [ ] **Step 6: Run the test and the full gate**

```bash
npx vitest run src/app/__tests__/route-conventions.test.ts
```

Expected: 5 passed.

```bash
npm run verify
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/error.tsx" "src/app/(app)/not-found.tsx" src/app/admin/error.tsx src/app/__tests__/route-conventions.test.ts
git commit -m "$(cat <<'MSG'
feat(ui): add error and not-found boundaries inside the app shell

Every boundary was at the root, so a throw in any member page replaced
the header, tab bar and bet slip with a bare centered page. These render
inside the shell, so navigating away is still possible.

The notFound() test stops its upward walk at the section root on purpose:
the root not-found.tsx would satisfy every page and prove nothing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: Loading boundaries

Zero exist today. All eighteen pages await database work, so there is no fast route to exempt.

**Files:**

- Create: `src/app/(app)/games/loading.tsx`, `.../events/loading.tsx`, `.../feed/loading.tsx`, `.../bets/loading.tsx`, `.../wagers/loading.tsx`, `.../standings/loading.tsx`, `.../me/loading.tsx`, `src/app/admin/loading.tsx`
- Modify: `src/app/__tests__/route-conventions.test.ts`

**Interfaces:**

- Consumes: `LoadingScreen` from Task 1.
- Produces: nothing.

**Background:** Read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md`. The key fact driving the file count: a `loading.tsx` covers its segment _and everything nested below it_. `feed/loading.tsx` therefore also serves `feed/[eventId]`, and eight files cover all eighteen pages.

`/members/[membershipId]` sits directly under `(app)` with no feature segment of its own and gets no loading state — it inherits `(app)`'s error and not-found boundaries, which is what matters, and one file for one route reached only from the feed and standings is not worth it.

- [ ] **Step 1: Write the failing test**

Append to `src/app/__tests__/route-conventions.test.ts`:

```ts
/**
 * A loading.tsx covers its segment and everything nested below it, so these eight cover all
 * eighteen pages. Adding one per segment instead would produce a dozen identical files that
 * no navigation ever crosses.
 */
const FEATURE_SEGMENTS = [
  join('(app)', 'games'),
  join('(app)', 'events'),
  join('(app)', 'feed'),
  join('(app)', 'bets'),
  join('(app)', 'wagers'),
  join('(app)', 'standings'),
  join('(app)', 'me'),
  'admin',
];

describe('loading boundaries', () => {
  it.each(FEATURE_SEGMENTS)('%s has one', (segment) => {
    expect(existsSync(join(APP, segment, 'loading.tsx'))).toBe(true);
  });

  it('covers every page in the app', () => {
    const uncovered = walk(APP)
      .filter((f) => f.endsWith('page.tsx'))
      .filter((page) => !FEATURE_SEGMENTS.some((s) => page.startsWith(join(APP, s) + '/')))
      // Routes outside the two sections are standalone states with no shell and no
      // meaningful load: /, /sign-in, /join, /pending, /disabled, /no-season, and the
      // one member-profile route that has no feature segment of its own.
      .filter((page) => page.startsWith(join(APP, '(app)') + '/'));

    expect(uncovered.map((f) => f.replace(APP, ''))).toEqual([
      join('/(app)', 'members', '[membershipId]', 'page.tsx'),
    ]);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
npx vitest run src/app/__tests__/route-conventions.test.ts
```

Expected: all eight `it.each` cases FAIL with `expected false to be true`. The coverage test may pass or fail depending on ordering — read the output rather than guessing, and if the array ordering differs from `walk`'s traversal order, sort both sides before comparing.

- [ ] **Step 3: Create all eight loading files**

Each is three lines. The label differs per segment because it is read aloud by a screen reader.

```bash
set -e
cd "$(git rev-parse --show-toplevel)"

write_loading() {
  local path="$1" label="$2"
  cat > "$path" <<EOF
import { LoadingScreen } from '@/components/ui/loading-screen';

export default function Loading() {
  return <LoadingScreen label="Loading $label" />;
}
EOF
}

write_loading 'src/app/(app)/games/loading.tsx'     'games'
write_loading 'src/app/(app)/events/loading.tsx'    'events'
write_loading 'src/app/(app)/feed/loading.tsx'      'the feed'
write_loading 'src/app/(app)/bets/loading.tsx'      'your bets'
write_loading 'src/app/(app)/wagers/loading.tsx'    'wagers'
write_loading 'src/app/(app)/standings/loading.tsx' 'standings'
write_loading 'src/app/(app)/me/loading.tsx'        'your profile'
write_loading 'src/app/admin/loading.tsx'           'admin'
```

- [ ] **Step 4: Run the test and the full gate**

```bash
npx vitest run src/app/__tests__/route-conventions.test.ts
```

Expected: all loading tests pass.

```bash
npm run verify
```

Expected: all green. If lint complains about the generated files' formatting, fix the heredoc rather than adding an eslint-disable.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)"/*/loading.tsx src/app/admin/loading.tsx src/app/__tests__/route-conventions.test.ts
git commit -m "$(cat <<'MSG'
feat(ui): add loading boundaries to every feature segment

Eight files, not eighteen: a loading.tsx covers its segment and
everything nested below it, so feed/ also serves feed/[eventId].

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: Metadata, viewport, and per-page titles

The root layout still exports the `create-next-app` default.

**Files:**

- Modify: `src/app/layout.tsx`
- Modify: `src/app/(app)/{games,events,feed,bets,wagers,standings,me}/page.tsx`, `src/app/admin/page.tsx`
- Modify: `.env.example`
- Modify: `src/app/__tests__/route-conventions.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: a `%s · SimulatedBetting` title template, which is why each page exports only its own short title.

**Background:** Read `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md` and `generate-viewport.md`. Two rules that will bite otherwise: `viewport` must be a **separate export** from `metadata` — Next 16 rejects viewport fields inside `metadata` — and both are only supported in Server Components, which every `page.tsx` here already is.

- [ ] **Step 1: Write the failing test**

Append to `src/app/__tests__/route-conventions.test.ts`:

```ts
describe('metadata', () => {
  const layout = () => readFileSync(join(APP, 'layout.tsx'), 'utf8');

  it('no longer reports the app as a create-next-app scaffold', () => {
    expect(layout()).not.toContain('Create Next App');
    expect(layout()).not.toContain('Generated by create next app');
  });

  it('names the app and keeps it out of search indexes', () => {
    expect(layout()).toContain('SimulatedBetting');
    // A private group behind Google OAuth has no business in an index, and every route
    // requiring auth is not a reason to skip saying so.
    expect(layout()).toContain('index: false');
  });

  it('exports viewport separately from metadata, as Next 16 requires', () => {
    expect(layout()).toMatch(/export const viewport: Viewport/);
    expect(layout()).toContain("width: 'device-width'");
    // The tab bar is fixed to the bottom, so a notched phone needs the full screen.
    expect(layout()).toContain("viewportFit: 'cover'");
  });

  const TITLED_PAGES = [
    join('(app)', 'games'),
    join('(app)', 'events'),
    join('(app)', 'feed'),
    join('(app)', 'bets'),
    join('(app)', 'wagers'),
    join('(app)', 'standings'),
    join('(app)', 'me'),
    'admin',
  ];

  it.each(TITLED_PAGES)('%s exports its own title', (segment) => {
    const source = readFileSync(join(APP, segment, 'page.tsx'), 'utf8');
    expect(source).toMatch(/export const metadata: Metadata = \{\s*title:/);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
npx vitest run src/app/__tests__/route-conventions.test.ts
```

Expected: every test in the new block FAILS.

- [ ] **Step 3: Rewrite the root layout's metadata**

Replace the `import` line and the `metadata` export in `src/app/layout.tsx`. The rest of the file — the two Geist fonts and the `RootLayout` component — stays exactly as it is.

```tsx
import type { Metadata, Viewport } from 'next';
```

```tsx
// Set on the deployment; localhost is the local fallback. Phase 6 supplies the real value.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    // Pages export a short title; this appends the app name once, in one place.
    default: 'SimulatedBetting',
    template: '%s · SimulatedBetting',
  },
  description:
    'A play-money sportsbook for a small private group. No real money is involved at any point.',
  applicationName: 'SimulatedBetting',
  appleWebApp: { capable: true, title: 'SimulatedBetting', statusBarStyle: 'default' },
  // A private group behind Google OAuth. Requiring auth on every route is not a reason
  // to skip telling crawlers to stay away.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The tab bar is fixed to the bottom; a notched phone needs the whole screen.
  viewportFit: 'cover',
  // The two values already defined in globals.css, so browser chrome stops fighting
  // the app's background.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
};
```

- [ ] **Step 4: Add the env var to `.env.example`**

Append to `.env.example`:

```
# Absolute origin of the deployment, used as metadataBase so icons and the manifest
# resolve. Defaults to http://localhost:3000 when unset.
NEXT_PUBLIC_SITE_URL=
```

- [ ] **Step 5: Add a title to each of the eight top-level pages**

For each page, add the `Metadata` type import to the existing imports and export a title above the default export. The titles, exactly:

| File                               | Title         |
| ---------------------------------- | ------------- |
| `src/app/(app)/games/page.tsx`     | `'Games'`     |
| `src/app/(app)/events/page.tsx`    | `'Events'`    |
| `src/app/(app)/feed/page.tsx`      | `'Feed'`      |
| `src/app/(app)/bets/page.tsx`      | `'My Bets'`   |
| `src/app/(app)/wagers/page.tsx`    | `'Wagers'`    |
| `src/app/(app)/standings/page.tsx` | `'Standings'` |
| `src/app/(app)/me/page.tsx`        | `'Me'`        |
| `src/app/admin/page.tsx`           | `'Admin'`     |

Each addition looks like this — shown for `games`, identical in shape for the rest:

```tsx
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Games' };
```

`/` is a bare `redirect('/games')` with no UI and gets nothing. Detail routes inherit the template default; per-entity titles are 7c's business, when those screens are rebuilt anyway.

- [ ] **Step 6: Run the test and the full gate**

```bash
npx vitest run src/app/__tests__/route-conventions.test.ts
```

Expected: all metadata tests pass.

```bash
npm run verify
```

Expected: all green. If typecheck complains that `viewport` conflicts with `metadata`, re-read `generate-viewport.md` — the two cannot both carry viewport fields.

- [ ] **Step 7: Commit**

```bash
git add src/app/layout.tsx "src/app/(app)"/*/page.tsx src/app/admin/page.tsx .env.example src/app/__tests__/route-conventions.test.ts
git commit -m "$(cat <<'MSG'
feat(ui): real metadata, viewport, and per-page titles

The root layout still called the app "Create Next App". Adds a title
template, a description, theme colors matching globals.css, viewportFit
for the fixed bottom tab bar, and robots noindex — this is a private
group and has no business in a search index.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: Icons, manifest, and removing the scaffold assets

**Files:**

- Create: `src/app/icon.tsx`, `src/app/apple-icon.tsx`, `src/app/manifest.ts`
- Delete: `src/app/favicon.ico`, `public/file.svg`, `public/globe.svg`, `public/next.svg`, `public/vercel.svg`, `public/window.svg`
- Modify: `src/app/__tests__/route-conventions.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: the routes `/icon/192`, `/icon/512`, and `/apple-icon`, which `manifest.ts` references.

**Background:** Read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/app-icons.md`, `manifest.md`, and `04-functions/generate-image-metadata.md`. Three facts that decide the shape of this task:

1. `ImageResponse` is imported from **`next/og`**.
2. A `favicon.ico` at the root of `app/` outranks a generated `icon`, so the stock one must be deleted or the generated icon never appears.
3. `generateImageMetadata` passes `id` to the default export as a **Promise** in this version — `async function Icon({ id }: { id: Promise<string | number> })`, awaited inside.

The five SVGs in `public/` are referenced from nowhere in `src/`; confirm with `grep -rn "next.svg\|vercel.svg\|globe.svg\|window.svg\|file.svg" src/` returning nothing before deleting.

- [ ] **Step 1: Write the failing test**

Append to `src/app/__tests__/route-conventions.test.ts`:

```ts
describe('icons and manifest', () => {
  it('generates its icons in code', () => {
    expect(existsSync(join(APP, 'icon.tsx'))).toBe(true);
    expect(existsSync(join(APP, 'apple-icon.tsx'))).toBe(true);
  });

  it('has no favicon.ico, which would outrank the generated icon', () => {
    expect(existsSync(join(APP, 'favicon.ico'))).toBe(false);
  });

  it('ships a web manifest so the app installs to a home screen', () => {
    const manifest = join(APP, 'manifest.ts');
    expect(existsSync(manifest)).toBe(true);
    const source = readFileSync(manifest, 'utf8');
    expect(source).toContain("display: 'standalone'");
    // "/" only redirects; /games is the real front door.
    expect(source).toContain("start_url: '/games'");
  });

  it('has none of the create-next-app scaffold assets left', () => {
    const publicDir = join(process.cwd(), 'public');
    const stock = ['file.svg', 'globe.svg', 'next.svg', 'vercel.svg', 'window.svg'];
    const remaining = stock.filter((f) => existsSync(join(publicDir, f)));
    expect(remaining).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
npx vitest run src/app/__tests__/route-conventions.test.ts
```

Expected: all four FAIL.

- [ ] **Step 3: Write the app icon**

Create `src/app/icon.tsx`:

```tsx
import { ImageResponse } from 'next/og';

/**
 * A wordmark generated in code rather than a checked-in binary: it reviews as a diff, and
 * 7b can replace it the moment there is an actual brand. Two sizes because a web manifest
 * wants 192 and 512 for a home-screen install.
 */
export function generateImageMetadata() {
  return [
    {
      id: '192',
      contentType: 'image/png',
      size: { width: 192, height: 192 },
      alt: 'SimulatedBetting',
    },
    {
      id: '512',
      contentType: 'image/png',
      size: { width: 512, height: 512 },
      alt: 'SimulatedBetting',
    },
  ];
}

export default async function Icon({ id }: { id: Promise<string | number> }) {
  const side = Number(await id);

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0a0a0a',
        color: '#fafafa',
        fontSize: side * 0.44,
        fontWeight: 700,
        letterSpacing: side * -0.02,
      }}
    >
      SB
    </div>,
    { width: side, height: side },
  );
}
```

- [ ] **Step 4: Write the iOS icon**

Create `src/app/apple-icon.tsx`. iOS applies its own rounded mask and does not honor transparency, so this is a filled square at the one size iOS asks for:

```tsx
import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0a0a0a',
        color: '#fafafa',
        fontSize: 79,
        fontWeight: 700,
        letterSpacing: -3,
      }}
    >
      SB
    </div>,
    { ...size },
  );
}
```

- [ ] **Step 5: Write the manifest**

Create `src/app/manifest.ts`:

```ts
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SimulatedBetting',
    short_name: 'SimBet',
    description:
      'A play-money sportsbook for a small private group. No real money is involved at any point.',
    // "/" only redirects here; this is the real front door.
    start_url: '/games',
    display: 'standalone',
    // Matches the viewport theme colors in layout.tsx.
    background_color: '#0a0a0a',
    theme_color: '#0a0a0a',
    icons: [
      { src: '/icon/192', sizes: '192x192', type: 'image/png' },
      { src: '/icon/512', sizes: '512x512', type: 'image/png' },
    ],
  };
}
```

- [ ] **Step 6: Delete the scaffold assets**

```bash
git rm src/app/favicon.ico public/file.svg public/globe.svg public/next.svg public/vercel.svg public/window.svg
```

- [ ] **Step 7: Verify the generated routes actually resolve**

This is the one step of this task a filesystem test cannot cover. The manifest references `/icon/192` and `/icon/512` without the cache-busting query Next appends to its own `<link>` tags, and if those bare paths do not resolve the install silently falls back to no icon.

Start the dev server through the preview tooling, then:

```bash
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://localhost:3000/icon/512
```

Expected: `200 image/png`. Repeat for `/icon/192` and `/apple-icon`.

```bash
curl -s http://localhost:3000/manifest.webmanifest
```

Expected: the JSON above. If the path 404s, check whether this Next version serves it at `/manifest.json` instead and read `manifest.md` for which.

If `/icon/512` does not resolve, do not paper over it — collapse `icon.tsx` to a single 512 icon without `generateImageMetadata` and point both manifest entries at `/icon`, then re-run these checks.

- [ ] **Step 8: Run the test and the full gate**

```bash
npx vitest run src/app/__tests__/route-conventions.test.ts && npm run verify && npm run build
```

Expected: tests pass, verify green, and the build compiles — `next build` is the only thing that exercises the `ImageResponse` routes' module resolution.

- [ ] **Step 9: Commit**

```bash
git add src/app/icon.tsx src/app/apple-icon.tsx src/app/manifest.ts src/app/__tests__/route-conventions.test.ts
git commit -m "$(cat <<'MSG'
feat(ui): generated app icons and a web manifest

Icons are ImageResponse routes rather than checked-in binaries, so they
review as a diff and 7b can replace them when there is a real brand.
Deletes the stock favicon.ico, which outranks a generated icon, and the
five create-next-app SVGs that nothing referenced.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: The pending-state regression guard

The roadmap lists "pending states on every form" as missing. It is not — all twelve client forms already use `useTransition` and disable their submit control. This task asserts that rather than rebuilding it.

**Files:**

- Modify: `src/app/__tests__/route-conventions.test.ts`

**Interfaces:**

- Consumes: `walk` from Task 1.
- Produces: nothing.

**Background:** This is a characterization test. It passes on the first run, and that is the expected result — the point is that it fails on the _thirteenth_ form. Step 2 proves it has teeth by breaking a form on purpose and watching it fail, then reverting.

- [ ] **Step 1: Write the test**

Append to `src/app/__tests__/route-conventions.test.ts`:

```ts
describe('form pending states', () => {
  /**
   * A source-text assertion, and a coarse one — it can be defeated by a form that names its
   * flag something else. Its job is to fail when a form is added with no pending state at
   * all, which is the failure that actually happens. The twelve that exist were read
   * individually during the 7a design session.
   */
  it('every form that submits through a transition disables a control while it runs', () => {
    const roots = [APP, COMPONENTS];
    const offenders: string[] = [];

    for (const root of roots) {
      for (const file of walk(root)) {
        if (!file.endsWith('.tsx')) continue;
        const source = readFileSync(file, 'utf8');
        if (!source.includes('useTransition')) continue;
        if (!/disabled=\{[^}]*pending/.test(source)) {
          offenders.push(file.replace(process.cwd(), ''));
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('covers the forms it is supposed to cover', () => {
    const withTransition = [APP, COMPONENTS]
      .flatMap((root) => walk(root))
      .filter((f) => f.endsWith('.tsx'))
      .filter((f) => readFileSync(f, 'utf8').includes('useTransition'));

    // Guards against the check silently passing because it stopped finding any forms.
    expect(withTransition.length).toBeGreaterThanOrEqual(12);
  });
});
```

- [ ] **Step 2: Prove the test has teeth**

Temporarily break one form:

```bash
sed -i '' 's/disabled={pending}/disabled={false}/' "src/app/(app)/events/[eventId]/dispute-form.tsx"
npx vitest run src/app/__tests__/route-conventions.test.ts
```

Expected: FAIL, naming `dispute-form.tsx` in the offenders array.

Revert:

```bash
git checkout -- "src/app/(app)/events/[eventId]/dispute-form.tsx"
```

- [ ] **Step 3: Run the test and the full gate**

```bash
npx vitest run src/app/__tests__/route-conventions.test.ts && npm run verify
```

Expected: all green, and `git status` clean apart from the test file.

- [ ] **Step 4: Commit**

```bash
git add src/app/__tests__/route-conventions.test.ts
git commit -m "$(cat <<'MSG'
test(ui): guard form pending states against regression

The roadmap listed these as missing; all twelve forms already have them.
This asserts what exists rather than rebuilding it, so the thirteenth
form cannot ship without one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 7: Migrate the root boundaries from `reset` to `retry`

**Files:**

- Modify: `src/app/error.tsx`, `src/app/global-error.tsx`
- Modify: `src/app/__tests__/route-conventions.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: nothing.

**Background:** Read the `retry` and `reset` sections of `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`. In Next 16 an error boundary receives `retry`, which re-fetches and re-renders the boundary's children, and `reset`, which only clears error state without re-fetching. The docs are explicit that `retry` is what you want in most cases. Both existing root boundaries were written against `reset`, so a member clicking "Try again" on a transient database failure gets the same failed render back. This is a behavior fix, not a rename.

- [ ] **Step 1: Write the failing test**

Append to `src/app/__tests__/route-conventions.test.ts`:

```ts
describe('error boundary recovery', () => {
  it('uses retry(), which re-fetches, rather than reset(), which does not', () => {
    const boundaries = walk(APP).filter((f) => /(?:^|\/)(global-)?error\.tsx$/.test(f));
    expect(boundaries.length).toBe(4);

    for (const file of boundaries) {
      const source = readFileSync(file, 'utf8');
      expect(source, `${file} should offer retry()`).toContain('retry');
      expect(source, `${file} still uses reset(), which does not re-fetch`).not.toContain('reset');
    }
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
npx vitest run src/app/__tests__/route-conventions.test.ts
```

Expected: FAIL, naming `src/app/error.tsx` and `src/app/global-error.tsx`. The count assertion should already pass — the four are root `error.tsx`, root `global-error.tsx`, `(app)/error.tsx`, and `admin/error.tsx`.

- [ ] **Step 3: Migrate the root boundary**

In `src/app/error.tsx`, change the prop and the handler. Nothing else in the file changes:

```tsx
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
```

```tsx
        onClick={() => retry()}
```

- [ ] **Step 4: Migrate the global boundary**

In `src/app/global-error.tsx`, make the same two changes. Leave everything else exactly as it is — the inline styles, the plain `<a>` instead of `next/link`, and the `<html>`/`<body>` wrapper are all deliberate, and the file's own comments explain why.

```tsx
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
```

```tsx
            onClick={() => retry()}
```

- [ ] **Step 5: Run the test and the full gate**

```bash
npx vitest run src/app/__tests__/route-conventions.test.ts && npm run verify
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/app/error.tsx src/app/global-error.tsx src/app/__tests__/route-conventions.test.ts
git commit -m "$(cat <<'MSG'
fix(ui): error boundaries retry() instead of reset()

Next 16 gives boundaries both. retry() re-fetches and re-renders the
boundary's children; reset() only clears error state, so "Try again" on
a transient failure re-rendered the same failure. Both root boundaries
were written against reset.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 8: Browser verification

Structural tests prove the files exist. They cannot prove a boundary renders, that the shell survives, or that the digest is legible. This task is evidence, not code.

**Files:** none created or modified.

**Interfaces:**

- Consumes: everything from Tasks 1–7.
- Produces: screenshots, and a bug fixed in place if any check fails.

**Background:** The database must be running (`npm run db:up`) and seeded (`npm run db:seed`) with a signed-in approved member, or every route redirects to `/sign-in` and nothing below is reachable. Start the dev server through the preview tooling, never through `npm run dev` in a bash call.

- [ ] **Step 1: Start the app and sign in**

```bash
npm run db:up && npm run db:seed
```

Start the dev server via the preview tooling and sign in as a seeded approved member. Confirm `/games` renders with the header, tab bar, and balance.

- [ ] **Step 2: Verify the member-facing error boundary**

Temporarily add a throw at the top of the `GamesPage` component body in `src/app/(app)/games/page.tsx`:

```tsx
throw new Error('7a boundary check');
```

Load `/games` and confirm all four:

- the error boundary renders, **with the header, tab bar, and bet slip still on screen**
- "Try again" is present and clicking it re-renders
- "Back to games" navigates
- a `Reference <digest>` line is visible

Screenshot it. Then remove the throw and confirm `/games` renders normally again.

- [ ] **Step 3: Verify the not-found boundary**

Navigate to `/wagers/00000000-0000-0000-0000-000000000000`. Confirm the not-found boundary renders **inside the shell** — not the bare root one. Screenshot.

- [ ] **Step 4: Verify the admin boundary is the admin one**

Add the same temporary throw to `src/app/admin/page.tsx`, load `/admin`, and confirm the copy reads "An admin screen failed to load" and the link goes back to `/admin` — proving `admin/error.tsx` caught it rather than the root boundary. Screenshot, then remove the throw.

- [ ] **Step 5: Verify a loading state appears**

Add a temporary delay above the queries in `src/app/(app)/standings/page.tsx`:

```tsx
await new Promise((resolve) => setTimeout(resolve, 2000));
```

Navigate to `/standings` from another tab and confirm the pulsing placeholder appears. Screenshot, then remove the delay.

- [ ] **Step 6: Verify the metadata and icons in the browser**

- The browser tab reads `Games · SimulatedBetting`
- The tab icon is the generated `SB` mark, not the Next.js logo. Hard-reload if the old favicon is cached.
- The document head contains `<meta name="robots" content="noindex, nofollow">`

- [ ] **Step 7: Confirm the tree is clean**

```bash
git status --short
```

Expected: empty. Every temporary throw and delay removed.

```bash
npm run verify
```

Expected: all green.

- [ ] **Step 8: Report**

No commit — nothing changed. Report each check as pass or fail with its screenshot. If any failed, fix it in the relevant task's files, re-verify, and commit that fix on its own.

---

### Task 9: The mobile audit

**Files:**

- Create: `docs/mobile-audit.md`

**Interfaces:**

- Consumes: a running, seeded app.
- Produces: a document that is 7b's input.

**Background:** The deliverable is the document. Findings are **not** fixed here — an inline-Tailwind screen that reads badly at 375px is going to be rebuilt in 7c anyway, and fixing it twice is waste. The one exception is a finding that makes a screen _unusable_ rather than ugly: content trapped under the fixed tab bar, a horizontal scroll on `<body>`, a control that cannot be reached or tapped. Those are the same class of problem as a white screen and are fixed in this task, in a separate commit.

- [ ] **Step 1: Set the viewport and walk every screen**

Resize the preview to 375×812 and visit all eighteen routes, signed in as an approved member and again as an admin:

`/games` · `/events` · `/events/new` · `/events/[eventId]` · `/events/[eventId]/resolve` · `/feed` · `/feed/[eventId]` · `/bets` · `/wagers` · `/wagers/new` · `/wagers/[wagerId]` · `/standings` · `/me` · `/me/feed-preferences` · `/members/[membershipId]` · `/admin` · `/admin/events` · `/admin/wagers`

Also exercise the bet slip with a single leg and with three legs — it is fixed-position and overlaps the tab bar, which is the most likely source of a genuine 7a finding.

For each screen record: what breaks, how badly, and which rung owns the fix.

- [ ] **Step 2: Write the document**

Create `docs/mobile-audit.md` with this structure. It is a template for the shape, not for the content — replace every finding with a real one:

```markdown
# Mobile audit — 375×812

Every screen viewed at the iPhone viewport the tab bar and bet slip were designed around,
during [phase 7a](specs/2026-08-22-ui-foundations-design.md). Findings are recorded, not
fixed: anything that is merely ugly belongs to the rung that rebuilds the screen anyway.

**Classification.** `7a` — broken, not ugly; fixed immediately and noted as such.
`7b` — a token or shared-component problem. `7c` — needs the screen rebuilt.
`7d` — density and craft.

## Summary

<one paragraph: how the app reads on a phone, and the two or three things that matter most>

## Findings

| Screen   | Finding       | Severity                          | Rung |
| -------- | ------------- | --------------------------------- | ---- |
| `/games` | <what breaks> | <blocks use / awkward / cosmetic> | 7c   |

## Screens with nothing to report

<list them — a screen that is fine is worth recording as fine>
```

- [ ] **Step 3: Fix only the `7a` findings, if there are any**

If Step 1 turned up something that makes a screen unusable, fix it now, minimally, and mark it `7a — fixed` in the table. Expect this bucket to be nearly empty. If it is large, say so plainly in the summary — that is worth knowing before 7b is scoped.

- [ ] **Step 4: Run the full gate**

```bash
npm run verify
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add docs/mobile-audit.md
git commit -m "$(cat <<'MSG'
docs: record the 375px mobile audit

Findings only. Anything merely ugly belongs to the rung that rebuilds
the screen; this is 7b's input, not 7a's backlog.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 10: Close out the phase

**Files:**

- Modify: `docs/roadmap.md`
- Modify: `README.md`

- [ ] **Step 1: Mark 7a built in the roadmap**

In `docs/roadmap.md`, change the 7a section's status line from **Specified** to **Built**, and update the four bullets under it to describe what shipped rather than what was planned. Keep the note about what the original description got wrong — it is the reason the phase was scoped the way it was.

- [ ] **Step 2: Update the README's status paragraph**

`README.md` says "The odds board is still fixture data and nothing is deployed yet." That stays true. Add nothing about 7a unless the test count changed materially — if it did, update the "73 test files / 546 tests" figure to the real one from `npm run verify`.

- [ ] **Step 3: Run the full gate one last time**

```bash
npm run verify && npm run build
```

Expected: both green.

- [ ] **Step 4: Commit and open the pull request**

```bash
git add docs/roadmap.md README.md
git commit -m "$(cat <<'MSG'
docs: mark phase 7a built

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

Then open a PR against `main` summarizing: boundaries inside the shell, eight loading states, real metadata and generated icons, the `reset` → `retry` fix, and the mobile audit as 7b's input.
