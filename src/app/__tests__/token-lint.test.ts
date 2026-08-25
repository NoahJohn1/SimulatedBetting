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
  'src/app/(app)/me/page.tsx',
  'src/app/(app)/members/[membershipId]/page.tsx',
  'src/app/(app)/wagers/[wagerId]/page.tsx',
  'src/app/(app)/wagers/[wagerId]/wager-actions.tsx',
  'src/app/(app)/wagers/new/wager-form.tsx',
  'src/app/(app)/wagers/page.tsx',
  'src/app/admin/events/page.tsx',
  'src/app/admin/events/void-form.tsx',
  'src/app/admin/page.tsx',
  'src/app/admin/wagers/arbitration-form.tsx',
  'src/app/admin/wagers/page.tsx',
  'src/components/bet-slip/bet-slip.tsx',
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
