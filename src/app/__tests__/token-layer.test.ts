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
  'surface',
  'surface-raised',
  'surface-sunken',
  'surface-muted',
  'surface-skeleton',
  'line',
  'line-strong',
  'line-hover',
  'line-subtle',
  'ink',
  'ink-secondary',
  'ink-muted',
  'ink-subtle',
  'accent',
  'accent-ink',
  'positive',
  'positive-surface',
  'positive-surface-soft',
  'positive-line',
  'positive-on-surface',
  'negative',
  'negative-surface',
  'negative-surface-soft',
  'negative-line',
  'negative-on-surface',
  'caution',
  'caution-surface',
  'caution-surface-soft',
  'caution-line',
  'caution-on-surface',
  'slip-shadow',
];

/** Every `--name:` declared in a chunk of CSS, in source order. */
function declared(block: string): string[] {
  return [...block.matchAll(/^\s*--([a-z0-9-]+)\s*:/gim)].map((m) => m[1]);
}

/** The two dark palettes, delimited by marker comments so the test can compare them. */
function darkBlocks(): string[] {
  return [...CSS.matchAll(/\/\* DARK-PALETTE-START \*\/([\s\S]*?)\/\* DARK-PALETTE-END \*\//g)].map(
    (m) => m[1],
  );
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
        expect(theme, `--color-${token} not exposed`).toContain(
          `--color-${token}: var(--${token})`,
        );
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
