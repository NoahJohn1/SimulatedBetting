import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The odds board rebuild (D77): the card-per-game board dies, replaced by compact two-line
 * rows inside collapsible day sections. There is no jsdom in this project and no
 * component-test harness (D51), so what this checks is source text — the filters are links
 * (not client state), sections are native <details>/<summary>, and the odds cell is a real
 * extraction out of the row rather than something re-inlined at the new call site.
 */

const GAMES = join(process.cwd(), 'src', 'app', '(app)', 'games');
const PAGE = join(GAMES, 'page.tsx');
const SECTION = join(GAMES, 'day-section.tsx');
const ROW = join(GAMES, 'game-row.tsx');
const CELL = join(GAMES, 'odds-cell.tsx');
const CARD = join(GAMES, 'game-card.tsx');
const META = join(GAMES, 'market-meta.ts');

const pageSource = () => readFileSync(PAGE, 'utf8');
const sectionSource = () => readFileSync(SECTION, 'utf8');
const rowSource = () => readFileSync(ROW, 'utf8');
const cellSource = () => readFileSync(CELL, 'utf8');
const metaSource = () => readFileSync(META, 'utf8');

describe('odds board structure (D77)', () => {
  it('filters are links driven by searchParams, not client state', () => {
    expect(pageSource()).toMatch(/searchParams/);
    expect(pageSource()).not.toMatch(/'use client'/);
  });

  it('day sections are native details/summary', () => {
    expect(sectionSource()).toMatch(/<details/);
    expect(sectionSource()).toMatch(/<summary/);
  });

  it('the column header row lives in the day section, not in every row', () => {
    expect(sectionSource()).toMatch(/SPREAD|Spread/);
    expect(rowSource()).not.toMatch(/Spread|SPREAD/);
  });

  it('the odds cell is extracted out of the row, not inlined', () => {
    expect(rowSource()).toMatch(/OddsCell/);
    expect(rowSource()).not.toMatch(/useSlip/);
    expect(cellSource()).toMatch(/export function OddsCell/);
  });

  it('the cell keeps the slip-context toggle and suspended dash rendering', () => {
    expect(cellSource()).toMatch(/useSlip/);
    expect(cellSource()).toMatch(/slip\.toggle/);
    expect(cellSource()).toMatch(/—/);
  });

  it('game-card.tsx is gone', () => {
    expect(existsSync(CARD)).toBe(false);
  });

  /**
   * The market metadata (MARKET_ORDER/MARKET_LABEL) has to live in a plain, non-'use client'
   * module. odds-cell.tsx is a client component; a server component that imports a plain value
   * out of a 'use client' module gets a client-reference proxy instead of the value, and
   * `MARKET_ORDER.map` on that proxy throws at render time (found in the live browser pass,
   * not by this suite — there is no jsdom here). Guarding the import path is the cheapest
   * thing this text-only suite can do against that regression.
   */
  it('market metadata lives in a plain module the server components can actually read', () => {
    expect(existsSync(META)).toBe(true);
    expect(metaSource()).not.toMatch(/^'use client';/m);
    expect(metaSource()).toMatch(/MARKET_ORDER/);
    expect(metaSource()).toMatch(/MARKET_LABEL/);
    expect(sectionSource()).toMatch(/from '\.\/market-meta'/);
    expect(rowSource()).toMatch(/from '\.\/market-meta'/);
  });
});
