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

const pageSource = () => readFileSync(PAGE, 'utf8');
const sectionSource = () => readFileSync(SECTION, 'utf8');
const rowSource = () => readFileSync(ROW, 'utf8');
const cellSource = () => readFileSync(CELL, 'utf8');

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
});
