# Design System (Phase 7b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the vocabulary the app is written in — a two-tier semantic token layer, dark mode defined once, and a small set of shared components with real call sites — so every screen speaks one language and 7c has something to rebuild against.

**Architecture:** `src/app/globals.css` becomes the entire token layer: private colour ramps (Tier 1), thirty semantic tokens (Tier 2), and an `@theme inline` block exposing Tier 2 as Tailwind utilities. Dark mode redefines Tier 2 and nothing else. Five new components and six retokenized ones live in `src/components/ui/`. Every `.tsx` file is then swept onto the vocabulary — colour and `dark:` variants only — under a ratcheting lint test that starts with every file baselined and ends with the baseline empty.

**Tech Stack:** Next.js 16.3.1 (App Router), React 19.2.8, Tailwind CSS v4.3.3 (CSS-first, no config file), TypeScript, Vitest (node environment).

**Spec:** [docs/specs/2026-08-24-design-system-design.md](../specs/2026-08-24-design-system-design.md)

## Global Constraints

- **Run `npm install` before anything else.** `node_modules/` is not checked in, and this plan reads Next's bundled docs from it.
- **This is Next.js 16.3.1 and Tailwind v4.3.3; both differ from training data.** Read `node_modules/next/dist/docs/01-app/01-getting-started/11-css.md` before touching `globals.css`. There is **no `tailwind.config.ts`** in Tailwind v4 and this phase does not add one — all configuration is CSS.
- **No new dependencies.** No jsdom, no React Testing Library, no `clsx`, no `tailwind-merge`, no `cva`, no icon library. The runtime dependency list stays at five ([D53](../decisions.md#d53--the-shared-component-set-is-scoped-to-call-sites-that-exist), [D54](../decisions.md#d54--a-token-lint-test-is-the-harness-7b-earns-revisiting-d51)).
- **No screen redesign.** Layout, spacing, font sizes, and radii on existing markup are not touched. Only colour classes and `dark:` variants change. If you find yourself moving an element, you have left the phase.
- **The sweep matches light/dark *pairs*, not individual classes.** `bg-zinc-50` is `bg-surface` when paired with `dark:bg-black` and `bg-surface-sunken` when paired with `dark:bg-zinc-900`. Read the partner before choosing the token.
- **Only four visual changes are permitted** (spec, "Declared visible changes"): `dark:bg-zinc-50` collapses into `--accent` with `dark:bg-zinc-100`; the four amber chips in `feed-card.tsx` gain a dark treatment they never had; the bet slip's shadow becomes visible in dark mode; and a control adopted into `Button` takes `Button`'s radius. Anything else the browser audit finds is a bug to fix.
- **Tier 1 is private.** No `.tsx` file may name `--n-*`, `--pos-*`, `--neg-*`, or `--cau-*`. Only Tier 2 reads them, and only inside `globals.css`.
- **Import alias is `@/`**, mapping to `src/`. Import ordering: external packages, then `@/`, then relative.
- **Verification command is `npm run verify`** (typecheck → lint → test). It must pass at the end of every task.
- **Tests live at `src/**/__tests__/**/*.test.ts`** — that is the vitest `include` glob, and a test placed anywhere else silently never runs.
- Commit messages use the repo's lowercase `type: subject` style and end with:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  ```

## Two traps that will cost you an hour each

Both were verified by compiling Tailwind 4.3.3 directly. Neither is guessable from the source.

1. **`@theme inline` does not emit its variables into `:root`.** `@theme inline { --color-surface: var(--surface); }` generates `.bg-surface { background-color: var(--surface); }` and emits **no** `--color-surface` anywhere. That is exactly what makes scoped dark-mode overrides work — but it also means **you cannot write `var(--color-surface)` or `var(--font-sans)` in hand-written CSS.** They do not exist at runtime. Hand-written CSS must name the Tier 2 variable directly (`var(--surface)`, `var(--font-geist-sans)`). This is the specific reason the `body` font rule in Task 1 uses `var(--font-geist-sans)` and not `var(--font-sans)`.

2. **A theme variable may not reference a runtime variable of the same name.** `@theme inline { --shadow-slip: var(--shadow-slip); }` is a self-reference and resolves to nothing. The colour tokens are safe because the theme name (`--color-surface`) differs from the runtime name (`--surface`). The shadow is not, so its runtime name is **`--slip-shadow`** and its theme name is `--shadow-slip`, giving the utility `shadow-slip`.

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `src/components/ui/button.tsx` | `Button` plus the `buttonClasses(variant, size)` export that `<Link>` call sites apply. |
| `src/components/ui/card.tsx` | The bordered raised surface every screen repeats. |
| `src/components/ui/callout.tsx` | Tone-scoped notice box over `--{tone}-surface-soft`. |
| `src/components/ui/segmented-control.tsx` | Link-based two-or-more-way control (Bets \| Wagers, Cash \| Credits). |
| `src/components/ui/form-field.tsx` | Label + control + hint + error wrapper. |
| `src/app/__tests__/token-layer.test.ts` | Asserts `globals.css` defines every Tier 2 token in light and both dark blocks, and that the two dark blocks are textually identical. |
| `src/app/__tests__/token-lint.test.ts` | The ratchet. Fails on raw palette classes and `dark:` variants outside the allowlist and the shrinking baseline. |
| `docs/design-system-audit.md` | The browser pass: 18 routes × 2 themes × 2 viewports. |

**Modified:** `src/app/globals.css` (becomes the token layer), `src/app/layout.tsx` (`themeColor` values), `src/components/ui/{badge,money,empty-state,status-screen,loading-screen,tab-bar}.tsx`, and all 55 remaining `.tsx` files under `src/app` and `src/components` during the sweep.

**Deleted:** nothing.

---

### Task 1: The token layer

The whole phase rests on this file. Everything after it is mechanical.

**Files:**
- Modify: `src/app/globals.css` (complete rewrite — the current file is 24 lines of `create-next-app` default)
- Modify: `src/app/layout.tsx` (the two `themeColor` hex values)
- Create: `src/app/__tests__/token-layer.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the Tailwind utilities every later task uses —
  - Backgrounds: `bg-surface`, `bg-surface-raised`, `bg-surface-sunken`, `bg-surface-muted`, `bg-surface-skeleton`
  - Borders: `border-line`, `border-line-strong`, `border-line-hover`, `border-line-subtle`
  - Text: `text-ink`, `text-ink-secondary`, `text-ink-muted`, `text-ink-subtle`
  - Accent: `bg-accent`, `text-accent`, `border-accent`, `text-accent-ink`, `bg-accent-ink`
  - Tones, for each of `positive` / `negative` / `caution`: `text-{tone}`, `bg-{tone}-surface`, `bg-{tone}-surface-soft`, `border-{tone}-line`, `text-{tone}-on-surface`
  - Radii: `rounded-card`, `rounded-control`, `rounded-pill`
  - Shadow: `shadow-slip`
  - Every colour utility also accepts an opacity modifier (`bg-surface-raised/90`), which compiles to a `color-mix()` guarded by `@supports` with the solid colour as fallback.

**Background:** Read `node_modules/next/dist/docs/01-app/01-getting-started/11-css.md` first. Then re-read the two traps above — they are the whole difficulty of this task.

- [ ] **Step 1: Write the failing test**

Create `src/app/__tests__/token-layer.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Structural assertions over the token layer (D52). The dark palette has to be written
 * twice — once under the media query, once under [data-theme="dark"] — because CSS has no
 * way to share a declaration block across a media boundary. Duplication that a human keeps
 * in sync drifts; duplication a test keeps in sync does not. That is what these assertions
 * are for.
 */

const CSS = readFileSync(join(process.cwd(), 'src', 'app', 'globals.css'), 'utf8');

/** The thirty semantic names, plus the one shadow. Tier 1 ramps are deliberately absent. */
const TIER_2 = [
  'surface', 'surface-raised', 'surface-sunken', 'surface-muted', 'surface-skeleton',
  'line', 'line-strong', 'line-hover', 'line-subtle',
  'ink', 'ink-secondary', 'ink-muted', 'ink-subtle',
  'accent', 'accent-ink',
  'positive', 'positive-surface', 'positive-surface-soft', 'positive-line', 'positive-on-surface',
  'negative', 'negative-surface', 'negative-surface-soft', 'negative-line', 'negative-on-surface',
  'caution', 'caution-surface', 'caution-surface-soft', 'caution-line', 'caution-on-surface',
  'slip-shadow',
];

/** Every `--name:` declared in a chunk of CSS, in source order. */
function declared(block: string): string[] {
  return [...block.matchAll(/^\s*--([a-z0-9-]+)\s*:/gim)].map((m) => m[1]);
}

/** The two dark palettes, delimited by marker comments so the test can compare them. */
function darkBlocks(): string[] {
  return [...CSS.matchAll(/\/\* DARK-PALETTE-START \*\/([\s\S]*?)\/\* DARK-PALETTE-END \*\//g)]
    .map((m) => m[1]);
}

describe('the token layer', () => {
  it('declares all thirty-one Tier 2 tokens in the light palette', () => {
    const light = CSS.slice(
      CSS.indexOf('/* LIGHT-PALETTE-START */'),
      CSS.indexOf('/* LIGHT-PALETTE-END */'),
    );
    for (const token of TIER_2) {
      expect(declared(light), `--${token} missing from the light palette`).toContain(token);
    }
  });

  it('writes the dark palette exactly twice — the media query and the attribute', () => {
    expect(darkBlocks()).toHaveLength(2);
  });

  it('keeps the two dark palettes byte-identical', () => {
    const [viaMedia, viaAttribute] = darkBlocks();
    // Normalize indentation only: the two blocks sit at different nesting depths.
    const strip = (s: string) => s.replace(/^[ \t]+/gm, '').trim();
    expect(strip(viaMedia)).toBe(strip(viaAttribute));
  });

  it('overrides every Tier 2 token in the dark palette, and nothing else', () => {
    expect(declared(darkBlocks()[0]).sort()).toEqual([...TIER_2].sort());
  });

  it('exposes every Tier 2 colour token to Tailwind through @theme inline', () => {
    const theme = CSS.slice(CSS.indexOf('@theme inline'));
    for (const token of TIER_2) {
      if (token === 'slip-shadow') {
        // Renamed on the way through: a theme variable may not reference a runtime
        // variable of its own name, so --slip-shadow is exposed as --shadow-slip.
        expect(theme).toContain('--shadow-slip: var(--slip-shadow)');
      } else {
        expect(theme, `--color-${token} not exposed`).toContain(`--color-${token}: var(--${token})`);
      }
    }
  });

  it('uses @theme inline, not bare @theme', () => {
    // Without `inline` the utilities resolve through :root and every scoped dark override
    // is dead. This is the single most load-bearing keyword in the file.
    expect(CSS).toContain('@theme inline');
  });

  it('never names a theme variable in hand-written CSS', () => {
    // @theme inline emits no --color-* / --font-* variables at runtime, so var(--color-x)
    // and var(--font-sans) resolve to nothing outside the generated utilities.
    const handWritten = CSS.slice(0, CSS.indexOf('@theme inline'));
    expect(handWritten).not.toMatch(/var\(--color-/);
    expect(handWritten).not.toMatch(/var\(--font-sans\)/);
  });

  it('renders the app in Geist rather than the create-next-app Arial fallback', () => {
    expect(CSS).toContain('var(--font-geist-sans)');
    expect(CSS).not.toContain('Arial');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -- src/app/__tests__/token-layer.test.ts
```
Expected: FAIL. The current `globals.css` has no palette markers, so `darkBlocks()` returns `[]` and the length assertion fails first.

- [ ] **Step 3: Write the token layer**

Replace the entire contents of `src/app/globals.css`:

```css
@import "tailwindcss";

/* ═══════════════════════════════════════════════════════════════════════════
   Tier 1 — private ramps (D52).
   The exact oklch values Tailwind ships for the zinc, red, emerald, and amber
   stops this app uses, copied rather than referenced: Tailwind v4 emits a
   theme variable only when a generated utility uses it, so var(--color-zinc-200)
   is not guaranteed to resolve. Copying is what makes the 7b sweep pixel-neutral.

   Nothing outside this file may name a Tier 1 variable. Tier 2 is the only
   vocabulary the app speaks.
   ═══════════════════════════════════════════════════════════════════════════ */
:root {
  --n-0:    #fff;
  --n-50:   oklch(98.5% 0 none);
  --n-100:  oklch(96.7% 0.001 286.375);
  --n-200:  oklch(92% 0.004 286.32);
  --n-300:  oklch(87.1% 0.006 286.286);
  --n-400:  oklch(70.5% 0.015 286.067);
  --n-500:  oklch(55.2% 0.016 285.938);
  --n-600:  oklch(44.2% 0.017 285.786);
  --n-700:  oklch(37% 0.013 285.805);
  --n-800:  oklch(27.4% 0.006 286.033);
  --n-900:  oklch(21% 0.006 285.885);
  --n-950:  oklch(14.1% 0.005 285.823);
  --n-1000: #000;

  --pos-50:  oklch(97.9% 0.021 166.113);
  --pos-100: oklch(95% 0.052 163.051);
  --pos-400: oklch(76.5% 0.177 163.223);
  --pos-500: oklch(69.6% 0.17 162.48);
  --pos-600: oklch(59.6% 0.145 163.225);
  --pos-700: oklch(50.8% 0.118 165.612);
  --pos-950: oklch(26.2% 0.051 172.552);

  --neg-50:  oklch(97.1% 0.013 17.38);
  --neg-100: oklch(93.6% 0.032 17.717);
  --neg-300: oklch(80.8% 0.114 19.571);
  --neg-400: oklch(70.4% 0.191 22.216);
  --neg-600: oklch(57.7% 0.245 27.325);
  --neg-700: oklch(50.5% 0.213 27.518);
  --neg-800: oklch(44.4% 0.177 26.899);
  --neg-950: oklch(25.8% 0.092 26.042);

  --cau-50:  oklch(98.7% 0.022 95.277);
  --cau-100: oklch(96.2% 0.059 95.617);
  --cau-300: oklch(87.9% 0.169 91.605);
  --cau-400: oklch(82.8% 0.189 84.429);
  --cau-600: oklch(66.6% 0.179 58.318);
  --cau-700: oklch(55.5% 0.163 48.998);
  --cau-800: oklch(47.3% 0.137 46.201);
  --cau-950: oklch(27.9% 0.077 45.635);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Tier 2 — the semantic vocabulary. Light.
   --surface and --surface-sunken are the same value here and diverge in dark;
   that is deliberate, and collapsing them would flatten the dark theme's
   card-on-page separation.
   ═══════════════════════════════════════════════════════════════════════════ */
:root {
  /* LIGHT-PALETTE-START */
  --surface:               var(--n-50);
  --surface-raised:        var(--n-0);
  --surface-sunken:        var(--n-50);
  --surface-muted:         var(--n-100);
  --surface-skeleton:      var(--n-200);

  --line:                  var(--n-200);
  --line-strong:           var(--n-300);
  --line-hover:            var(--n-400);
  --line-subtle:           var(--n-100);

  --ink:                   var(--n-900);
  --ink-secondary:         var(--n-600);
  --ink-muted:             var(--n-500);
  --ink-subtle:            var(--n-400);

  --accent:                var(--n-900);
  --accent-ink:            var(--n-0);

  --positive:              var(--pos-600);
  --positive-surface:      var(--pos-100);
  --positive-surface-soft: var(--pos-50);
  --positive-line:         var(--pos-500);
  --positive-on-surface:   var(--pos-700);

  --negative:              var(--neg-600);
  --negative-surface:      var(--neg-100);
  --negative-surface-soft: var(--neg-50);
  --negative-line:         var(--neg-300);
  --negative-on-surface:   var(--neg-700);

  --caution:               var(--cau-600);
  --caution-surface:       var(--cau-100);
  --caution-surface-soft:  var(--cau-50);
  --caution-line:          var(--cau-300);
  --caution-on-surface:    var(--cau-700);

  --slip-shadow: 0 -8px 24px rgb(0 0 0 / 0.06);
  /* LIGHT-PALETTE-END */

  color-scheme: light;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Tier 2 — dark. A remap of the same thirty-one names onto different Tier 1
   stops. Tier 1 never changes.

   The block is written twice because CSS cannot share a declaration block
   across a media-query boundary. src/app/__tests__/token-layer.test.ts asserts
   the two copies stay byte-identical, which is what makes the duplication safe.

   The [data-theme] copy ships with no way to set the attribute. 7b deliberately
   has no toggle (D52); writing the selector now is what makes adding one later
   a drop-in rather than a restructure.
   ═══════════════════════════════════════════════════════════════════════════ */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    /* DARK-PALETTE-START */
    --surface:               var(--n-1000);
    --surface-raised:        var(--n-950);
    --surface-sunken:        var(--n-900);
    --surface-muted:         var(--n-800);
    --surface-skeleton:      var(--n-800);

    --line:                  var(--n-800);
    --line-strong:           var(--n-700);
    --line-hover:            var(--n-600);
    --line-subtle:           var(--n-900);

    --ink:                   var(--n-50);
    --ink-secondary:         var(--n-300);
    --ink-muted:             var(--n-400);
    --ink-subtle:            var(--n-600);

    --accent:                var(--n-100);
    --accent-ink:            var(--n-900);

    --positive:              var(--pos-400);
    --positive-surface:      var(--pos-950);
    --positive-surface-soft: color-mix(in oklab, var(--pos-950) 30%, transparent);
    --positive-line:         var(--pos-700);
    --positive-on-surface:   var(--pos-400);

    --negative:              var(--neg-400);
    --negative-surface:      var(--neg-950);
    --negative-surface-soft: color-mix(in oklab, var(--neg-950) 30%, transparent);
    --negative-line:         var(--neg-800);
    --negative-on-surface:   var(--neg-400);

    --caution:               var(--cau-400);
    --caution-surface:       var(--cau-950);
    --caution-surface-soft:  color-mix(in oklab, var(--cau-950) 20%, transparent);
    --caution-line:          var(--cau-800);
    --caution-on-surface:    var(--cau-400);

    --slip-shadow: 0 -8px 24px rgb(0 0 0 / 0.5);
    /* DARK-PALETTE-END */

    color-scheme: dark;
  }
}

:root[data-theme="dark"] {
  /* DARK-PALETTE-START */
  --surface:               var(--n-1000);
  --surface-raised:        var(--n-950);
  --surface-sunken:        var(--n-900);
  --surface-muted:         var(--n-800);
  --surface-skeleton:      var(--n-800);

  --line:                  var(--n-800);
  --line-strong:           var(--n-700);
  --line-hover:            var(--n-600);
  --line-subtle:           var(--n-900);

  --ink:                   var(--n-50);
  --ink-secondary:         var(--n-300);
  --ink-muted:             var(--n-400);
  --ink-subtle:            var(--n-600);

  --accent:                var(--n-100);
  --accent-ink:            var(--n-900);

  --positive:              var(--pos-400);
  --positive-surface:      var(--pos-950);
  --positive-surface-soft: color-mix(in oklab, var(--pos-950) 30%, transparent);
  --positive-line:         var(--pos-700);
  --positive-on-surface:   var(--pos-400);

  --negative:              var(--neg-400);
  --negative-surface:      var(--neg-950);
  --negative-surface-soft: color-mix(in oklab, var(--neg-950) 30%, transparent);
  --negative-line:         var(--neg-800);
  --negative-on-surface:   var(--neg-400);

  --caution:               var(--cau-400);
  --caution-surface:       var(--cau-950);
  --caution-surface-soft:  color-mix(in oklab, var(--cau-950) 20%, transparent);
  --caution-line:          var(--cau-800);
  --caution-on-surface:    var(--cau-400);

  --slip-shadow: 0 -8px 24px rgb(0 0 0 / 0.5);
  /* DARK-PALETTE-END */

  color-scheme: dark;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Exposure to Tailwind.

   `inline` is load-bearing. With it, .bg-surface emits `var(--surface)` and the
   variable resolves at the element, picking up the dark overrides above.
   Without it, the utility resolves through --color-surface at :root and every
   scoped override is dead.

   The consequence to remember: none of these --color-* / --font-* / --radius-*
   variables exist at runtime. Hand-written CSS must name the Tier 2 variable.
   ═══════════════════════════════════════════════════════════════════════════ */
@theme inline {
  --color-surface:               var(--surface);
  --color-surface-raised:        var(--surface-raised);
  --color-surface-sunken:        var(--surface-sunken);
  --color-surface-muted:         var(--surface-muted);
  --color-surface-skeleton:      var(--surface-skeleton);

  --color-line:                  var(--line);
  --color-line-strong:           var(--line-strong);
  --color-line-hover:            var(--line-hover);
  --color-line-subtle:           var(--line-subtle);

  --color-ink:                   var(--ink);
  --color-ink-secondary:         var(--ink-secondary);
  --color-ink-muted:             var(--ink-muted);
  --color-ink-subtle:            var(--ink-subtle);

  --color-accent:                var(--accent);
  --color-accent-ink:            var(--accent-ink);

  --color-positive:              var(--positive);
  --color-positive-surface:      var(--positive-surface);
  --color-positive-surface-soft: var(--positive-surface-soft);
  --color-positive-line:         var(--positive-line);
  --color-positive-on-surface:   var(--positive-on-surface);

  --color-negative:              var(--negative);
  --color-negative-surface:      var(--negative-surface);
  --color-negative-surface-soft: var(--negative-surface-soft);
  --color-negative-line:         var(--negative-line);
  --color-negative-on-surface:   var(--negative-on-surface);

  --color-caution:               var(--caution);
  --color-caution-surface:       var(--caution-surface);
  --color-caution-surface-soft:  var(--caution-surface-soft);
  --color-caution-line:          var(--caution-line);
  --color-caution-on-surface:    var(--caution-on-surface);

  /* Named for their role, because the codebase's rounded-lg/xl/full mix has never
     meant anything until now. */
  --radius-control: 0.5rem;
  --radius-card:    0.75rem;
  --radius-pill:    9999px;

  /* Renamed on the way through: a theme variable may not reference a runtime
     variable of its own name. */
  --shadow-slip: var(--slip-shadow);

  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}

/* `var(--font-sans)` would be wrong here — @theme inline emits no such variable at
   runtime. Naming the font's own variable is what finally renders the app in Geist;
   it has been Arial since create-next-app, because the rule this replaces hard-coded it. */
body {
  background: var(--surface);
  color: var(--ink);
  font-family: var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif;
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
npm test -- src/app/__tests__/token-layer.test.ts
```
Expected: PASS, 8 tests.

- [ ] **Step 5: Point `themeColor` at the new surfaces**

In `src/app/layout.tsx`, the `viewport` export currently names the two colours the old
`globals.css` defined. `--surface` is now zinc-50 in light and pure black in dark:

```ts
  themeColor: [
    // The two --surface values from globals.css, as literal hex: browser chrome is painted
    // before any stylesheet is parsed, so it cannot read a CSS variable.
    { media: '(prefers-color-scheme: light)', color: '#fafafa' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
```

- [ ] **Step 6: See it in a browser once, before building anything on it**

```bash
npm run dev
```
Open `http://localhost:3000/sign-in`. Confirm two things and then stop the server:
1. The type is **Geist**, not Arial — the lowercase `g` is single-storey and the digits are noticeably rounder. If it still looks like Arial, `body` is naming the wrong variable.
2. Toggling your OS between light and dark changes the page background.

This is not a formality. Every later task assumes the token layer works, and a
silently-broken `@theme inline` produces utilities that do nothing at all rather than
utilities that throw.

- [ ] **Step 7: Run the full gate and commit**

```bash
npm run verify
```
Expected: green.

```bash
git add src/app/globals.css src/app/layout.tsx src/app/__tests__/token-layer.test.ts
git commit -m "$(cat <<'MSG'
feat(ui): the two-tier token layer

Thirty semantic tokens over private oklch ramps, exposed through @theme
inline. Dark mode is a remap of the same names, written twice because CSS
cannot share a block across a media boundary and kept in sync by a test
rather than by attention.

Fixes the font while it is here: globals.css has hard-coded Arial over the
Geist the root layout loads since create-next-app, so the app has never
once rendered in its own typeface.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: The token-lint ratchet

The sweep touches 46 files. Doing that in one commit is unreviewable, and doing it across
several commits normally means the lint test cannot land until the last one. A baseline fixes
both: the test ships now with every dirty file listed, each sweep task deletes its files from
the list, and the list is empty by Task 13.

The ratchet bites in **both** directions. A file outside the baseline must be clean — that is
the rule that constrains screen nineteen, and the reason this test exists at all
([D54](../decisions.md#d54--a-token-lint-test-is-the-harness-7b-earns-revisiting-d51)). A file
*inside* the baseline must be dirty — that is what stops the baseline from quietly outliving
the sweep and turning back into permission.

**Files:**
- Create: `src/app/__tests__/token-lint.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `BASELINE`, a `string[]` of repo-relative POSIX paths that Tasks 3–13 delete
  entries from. No other task imports from this file.

- [ ] **Step 1: Write the test**

This one is written to pass immediately — the baseline is the current state of the repo, so
there is nothing to fail. What it does is fail on the *next* file anyone writes.

Create `src/app/__tests__/token-lint.test.ts`:

```ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The design system's enforcement (D54). Every .tsx file under src/ speaks the semantic
 * vocabulary from globals.css and nothing else — no raw palette class, no bg-white, no
 * arbitrary colour, and above all no `dark:` variant, because dark mode is defined once at
 * the token layer and a screen that restates it has already drifted.
 *
 * This is D51's reasoning applied a second time. D51 kept the notFound() assertion because it
 * constrains routes not yet written and discarded the rest as descriptions of a tree that
 * already existed. Once the 7b sweep lands, this test says nothing about today's code and
 * everything about screen nineteen.
 *
 * What it cannot see: a token used in the wrong *role*. `bg-surface-muted` where
 * `bg-surface-sunken` was meant renders wrong and passes green. docs/design-system-audit.md
 * is what catches that, which is why the browser pass is a deliverable and not a nicety.
 */

const SRC = join(process.cwd(), 'src');

const TAILWIND_PALETTES = [
  'slate', 'gray', 'zinc', 'neutral', 'stone', 'red', 'orange', 'amber', 'yellow', 'lime',
  'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia',
  'pink', 'rose',
].join('|');

const PROPERTIES =
  'bg|text|border|ring|divide|from|via|to|shadow|outline|placeholder|decoration|accent|caret|fill|stroke';

const RULES: { name: string; pattern: RegExp }[] = [
  {
    name: 'a raw palette class',
    pattern: new RegExp(`(?<![a-zA-Z0-9-])(?:${PROPERTIES})-(?:${TAILWIND_PALETTES})-\\d{2,3}\\b`),
  },
  {
    name: 'a raw white/black class',
    pattern: /(?<![a-zA-Z0-9-])(?:bg|text|border|divide|ring|outline)-(?:white|black)\b/,
  },
  {
    name: 'a `dark:` variant — dark mode belongs to the token layer',
    pattern: /(?<![a-zA-Z0-9-])dark:/,
  },
  {
    name: 'an arbitrary colour value',
    pattern: /\[(?:#[0-9a-fA-F]{3,8}|(?:rgb|rgba|hsl|hsla|oklch|oklab)\()/,
  },
  {
    name: 'a Tier 1 ramp variable — those are private to globals.css',
    pattern: /var\(--(?:n|pos|neg|cau)-\d{1,4}\)/,
  },
];

/**
 * Files that legitimately cannot speak the vocabulary. Four entries, each for a reason that
 * will not change — this list is not where a screen goes when it is inconvenient to fix.
 */
const ALLOWLIST = new Set([
  // ImageResponse renders outside the document and cannot read a CSS variable.
  'src/app/icon.tsx',
  'src/app/apple-icon.tsx',
  // Catches a root-layout throw, so it renders its own <html> and deliberately depends on no
  // stylesheet — the app's CSS may be exactly what failed to load.
  'src/app/global-error.tsx',
  // This file names the banned patterns in order to ban them.
  'src/app/__tests__/token-lint.test.ts',
]);

/**
 * The 7b sweep's remaining work. Entries are deleted as each screen group is converted, and
 * the list is empty when the sweep is done. Do not add to it.
 */
const BASELINE: string[] = [
  'src/app/(app)/bets/page.tsx',
  'src/app/(app)/error.tsx',
  'src/app/(app)/events/[eventId]/dispute-form.tsx',
  'src/app/(app)/events/[eventId]/market-card.tsx',
  'src/app/(app)/events/[eventId]/page.tsx',
  'src/app/(app)/events/[eventId]/resolve/page.tsx',
  'src/app/(app)/events/[eventId]/resolve/resolve-form.tsx',
  'src/app/(app)/events/new/event-form.tsx',
  'src/app/(app)/events/page.tsx',
  'src/app/(app)/feed/[eventId]/comment-thread.tsx',
  'src/app/(app)/feed/feed-card.tsx',
  'src/app/(app)/feed/feed-list.tsx',
  'src/app/(app)/feed/page.tsx',
  'src/app/(app)/games/game-card.tsx',
  'src/app/(app)/games/page.tsx',
  'src/app/(app)/layout.tsx',
  'src/app/(app)/me/feed-preferences/page.tsx',
  'src/app/(app)/me/feed-preferences/preferences-form.tsx',
  'src/app/(app)/me/page.tsx',
  'src/app/(app)/members/[membershipId]/page.tsx',
  'src/app/(app)/not-found.tsx',
  'src/app/(app)/standings/page.tsx',
  'src/app/(app)/wagers/[wagerId]/page.tsx',
  'src/app/(app)/wagers/[wagerId]/wager-actions.tsx',
  'src/app/(app)/wagers/new/wager-form.tsx',
  'src/app/(app)/wagers/page.tsx',
  'src/app/admin/error.tsx',
  'src/app/admin/events/page.tsx',
  'src/app/admin/events/void-form.tsx',
  'src/app/admin/page.tsx',
  'src/app/admin/wagers/arbitration-form.tsx',
  'src/app/admin/wagers/page.tsx',
  'src/app/disabled/page.tsx',
  'src/app/error.tsx',
  'src/app/join/page.tsx',
  'src/app/no-season/page.tsx',
  'src/app/not-found.tsx',
  'src/app/pending/page.tsx',
  'src/app/sign-in/page.tsx',
  'src/components/bet-slip/bet-slip.tsx',
  'src/components/ui/badge.tsx',
  'src/components/ui/empty-state.tsx',
  'src/components/ui/loading-screen.tsx',
  'src/components/ui/money.tsx',
  'src/components/ui/status-screen.tsx',
  'src/components/ui/tab-bar.tsx',
];

/** Every .tsx file beneath `dir`, as repo-relative POSIX paths. */
function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    if (!full.endsWith('.tsx') && !full.endsWith('.ts')) return [];
    return [relative(process.cwd(), full).split(sep).join('/')];
  });
}

/** The rules a file breaks, by name. */
function violations(file: string): string[] {
  const source = readFileSync(join(process.cwd(), file), 'utf8');
  return RULES.filter((rule) => rule.pattern.test(source)).map((rule) => rule.name);
}

const FILES = tsxFiles(SRC).filter((f) => !ALLOWLIST.has(f));

describe('token lint', () => {
  it('has files to check, so a broken walk cannot pass silently', () => {
    expect(FILES.length).toBeGreaterThan(40);
  });

  it.each(FILES.filter((f) => !BASELINE.includes(f)))(
    '%s speaks only the semantic vocabulary',
    (file) => {
      expect(violations(file), `${file} contains ${violations(file).join(', ')}`).toEqual([]);
    },
  );

  /**
   * The other direction, and the half that keeps the ratchet honest: a baselined file that is
   * already clean has to leave the list, or the list slowly stops describing anything and
   * starts granting permission.
   */
  it.each(BASELINE)('%s is still on the sweep baseline for a reason', (file) => {
    expect(
      violations(file).length,
      `${file} is clean — delete it from BASELINE in this file`,
    ).toBeGreaterThan(0);
  });

  it('every baselined path exists', () => {
    for (const file of BASELINE) {
      expect(FILES, `${file} is baselined but not found on disk`).toContain(file);
    }
  });
});
```

- [ ] **Step 2: Run it and confirm it passes against the repo as it stands**

```bash
npm test -- src/app/__tests__/token-lint.test.ts
```
Expected: PASS. The baseline mirrors the repo exactly, so nothing is flagged yet.

- [ ] **Step 3: Prove the ratchet actually bites, then undo the proof**

A lint test that passes on day one is indistinguishable from a lint test that does nothing.
Check it both ways before trusting it:

```bash
# Forward direction: an unbaselined file with a raw class must fail.
sed -i 's/className="flex min-h-full flex-col"/className="flex min-h-full flex-col bg-zinc-100"/' src/app/layout.tsx
npm test -- src/app/__tests__/token-lint.test.ts
```
Expected: FAIL — `src/app/layout.tsx contains a raw palette class`.

```bash
git checkout src/app/layout.tsx

# Reverse direction: a clean file left on the baseline must fail.
sed -i "s|^const BASELINE: string\[\] = \[|const BASELINE: string[] = [\n  'src/app/page.tsx',|" src/app/__tests__/token-lint.test.ts
npm test -- src/app/__tests__/token-lint.test.ts
```
Expected: FAIL — `src/app/page.tsx is clean — delete it from BASELINE in this file`.

```bash
git checkout src/app/__tests__/token-lint.test.ts
```

- [ ] **Step 4: Run the full gate and commit**

```bash
npm run verify
```
Expected: green.

```bash
git add src/app/__tests__/token-lint.test.ts
git commit -m "$(cat <<'MSG'
test(ui): token lint, with the sweep's remaining work as a baseline

Files outside the baseline must speak the semantic vocabulary; files inside
it must not yet, so the list cannot outlive the sweep and become permission.
Both directions verified by breaking them deliberately.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: The status components and the five boundaries

The smallest, most self-contained corner of the sweep, taken first so the ratchet is exercised
end to end on real files before the harder screens. Eight baseline entries go — three components
and the five boundaries that render them.

These components are pure markup with no props to change — they are a conversion, not a
rewrite. `route-conventions.test.ts` already asserts every boundary delegates to one of them,
and that assertion must keep passing.

**Files:**
- Modify: `src/components/ui/empty-state.tsx`
- Modify: `src/components/ui/loading-screen.tsx`
- Modify: `src/components/ui/status-screen.tsx`
- Modify: `src/app/error.tsx`, `src/app/not-found.tsx`, `src/app/(app)/error.tsx`, `src/app/(app)/not-found.tsx`, `src/app/admin/error.tsx`
- Modify: `src/app/__tests__/token-lint.test.ts` (delete eight baseline entries)

**Interfaces:**
- Consumes: the utilities from Task 1.
- Produces: no API change. `EmptyState({ title, body? })`, `LoadingScreen({ label? })`, and
  `StatusScreen({ title, body, digest?, children? })` keep their exact signatures.

**Background:** `src/app/global-error.tsx` is **not** in this task and must not be touched. It
renders its own `<html>` with inline styles precisely because the app's stylesheet may be what
failed to load; it is allowlisted for that reason.

- [ ] **Step 1: Convert the three components**

`src/components/ui/empty-state.tsx` — the two colour classes only:

```tsx
export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <p className="text-sm font-medium text-ink-secondary">{title}</p>
      {body ? <p className="max-w-xs text-balance text-sm text-ink-muted">{body}</p> : null}
    </div>
  );
}
```

`src/components/ui/loading-screen.tsx` — the two pulse bars:

```tsx
      <div aria-hidden className="h-2 w-24 animate-pulse rounded-pill bg-surface-skeleton" />
      <div aria-hidden className="h-2 w-16 animate-pulse rounded-pill bg-surface-skeleton" />
```

Leave the file's leading comment about deliberately not being a skeleton exactly as it is —
7d still owns that, and the comment is the record of why.

`src/components/ui/status-screen.tsx` — the body paragraph and the digest line:

```tsx
        <p className="mt-3 max-w-sm text-balance text-sm text-ink-muted">
          {body}
        </p>
```
```tsx
        <p className="font-mono text-xs text-ink-subtle">Reference {digest}</p>
```

- [ ] **Step 2: Convert the five boundary files**

Each is a handful of lines wrapping `StatusScreen`. The only colour classes in them are on the
"Try again" and "Back" controls. Replace each occurrence of

```
text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200
```
with
```
text-ink-muted transition-colors hover:text-ink
```

and each bare `text-zinc-500` on a link with `text-ink-muted`. Do not change the markup, the
copy, or the `retry()` calls.

- [ ] **Step 3: Delete the eight entries from the baseline**

In `src/app/__tests__/token-lint.test.ts`, remove these lines from `BASELINE`:

```
  'src/app/(app)/error.tsx',
  'src/app/(app)/not-found.tsx',
  'src/app/admin/error.tsx',
  'src/app/error.tsx',
  'src/app/not-found.tsx',
  'src/components/ui/empty-state.tsx',
  'src/components/ui/loading-screen.tsx',
  'src/components/ui/status-screen.tsx',
```

If the test reports one of them is *still* dirty, a colour class was missed; find it with:

```bash
grep -nE 'dark:|-(zinc|red|emerald|amber)-[0-9]|-(white|black)\b' <the file>
```

- [ ] **Step 4: Run the gate**

```bash
npm run verify
```
Expected: green, including `route-conventions.test.ts` — the boundaries still delegate to the
shared components, because their imports did not change.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui src/app/error.tsx src/app/not-found.tsx "src/app/(app)/error.tsx" "src/app/(app)/not-found.tsx" src/app/admin/error.tsx src/app/__tests__/token-lint.test.ts
git commit -m "$(cat <<'MSG'
refactor(ui): status components and boundaries onto the token vocabulary

Eight files off the sweep baseline. No API changes and no markup changes —
colour classes only.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: `Button`

The one component with a design decision in it, and the first that changes how a screen looks
rather than only what colour it is — see the note on radius below.

**Files:**
- Create: `src/components/ui/button.tsx`
- Modify: `src/app/sign-in/page.tsx`, `src/app/join/page.tsx`, `src/app/pending/page.tsx`, `src/app/no-season/page.tsx`, `src/app/disabled/page.tsx`
- Modify: `src/app/__tests__/token-lint.test.ts` (delete five baseline entries)

**Interfaces:**
- Consumes: the utilities from Task 1.
- Produces, from `@/components/ui/button`:
  - `type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'`
  - `type ButtonSize = 'sm' | 'md'`
  - `buttonClasses(variant?: ButtonVariant, size?: ButtonSize): string` — the class string, for
    `<Link>` call sites
  - `Button(props: ComponentProps<'button'> & { variant?: ButtonVariant; size?: ButtonSize })`

**Two decisions baked into this component, so later tasks do not relitigate them:**

1. **No `asChild`.** A `<Link>` that should look like a button calls `buttonClasses(...)` and
   applies the string. Cloning children to forward props is what makes button components hard
   to read, and every link-button in this app is a plain `next/link`.
2. **`Button` owns its radius, and it is `rounded-control`.** Today's buttons are a mix of
   `rounded-full` and `rounded-lg`, which is exactly the inconsistency this phase exists to
   remove — but it means adopting `Button` is a *visual* change, not just a colour one, and it
   is the fourth declared change in the spec. Adopt `Button` deliberately, at the call sites
   each task names. Do **not** convert the odds cells in `game-card.tsx`: those are a
   selection grid that happens to use `<button>`, not buttons, and 7c owns that layout.

- [ ] **Step 1: Write the component**

Create `src/components/ui/button.tsx`:

```tsx
import type { ComponentProps } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-ink hover:opacity-90',
  secondary: 'border border-line-strong text-ink hover:border-line-hover',
  ghost: 'text-ink-muted hover:text-ink',
  danger: 'border border-negative-line text-negative hover:bg-negative-surface-soft',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-11 px-4 text-sm',
};

/**
 * The class string, for the call sites that are `<Link>`s rather than `<button>`s. Exported
 * instead of an `asChild` prop: cloning children to forward props is what makes button
 * components hard to read, and every link-button in this app is a plain next/link.
 */
export function buttonClasses(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
): string {
  return [
    'inline-flex items-center justify-center gap-2 rounded-control font-medium',
    'transition-colors disabled:cursor-not-allowed disabled:opacity-50',
    VARIANTS[variant],
    SIZES[size],
  ].join(' ');
}

/**
 * `disabled:opacity-50` lives here rather than at each call site, which is what keeps the
 * twelve forms' pending-state contract (D51) true by construction rather than by twelve
 * separate people remembering it.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  type = 'button',
  ...props
}: ComponentProps<'button'> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={`${buttonClasses(variant, size)} ${className}`} {...props} />;
}
```

- [ ] **Step 2: Adopt it on the five screens outside the app shell**

These five are the simplest call sites in the repo — a heading, a paragraph, and one action —
which is why they go first. Each currently hand-rolls its button or link.

In each file, replace the hand-rolled control's `className` with `buttonClasses(...)` and
convert the remaining text colours:

- `text-zinc-500` → `text-ink-muted`
- `text-zinc-400` → `text-ink-subtle`
- `bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900` → drop it; that is
  `buttonClasses('primary')`

For example, `src/app/sign-in/page.tsx`'s submit control becomes:

```tsx
import { Button } from '@/components/ui/button';
// …
        <Button type="submit">Continue with Google</Button>
```

and a link-styled action becomes:

```tsx
import { buttonClasses } from '@/components/ui/button';
// …
        <Link href="/join" className={buttonClasses('primary')}>Join the season</Link>
```

Read each file before editing it — the five are not identical, and two of them have no button
at all, only body text to convert.

- [ ] **Step 3: Delete the five baseline entries**

Remove from `BASELINE` in `src/app/__tests__/token-lint.test.ts`:

```
  'src/app/disabled/page.tsx',
  'src/app/join/page.tsx',
  'src/app/no-season/page.tsx',
  'src/app/pending/page.tsx',
  'src/app/sign-in/page.tsx',
```

- [ ] **Step 4: Run the gate**

```bash
npm run verify
```
Expected: green. If `route-conventions.test.ts` fails on the pending-state assertion, a form's
submit control lost its `disabled={pending}` in the conversion — put it back; `Button` styles
the disabled state but does not decide it.

- [ ] **Step 5: See the five screens**

```bash
npm run dev
```
Visit `/sign-in` while signed out. The button should be a filled dark rectangle with 8px
corners, and legible in both OS themes. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/button.tsx src/app/sign-in src/app/join src/app/pending src/app/no-season src/app/disabled src/app/__tests__/token-lint.test.ts
git commit -m "$(cat <<'MSG'
feat(ui): Button, adopted on the five screens outside the app shell

buttonClasses() is exported for link call sites instead of an asChild prop.
Button owns its radius, which standardizes today's rounded-full/rounded-lg
mix — the fourth declared visual change in the 7b spec.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: `Card` and `Callout`

Two components, one task: neither is more than fifteen lines, and both are adopted on the same
screen.

**Files:**
- Create: `src/components/ui/card.tsx`
- Create: `src/components/ui/callout.tsx`
- Modify: `src/app/(app)/standings/page.tsx`
- Modify: `src/app/__tests__/token-lint.test.ts` (delete one baseline entry)

**Interfaces:**
- Consumes: the utilities from Task 1.
- Produces:
  - `Card({ emphasis?: boolean; className?: string; children: ReactNode })` from
    `@/components/ui/card`
  - `type CalloutTone = 'negative' | 'caution' | 'positive'` and
    `Callout({ tone?: CalloutTone; className?: string; children: ReactNode })` from
    `@/components/ui/callout`

- [ ] **Step 1: Write `Card`**

Create `src/components/ui/card.tsx`:

```tsx
import type { ReactNode } from 'react';

/**
 * The bordered raised surface nearly every screen repeats. `emphasis` is the
 * "this row is you" / "this selection is picked" state — standings, the odds board, and the
 * wagers list all draw it the same way, with the accent border rather than a fill.
 */
export function Card({
  emphasis = false,
  className = '',
  children,
}: {
  emphasis?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-card border bg-surface-raised ${
        emphasis ? 'border-accent' : 'border-line'
      } ${className}`}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Write `Callout`**

Create `src/components/ui/callout.tsx`:

```tsx
import type { ReactNode } from 'react';

export type CalloutTone = 'negative' | 'caution' | 'positive';

/**
 * Uses the `-surface-soft` tint rather than `-surface`, deliberately: a callout covers far
 * more area than a badge does, and the same tint that reads as a chip reads as a warning
 * light at full width.
 */
const TONES: Record<CalloutTone, string> = {
  negative: 'border-negative-line bg-negative-surface-soft text-negative-on-surface',
  caution: 'border-caution-line bg-caution-surface-soft text-caution-on-surface',
  positive: 'border-positive-line bg-positive-surface-soft text-positive-on-surface',
};

export function Callout({
  tone = 'negative',
  className = '',
  children,
}: {
  tone?: CalloutTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      // Screen readers should interrupt for a failure and not for a notice.
      role={tone === 'negative' ? 'alert' : undefined}
      className={`flex flex-col gap-2 rounded-card border p-3 text-sm ${TONES[tone]} ${className}`}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 3: Adopt `Card` on the standings screen**

`src/app/(app)/standings/page.tsx` builds its rows as `<li>` with a conditional border. That
conditional is exactly `emphasis`:

```tsx
import { Card } from '@/components/ui/card';
// …
          return (
            <li key={row.membershipId}>
              <Card emphasis={isMe} className="flex items-center gap-3 p-3">
                <span className="w-6 text-sm tabular-nums text-ink-subtle">{i + 1}</span>
                <Link
                  href={`/members/${row.membershipId}`}
                  className="flex-1 truncate text-sm font-medium hover:underline"
                >
                  {row.displayName}
                </Link>
                <Money cents={row.balanceCents} className="text-sm font-semibold" />
              </Card>
            </li>
          );
```

Note the `<li>` stays and `Card` moves inside it — a `<Card>` rendering an `<li>` would need a
polymorphic `as` prop, which is the same complexity `asChild` was rejected for in Task 4.

Convert the rest of the file's colours in the same pass: the credits section heading's
`text-zinc-500` → `text-ink-muted`, and the second `<ol>`'s rows the same way as the first.

- [ ] **Step 4: Delete the baseline entry**

Remove `'src/app/(app)/standings/page.tsx',` from `BASELINE`.

- [ ] **Step 5: Run the gate and commit**

```bash
npm run verify
```
Expected: green.

```bash
git add src/components/ui/card.tsx src/components/ui/callout.tsx "src/app/(app)/standings" src/app/__tests__/token-lint.test.ts
git commit -m "$(cat <<'MSG'
feat(ui): Card and Callout, adopted on standings

Card's `emphasis` is the "this row is you" state the standings, odds board,
and wagers list all draw the same way. Callout tints with -surface-soft
because a full-width notice at chip strength reads as an alarm.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: `SegmentedControl` and `FormField`

**Files:**
- Create: `src/components/ui/segmented-control.tsx`
- Create: `src/components/ui/form-field.tsx`
- Modify: `src/app/(app)/me/feed-preferences/preferences-form.tsx`, `src/app/(app)/me/feed-preferences/page.tsx`
- Modify: `src/app/__tests__/token-lint.test.ts` (delete two baseline entries)

**Interfaces:**
- Consumes: `buttonClasses` from Task 4.
- Produces:
  - `interface Segment { href: ComponentProps<typeof Link>['href']; label: string; active: boolean }`
    and `SegmentedControl({ segments, label }: { segments: Segment[]; label: string })` from
    `@/components/ui/segmented-control`
  - `FormField({ label, htmlFor, hint?, error?, children }: { label: string; htmlFor: string; hint?: string; error?: string; children: ReactNode })`
    from `@/components/ui/form-field`

**Background:** `href` is typed as `ComponentProps<typeof Link>['href']` rather than `string`.
Next 16 generates typed routes (that is where the `PageProps<'/bets'>` globals come from), and a
bare `string` will not satisfy `Link`. Borrowing `Link`'s own type is correct however the
generated types are shaped.

- [ ] **Step 1: Write `SegmentedControl`**

Create `src/components/ui/segmented-control.tsx`:

```tsx
import Link from 'next/link';
import type { ComponentProps } from 'react';

export interface Segment {
  href: ComponentProps<typeof Link>['href'];
  label: string;
  active: boolean;
}

/**
 * Link-based, not stateful. Both call sites — Bets | Wagers and Cash | Credits — are server
 * rendered navigations that must stay navigations: they change what the server queries, and
 * making them client state would mean fetching both and hiding one.
 *
 * The active segment renders as a <span>, so it is not a link to the page you are on.
 * `/bets`'s currency filter previously rendered its active segment as a live link; that was
 * an oversight rather than a feature.
 */
export function SegmentedControl({ segments, label }: { segments: Segment[]; label: string }) {
  return (
    <nav aria-label={label} className="flex gap-2 px-1">
      {segments.map((segment) =>
        segment.active ? (
          <span
            key={segment.label}
            aria-current="page"
            className="rounded-pill bg-accent px-3 py-1 text-xs font-medium text-accent-ink"
          >
            {segment.label}
          </span>
        ) : (
          <Link
            key={segment.label}
            href={segment.href}
            className="rounded-pill bg-surface-muted px-3 py-1 text-xs font-medium text-ink-secondary transition-colors hover:text-ink"
          >
            {segment.label}
          </Link>
        ),
      )}
    </nav>
  );
}
```

- [ ] **Step 2: Write `FormField`**

Create `src/components/ui/form-field.tsx`:

```tsx
import type { ReactNode } from 'react';

/**
 * Label, control, hint, error. `htmlFor` is required rather than optional because an
 * unlabelled control is the accessibility bug this component exists to make impossible —
 * the caller has to name the id it gave its input.
 */
export function FormField({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-ink-secondary">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="text-xs text-ink-muted">{hint}</p> : null}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-xs text-negative">
          {error}
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Adopt `FormField` on the feed-preferences form**

`src/app/(app)/me/feed-preferences/preferences-form.tsx` is the simplest of the twelve forms —
checkboxes and a submit — which makes it the right first consumer. Wrap each labelled control
in `FormField`, replace the submit control with `<Button type="submit" disabled={pending}>`,
and convert the file's remaining colours (`text-zinc-500` → `text-ink-muted`,
`border-zinc-300 dark:border-zinc-700` → `border-line-strong`).

Keep the `useTransition` pending state and the label swap exactly as they are —
`route-conventions.test.ts` asserts both.

- [ ] **Step 4: Delete the two baseline entries**

Remove from `BASELINE`:

```
  'src/app/(app)/me/feed-preferences/page.tsx',
  'src/app/(app)/me/feed-preferences/preferences-form.tsx',
```

- [ ] **Step 5: Run the gate and commit**

```bash
npm run verify
```
Expected: green.

```bash
git add src/components/ui/segmented-control.tsx src/components/ui/form-field.tsx "src/app/(app)/me/feed-preferences" src/app/__tests__/token-lint.test.ts
git commit -m "$(cat <<'MSG'
feat(ui): SegmentedControl and FormField

SegmentedControl stays link-based — both call sites are server-rendered
navigations, and the active segment is now a span rather than a link to the
page you are already on. FormField requires htmlFor, so an unlabelled
control cannot be written by accident.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 7: Tone-based `Badge`, and one place that formats money

**Files:**
- Modify: `src/components/ui/badge.tsx`
- Modify: `src/components/ui/money.tsx`
- Modify: `src/app/__tests__/token-lint.test.ts` (delete two baseline entries)

**Interfaces:**
- Consumes: the utilities from Task 1.
- Produces:
  - `type BadgeTone = 'neutral' | 'positive' | 'negative' | 'caution'` and
    `Badge({ children, tone?, className? })` from `@/components/ui/badge`
  - `statusTone(status: string): BadgeTone` from `@/components/ui/badge`
  - `StatusBadge({ status: string })` from `@/components/ui/badge` — **the pre-7b
    `<Badge status={…} />` behaviour under a new name**, so no status call site breaks in this
    task and each migrates with its own screen group's sweep
  - `Money({ cents, currency?, className? })`, `Price({ american })`, and the new
    `Line({ value, market })` from `@/components/ui/money`

- [ ] **Step 1: Rewrite `Badge`**

Replace `src/components/ui/badge.tsx`:

```tsx
import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'positive' | 'negative' | 'caution';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-muted text-ink-secondary',
  positive: 'bg-positive-surface text-positive-on-surface',
  negative: 'bg-negative-surface text-negative-on-surface',
  caution: 'bg-caution-surface text-caution-on-surface',
};

/**
 * The bet/wager/event status vocabulary, mapped to tones once. Exported because callers that
 * render a status alongside other content need the tone without rendering a Badge.
 */
export function statusTone(status: string): BadgeTone {
  switch (status) {
    case 'WON':
      return 'positive';
    case 'LOST':
      return 'negative';
    case 'PUSHED':
    case 'VOIDED':
      return 'caution';
    default:
      return 'neutral';
  }
}

export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={`rounded-pill px-2 py-0.5 text-xs font-medium ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * The pre-7b call signature, kept so the sweep does not have to touch every status call site
 * in the same commit that changes the component. Callers migrate to <Badge tone={…}> as their
 * screen is swept.
 */
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone(status)}>{status}</Badge>;
}
```

- [ ] **Step 2: Point existing `<Badge status={…} />` callers at `StatusBadge`**

```bash
grep -rln '<Badge status=' src/app
```

For each file the grep prints, change the import from `{ Badge }` to `{ StatusBadge }` and the
element from `<Badge status={x} />` to `<StatusBadge status={x} />`. Do not convert those
files' other colours yet — their screen group's sweep task owns that.

- [ ] **Step 3: Extend `money.tsx` with `Line`, and retokenize it**

In `src/components/ui/money.tsx`, replace the negative-amount colour and add the line
formatter that `game-card.tsx` currently keeps privately:

```tsx
    <span className={`tabular-nums ${negative ? 'text-negative' : ''} ${className}`}>
```

```tsx
/**
 * The number a selection's button shows. Lifted out of games/game-card.tsx, which had its own
 * copy of this and its own copy of Price's signing rule.
 */
export function Line({ value, market }: { value: string; market: 'SPREAD' | 'TOTAL'; }) {
  const n = Number(value);
  if (market === 'TOTAL') return <span className="tabular-nums">{n}</span>;
  return <span className="tabular-nums">{n > 0 ? `+${n}` : n}</span>;
}
```

- [ ] **Step 4: Delete the two baseline entries**

Remove from `BASELINE`:

```
  'src/components/ui/badge.tsx',
  'src/components/ui/money.tsx',
```

- [ ] **Step 5: Run the gate and commit**

```bash
npm run verify
```
Expected: green. A TypeScript error naming `Badge` means a `status=` caller was missed in
Step 2 — the compiler finds them all, so trust it over the grep.

```bash
git add src/components/ui/badge.tsx src/components/ui/money.tsx src/app src/app/__tests__/token-lint.test.ts
git commit -m "$(cat <<'MSG'
feat(ui): tone-based Badge, and Line joins Money and Price

Badge takes a tone so the chips feed-card and market-card hand-roll can stop
being hand-rolled. StatusBadge keeps the old signature working so status call
sites migrate with their own screen rather than all at once.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Tasks 8–13: the sweep

Six tasks with an identical shape, one per screen group. They are separate tasks so a
regression bisects to a screen rather than to "the sweep", and so a reviewer can reject one
group while approving its neighbours.

**The shape, which every one of the six follows:**

1. For each file in the group, replace colour classes using the mapping table below.
2. Delete every `dark:` variant. If deleting one leaves a class with no light counterpart, the
   pair was mismapped — go back to the table.
3. Adopt the components from Tasks 4–7 where the file already draws what they draw. Do not
   restructure markup to create an opportunity.
4. Delete the group's entries from `BASELINE`.
5. `npm run verify`.
6. Commit as `refactor(ui): <group> onto the token vocabulary`.

**The mapping table.** Left column is the *pair* as it appears today. This is the whole sweep;
if a pair is not here, stop and check whether you have misread the partner class.

| Today (light + dark) | Token class |
|---|---|
| `bg-zinc-50` + `dark:bg-black` | `bg-surface` |
| `bg-white` + `dark:bg-zinc-950` | `bg-surface-raised` |
| `bg-white/90` + `dark:bg-zinc-950/90` | `bg-surface-raised/90` |
| `bg-zinc-50` + `dark:bg-zinc-900` | `bg-surface-sunken` |
| `bg-zinc-100` + `dark:bg-zinc-800` | `bg-surface-muted` |
| `bg-zinc-200` + `dark:bg-zinc-800` | `bg-surface-skeleton` |
| `bg-zinc-900` + `dark:bg-zinc-100` *or* `dark:bg-zinc-50` | `bg-accent` |
| `text-white` + `dark:text-zinc-900` | `text-accent-ink` |
| `border-zinc-200` + `dark:border-zinc-800` | `border-line` |
| `border-zinc-300` + `dark:border-zinc-700` | `border-line-strong` |
| `border-zinc-400` (hover) | `border-line-hover` |
| `border-zinc-100` | `border-line-subtle` |
| `border-zinc-900` + `dark:border-zinc-100` | `border-accent` |
| `text-zinc-900` + `dark:text-zinc-50` | `text-ink` |
| `text-zinc-600` + `dark:text-zinc-300` | `text-ink-secondary` |
| `text-zinc-700` + `dark:text-zinc-300` | `text-ink-secondary` |
| `text-zinc-500` + `dark:text-zinc-400` *or* bare `text-zinc-500` | `text-ink-muted` |
| `text-zinc-400` + `dark:text-zinc-600` *or* bare `text-zinc-400` | `text-ink-subtle` |
| `text-emerald-600` + `dark:text-emerald-400` | `text-positive` |
| `bg-emerald-100` + `dark:bg-emerald-950` | `bg-positive-surface` |
| `bg-emerald-50` | `bg-positive-surface-soft` |
| `border-emerald-500` + `dark:border-emerald-700` | `border-positive-line` |
| `text-emerald-700` + `dark:text-emerald-400` | `text-positive-on-surface` |
| `text-red-600` + `dark:text-red-400` | `text-negative` |
| `bg-red-100` + `dark:bg-red-950` | `bg-negative-surface` |
| `bg-red-50` + `dark:bg-red-950/30` | `bg-negative-surface-soft` |
| `border-red-200/300/400` + `dark:border-red-600/800/900` | `border-negative-line` |
| `text-red-700` *or* `text-red-800` | `text-negative-on-surface` |
| `text-amber-600` + `dark:text-amber-400` | `text-caution` |
| `bg-amber-100` + `dark:bg-amber-950` | `bg-caution-surface` |
| `bg-amber-50` + `dark:bg-amber-950/20` | `bg-caution-surface-soft` |
| `border-amber-200/300/700` + `dark:border-amber-800/900` | `border-caution-line` |
| `text-amber-700` *or* `text-amber-800` *or* `text-amber-900` | `text-caution-on-surface` |
| `hover:text-red-600` | `hover:text-negative` |
| `shadow-[0_-8px_24px_rgba(0,0,0,0.06)]` | `shadow-slip` |

**One class deliberately absent from the table:** `bg-zinc-800`, which appears twice. Read both
call sites — each is a dark-mode-only fill whose light partner is `bg-zinc-100`, so both are
`bg-surface-muted`.

**Finding what is left in a file:**

```bash
grep -nE 'dark:|-(zinc|slate|gray|neutral|stone|red|orange|amber|yellow|emerald|green|teal|sky|blue|indigo|violet|purple|pink|rose)-[0-9]{2,3}|-(white|black)\b' <file>
```

---

### Task 8: Sweep — the app shell and the bet slip

Every member-facing screen renders inside these three files, so a mistake here is visible
everywhere. That is the reason they go first rather than last.

**Files:**
- Modify: `src/app/(app)/layout.tsx`
- Modify: `src/components/ui/tab-bar.tsx`
- Modify: `src/components/bet-slip/bet-slip.tsx`
- Modify: `src/app/__tests__/token-lint.test.ts` (delete three baseline entries)

**Interfaces:**
- Consumes: `Button` (Task 4), the utilities from Task 1.
- Produces: nothing new.

**Background — do not disturb these two, they are load-bearing:**

1. `tab-bar.tsx`'s rendered height is hard-coded into `bet-slip.tsx` as
   `bottom-[calc(41px+env(safe-area-inset-bottom))]`. Both files carry a comment saying so. The
   sweep changes **no** padding, font size, or border width in the tab bar, so the 41px stays
   correct — but if you find yourself editing anything other than a colour class in
   `tab-bar.tsx`, stop.
2. `bottom-[calc(41px+env(safe-area-inset-bottom))]` is an arbitrary value but not an arbitrary
   *colour*, so the lint rule does not flag it and it must survive the sweep unchanged. This is
   the fix for the mobile audit's blocks-use finding; deleting it makes all six tab links
   untappable whenever a bet is selected.

- [ ] **Step 1: Sweep `src/app/(app)/layout.tsx`**

Three pairs: the page background (`bg-zinc-50 dark:bg-black` → `bg-surface`), the sticky header
(`border-zinc-200 bg-white/90 … dark:border-zinc-800 dark:bg-zinc-950/90` → `border-line
bg-surface-raised/90`), and the Admin link (`text-zinc-500 hover:text-zinc-900
dark:hover:text-zinc-200` → `text-ink-muted transition-colors hover:text-ink`).

- [ ] **Step 2: Sweep `src/components/ui/tab-bar.tsx`**

The `<nav>`'s `border-zinc-200 bg-white/90 … dark:border-zinc-800 dark:bg-zinc-950/90` →
`border-line bg-surface-raised/90`. The active/inactive link colours →
`text-ink` and `text-ink-subtle hover:text-ink-secondary`.

- [ ] **Step 3: Sweep `src/components/bet-slip/bet-slip.tsx`**

The container's border, background, and shadow → `border-line bg-surface-raised shadow-slip`.
The leg rows' `bg-zinc-50 dark:bg-zinc-900` → `bg-surface-sunken`. The notice's amber →
`text-caution-on-surface`. The stake input's `border-zinc-300 dark:border-zinc-700
dark:bg-zinc-900` → `border-line-strong bg-surface-raised`. The error and success lines →
`text-negative` and `text-positive`.

Then replace the two controls with `Button`, which is what Task 4's radius note was about:

```tsx
          <div className="flex gap-2">
            <Button variant="secondary" onClick={slip.clear} className="flex-1">
              Clear
            </Button>
            <Button onClick={submit} disabled={pending} className="flex-[2]">
              {pending ? 'Placing…' : 'Place bet'}
            </Button>
          </div>
```

The `h-11` is now `Button`'s `md` size, and `flex-1` / `flex-[2]` pass through `className`.
Keep `disabled={pending}` and the label swap — `route-conventions.test.ts` asserts both.

- [ ] **Step 4: Delete the three baseline entries, run the gate**

Remove `'src/app/(app)/layout.tsx',`, `'src/components/ui/tab-bar.tsx',` and
`'src/components/bet-slip/bet-slip.tsx',` from `BASELINE`, then:

```bash
npm run verify
```
Expected: green.

- [ ] **Step 5: Check the thing that broke last time**

```bash
npm run dev
```
On `/games` at a 375px viewport, select any odds button so the slip appears, then tap each of
the six tab-bar links. All six must navigate. If any does not, the slip's `bottom-[calc(...)]`
was altered. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/layout.tsx" src/components/ui/tab-bar.tsx src/components/bet-slip/bet-slip.tsx src/app/__tests__/token-lint.test.ts
git commit -m "$(cat <<'MSG'
refactor(ui): app shell, tab bar, and bet slip onto the token vocabulary

The slip's shadow becomes visible in dark mode for the first time — it was
a fixed black rgba against a black page. Declared change 3 of 4.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 9: Sweep — games, me, and member profiles

**Files:**
- Modify: `src/app/(app)/games/page.tsx`, `src/app/(app)/games/game-card.tsx`
- Modify: `src/app/(app)/me/page.tsx`
- Modify: `src/app/(app)/members/[membershipId]/page.tsx`
- Modify: `src/app/__tests__/token-lint.test.ts` (delete four baseline entries)

**Interfaces:**
- Consumes: `Card` (Task 5), `Line` and `Price` (Task 7).
- Produces: nothing new.

- [ ] **Step 1: Sweep the three page files**

Apply the mapping table. `me/page.tsx` and `members/[membershipId]/page.tsx` are stat tiles and
lists — `bg-white dark:bg-zinc-950` blocks that become `Card`, and `text-zinc-500` labels that
become `text-ink-muted`.

- [ ] **Step 2: Sweep `game-card.tsx` and delete its private formatters**

`game-card.tsx` keeps a private `signed()` that duplicates `Price`, and inline line formatting
that duplicates `Line`. Delete `signed()` and re-express `selectionLabel` in terms of the
shared components.

The odds cell's own classes are colour-only edits — `border-zinc-200 bg-white
dark:border-zinc-800 dark:bg-zinc-900` → `border-line bg-surface-raised`, and the active state
`border-zinc-900 bg-zinc-900 text-white dark:…` → `border-accent bg-accent text-accent-ink`.

**Do not convert the odds cells to `Button`.** They are a selection grid that happens to use
`<button>`; `Button`'s radius and height are wrong for them, and 7c owns that layout.

- [ ] **Step 3: Delete the four baseline entries, run the gate, commit**

Remove `'src/app/(app)/games/page.tsx',`, `'src/app/(app)/games/game-card.tsx',`,
`'src/app/(app)/me/page.tsx',` and `'src/app/(app)/members/[membershipId]/page.tsx',`.

```bash
npm run verify
```
Expected: green.

```bash
git add "src/app/(app)/games" "src/app/(app)/me/page.tsx" "src/app/(app)/members" src/app/__tests__/token-lint.test.ts
git commit -m "$(cat <<'MSG'
refactor(ui): games, me, and profiles onto the token vocabulary

game-card's private signed() is gone; Price and Line are the only place
American prices and spreads are formatted now.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 10: Sweep — the feed

Carries declared change 2: the four disclosure chips that have never had a dark treatment.

**Files:**
- Modify: `src/app/(app)/feed/page.tsx`, `src/app/(app)/feed/feed-card.tsx`, `src/app/(app)/feed/feed-list.tsx`
- Modify: `src/app/(app)/feed/[eventId]/comment-thread.tsx`
- Modify: `src/app/__tests__/token-lint.test.ts` (delete four baseline entries)

**Interfaces:**
- Consumes: `Badge` and `statusTone` (Task 7), `Card` (Task 5), `Button` (Task 4).
- Produces: nothing new.

- [ ] **Step 1: Convert the four hand-rolled disclosure chips in `feed-card.tsx`**

Four occurrences of

```tsx
<span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">
```

(one uses `mr-2`). Each becomes:

```tsx
<Badge tone="caution" className="ml-2">
```

This is the declared change: those chips carry no `dark:` variant today, so they render bright
amber on a black card. Through `Badge` they pick up `--caution-surface`, which is dark.

- [ ] **Step 2: Sweep the rest of the four files**

Apply the mapping table. `feed-card.tsx` is the largest file in the group; work top to bottom
and use the grep from the sweep preamble to confirm nothing is left.

- [ ] **Step 3: Delete the four baseline entries, run the gate, commit**

```bash
npm run verify
```
Expected: green.

```bash
git add "src/app/(app)/feed" src/app/__tests__/token-lint.test.ts
git commit -m "$(cat <<'MSG'
refactor(ui): the feed onto the token vocabulary

The four creator-disclosure chips gain a dark treatment they never had —
they were bg-amber-100/text-amber-900 with no dark variant, burning bright
on a black card. Declared change 2 of 4.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 11: Sweep — bets and wagers

Both `SegmentedControl` call sites live here.

**Files:**
- Modify: `src/app/(app)/bets/page.tsx`
- Modify: `src/app/(app)/wagers/page.tsx`, `src/app/(app)/wagers/new/wager-form.tsx`, `src/app/(app)/wagers/[wagerId]/page.tsx`, `src/app/(app)/wagers/[wagerId]/wager-actions.tsx`
- Modify: `src/app/__tests__/token-lint.test.ts` (delete five baseline entries)

**Interfaces:**
- Consumes: `SegmentedControl` and `FormField` (Task 6), `Button` and `buttonClasses` (Task 4),
  `Card` (Task 5), `Badge`/`StatusBadge` (Task 7), `Callout` (Task 5).
- Produces: nothing new.

- [ ] **Step 1: Replace both segmented controls on `/bets`**

`src/app/(app)/bets/page.tsx` builds `sectionLinks` and `filterLinks` by hand:

```tsx
import { SegmentedControl } from '@/components/ui/segmented-control';
// …
  const sectionLinks = (
    <SegmentedControl
      label="Bets or wagers"
      segments={[
        { href: '/bets', label: 'Bets', active: true },
        { href: '/wagers', label: 'Wagers', active: false },
      ]}
    />
  );

  const filterLinks = (
    <SegmentedControl
      label="Currency"
      segments={[
        { href: '/bets', label: 'Cash', active: filterCurrency === 'CASH' },
        { href: '/bets?currency=CREDITS', label: 'Credits', active: filterCurrency === 'CREDITS' },
      ]}
    />
  );
```

- [ ] **Step 2: Replace the mirrored control on `/wagers`**

`src/app/(app)/wagers/page.tsx` has the same pair with `active` reversed:

```tsx
    <SegmentedControl
      label="Bets or wagers"
      segments={[
        { href: '/bets', label: 'Bets', active: false },
        { href: '/wagers', label: 'Wagers', active: true },
      ]}
    />
```

Its "Offer a wager" link becomes `className={buttonClasses('primary')}` — note this drops
`rounded-lg px-4 py-2` in favour of the component's own, which is declared change 4.

- [ ] **Step 3: Sweep the remaining three files**

Apply the mapping table. `wager-form.tsx` is one of the twelve forms — wrap its labelled
controls in `FormField`, keep `useTransition` and the label swap, and use `Callout` for its
error block.

- [ ] **Step 4: Delete the five baseline entries, run the gate, commit**

```bash
npm run verify
```
Expected: green.

```bash
git add "src/app/(app)/bets" "src/app/(app)/wagers" src/app/__tests__/token-lint.test.ts
git commit -m "$(cat <<'MSG'
refactor(ui): bets and wagers onto the token vocabulary

Both segmented controls go through the shared component; the active segment
is a span now rather than a link to the page you are on.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 12: Sweep — events

The largest group: five files, four of them forms, and the densest concentration of tone
colours in the app.

**Files:**
- Modify: `src/app/(app)/events/page.tsx`, `src/app/(app)/events/new/event-form.tsx`
- Modify: `src/app/(app)/events/[eventId]/page.tsx`, `src/app/(app)/events/[eventId]/market-card.tsx`, `src/app/(app)/events/[eventId]/dispute-form.tsx`
- Modify: `src/app/(app)/events/[eventId]/resolve/page.tsx`, `src/app/(app)/events/[eventId]/resolve/resolve-form.tsx`
- Modify: `src/app/__tests__/token-lint.test.ts` (delete seven baseline entries)

**Interfaces:**
- Consumes: `FormField` (Task 6), `Callout` (Task 5), `Button` (Task 4), `Card` (Task 5),
  `Badge` (Task 7).
- Produces: nothing new.

- [ ] **Step 1: Convert `event-form.tsx`'s two shared class constants**

The file keeps its input styling in two module-level constants:

```tsx
const fieldClass =
  'rounded-xl border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900';
const fieldErrorClass =
  'rounded-xl border border-red-400 px-3 py-2 text-sm dark:border-red-600 dark:bg-zinc-900';
```

become:

```tsx
const fieldClass =
  'rounded-card border border-line-strong bg-surface-raised px-3 py-2 text-sm';
const fieldErrorClass =
  'rounded-card border border-negative-line bg-surface-raised px-3 py-2 text-sm';
```

Leave `inputMode="text"` on the two odds inputs exactly as it is. That is 7a's fix for the
mobile keyboard with no minus key, and `inputMode="numeric"` would look tidier and break
negative American prices on every phone.

- [ ] **Step 2: Convert the per-market error blocks to `Callout`**

The `<p className="text-xs text-red-600 dark:text-red-400">` error lines become
`text-xs text-negative`. The bordered market container's conditional
`border-red-400 dark:border-red-600` → `border-negative-line`.

The event-level error block — the one with its own background — becomes `<Callout>`.

- [ ] **Step 3: Sweep the remaining six files**

Apply the mapping table. `[eventId]/page.tsx` has the amber disclosure section
(`border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950`) — that is
`<Callout tone="caution">`. `market-card.tsx`'s inline amber chip becomes
`<Badge tone="caution">`.

- [ ] **Step 4: Delete the seven baseline entries, run the gate, commit**

```bash
npm run verify
```
Expected: green.

```bash
git add "src/app/(app)/events" src/app/__tests__/token-lint.test.ts
git commit -m "$(cat <<'MSG'
refactor(ui): custom events onto the token vocabulary

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 13: Sweep — admin, and the baseline reaches zero

**Files:**
- Modify: `src/app/admin/page.tsx`, `src/app/admin/events/page.tsx`, `src/app/admin/events/void-form.tsx`, `src/app/admin/wagers/page.tsx`, `src/app/admin/wagers/arbitration-form.tsx`
- Modify: `src/app/__tests__/token-lint.test.ts` (delete the last five entries)

**Interfaces:**
- Consumes: `Callout` (Task 5), `Button` (Task 4), `Card` (Task 5), `Badge` (Task 7).
- Produces: nothing new.

**Background:** The mobile audit found the admin section renders with no header or tab bar at
all on a phone, and assigned that to **7d**. Do not fix it here. It is a structural decision
about whether admin joins the `(app)` shell, not a colour one.

- [ ] **Step 1: Sweep the five files**

The two tinted queue blocks are `Callout` call sites: `admin/events/page.tsx`'s overdue queue
(`border-amber-200 bg-amber-50 hover:border-amber-300 dark:…`) is
`<Callout tone="caution">`, and `void-form.tsx`'s confirmation
(`border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30`) is `<Callout>`.

`admin/events/page.tsx` also has the mobile-audit finding where the heading and the "Back to
admin" link run together. **Leave it.** It is assigned to 7c and fixing it here is a layout
change inside a colour-only sweep.

- [ ] **Step 2: Empty the baseline**

Remove the last five entries. `BASELINE` should now read:

```ts
const BASELINE: string[] = [];
```

Leave the constant and its comment in place — the reverse assertion iterates an empty list
harmlessly, and the next person to add a screen-wide exception will find the mechanism rather
than inventing a worse one.

- [ ] **Step 3: Confirm the sweep is actually complete**

```bash
grep -rnE 'dark:|-(zinc|slate|gray|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}|-(white|black)\b' src --include=*.tsx \
  | grep -vE 'icon\.tsx|apple-icon\.tsx|global-error\.tsx|token-lint\.test\.ts'
```
Expected: **no output.** Any line here is a file the lint should have caught; if the grep finds
something the test did not, the test's regex has a gap — widen it rather than special-casing
the file.

- [ ] **Step 4: Run the gate and commit**

```bash
npm run verify
```
Expected: green.

```bash
git add src/app/admin src/app/__tests__/token-lint.test.ts
git commit -m "$(cat <<'MSG'
refactor(ui): admin onto the token vocabulary; the sweep baseline is empty

Every .tsx file under src/ now speaks only the semantic vocabulary. All 144
hand-written dark: variants are gone.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 14: The browser audit

The token lint cannot see a token used in the wrong *role* — `bg-surface-muted` where
`bg-surface-sunken` was meant renders wrong and passes green. This task is what catches that,
which is why the spec makes it a success criterion rather than a nicety.

**Files:**
- Create: `docs/design-system-audit.md`
- Modify: whichever files the audit finds bugs in

**Interfaces:**
- Consumes: everything.
- Produces: `docs/design-system-audit.md`, which 7c reads as its starting point.

**Background:** Chromium is pre-installed and Playwright is configured to find it —
`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, and `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` stops npm
from re-fetching it. **Do not run `playwright install`.** Playwright is not a project
dependency and must not become one ([D53](../decisions.md#d53--the-shared-component-set-is-scoped-to-call-sites-that-exist));
drive the browser from a throwaway script outside `package.json`, or from
[`npx`](https://docs.npmjs.com/cli/commands/npx), and delete it when the audit is written.

- [ ] **Step 1: Capture the "before" set**

```bash
git stash list  # confirm nothing pending
git worktree add /tmp/7b-before c2bb3a9   # the last commit before phase 7b
```

`c2bb3a9` is `fix(ui): address final review findings for phase 7a` — the tip of the app as it
looked entering this phase. Run the app from that worktree and capture the same routes, so the
comparison in Step 3 is mechanical rather than from memory.

- [ ] **Step 2: Capture the "after" set**

Eighteen routes, two themes, two viewports. Force the theme with CDP's
`Emulation.setEmulatedMedia` (Playwright: `page.emulateMedia({ colorScheme: 'dark' })`) rather
than by editing CSS — what must be verified is the shipped media query, not a hand-set
attribute.

The eighteen routes, from the 7a mobile audit: `/games`, `/events`, `/events/new`,
`/events/[eventId]`, `/events/[eventId]/resolve`, `/feed`, `/feed/[eventId]`, `/bets`,
`/bets?currency=CREDITS`, `/wagers`, `/wagers/new`, `/wagers/[wagerId]`, `/standings`, `/me`,
`/me/feed-preferences`, `/members/[membershipId]`, `/admin`, `/admin/events`, `/admin/wagers`.
Seed first so the detail routes have content:

```bash
npm run db:up && npm run db:migrate && npm run db:seed
```

- [ ] **Step 3: Compare, and classify every difference**

Each difference is one of exactly two things:

- **One of the four declared changes** (spec, "Declared visible changes") — record it and move
  on.
- **A bug** — fix it, then re-capture that route.

There is no third category. "Looks a bit different but fine" is how a token used in the wrong
role survives a phase.

- [ ] **Step 4: Write the audit**

Create `docs/design-system-audit.md`, following the shape of
[`docs/mobile-audit.md`](../mobile-audit.md): a summary paragraph, then a findings table with
columns Screen / Finding / Severity / Rung. Assign each unfixed finding to the rung that owns
it — most will be 7c — exactly as the mobile audit did, so the two documents read as one series.

State explicitly which routes had nothing to report. The mobile audit's "Screens with nothing
to report" section is the part 7c will actually use.

- [ ] **Step 5: Clean up and commit**

```bash
git worktree remove /tmp/7b-before
```

Confirm no Playwright artefact leaked into the repo:

```bash
git status --short
grep -n playwright package.json   # expected: no output
```

```bash
npm run verify
git add docs/design-system-audit.md src
git commit -m "$(cat <<'MSG'
docs: the phase 7b design-system audit

Eighteen routes, both themes, two viewports, compared against captures from
the tip of 7a. Findings that are not one of the four declared changes are
fixed here or assigned to the rung that owns them.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 15: Close out the phase

**Files:**
- Modify: `docs/roadmap.md`
- Modify: `docs/README.md`
- Modify: `README.md`

- [ ] **Step 1: Mark 7b built in the roadmap**

In `docs/roadmap.md`, the phase-7 rung table has a row reading
`**Specified** ([spec](…), [plan](…))` for 7b. Change it to **Built**, and add the audit to its
links so the row matches 7a's shape:

```
| [7b](#7b--design-system) | Design system — tokens, dark mode, the shared set | **Built** ([spec](specs/2026-08-24-design-system-design.md), [plan](plans/2026-08-24-design-system-implementation-plan.md), [design-system audit](design-system-audit.md)) |
```

Change the 7b section's own status line from **Specified** to **Built**, and rewrite its "What
it does" bullets in the past tense, describing what shipped.

- [ ] **Step 2: Move anything the audit deferred into the owning rung's backlog**

If Task 14 assigned findings to 7c or 7d, add them to the `What 7c inherits` / `What 7d
inherits` tables with `7b (design-system audit)` in the "Deferred by" column. This is the
tracking obligation the phase carries — a finding recorded only in the audit is a finding
nobody will act on.

- [ ] **Step 3: Add the audit to the docs index**

In `docs/README.md`, add a row beside the mobile audit's:

```
| [Design-system audit](design-system-audit.md) | All 18 routes in both themes at two viewports, after the 7b sweep, with each remaining finding assigned to a rung |
```

- [ ] **Step 4: Update the root README's test counts**

`README.md` quotes a test-file and test count. Run `npm run verify` and update both to the real
figures — this phase adds two test files.

- [ ] **Step 5: Run the whole gate one last time**

```bash
npm run verify && npm run build
```
Expected: both green.

- [ ] **Step 6: Commit and push**

```bash
git add docs README.md
git commit -m "$(cat <<'MSG'
docs: mark phase 7b built

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
git push -u origin claude/roadmap-7b-plan-il1opu
```

Do **not** open a pull request unless asked.

---

## Definition of done

The phase is complete when every one of the spec's ten success criteria holds. Check them
literally rather than from memory — the two that are easiest to believe without evidence are
the ones most worth running:

```bash
# Criterion 2: zero dark: variants outside the token layer.
grep -rn 'dark:' src --include=*.tsx | grep -v token-lint.test.ts
# Expected: no output.

# Criterion 8: the app renders in Geist.
grep -n 'font-family' src/app/globals.css
# Expected: var(--font-geist-sans), and no Arial anywhere.
```
