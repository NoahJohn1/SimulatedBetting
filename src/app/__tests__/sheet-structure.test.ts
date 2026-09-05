import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The bet slip's Sheet (D74/D79 successor for `<lg`): a hand-rolled portal dialog rather than
 * `ConfirmDialog`'s native `<dialog>`, because the slip needs bottom-sheet placement and
 * safe-area padding a native dialog's centered `showModal()` doesn't give for free. There is
 * no jsdom in this project and no component-test harness (D51), so what this checks is source
 * text: the accessible-dialog contract (`role="dialog"`, `aria-modal="true"`, a body scroll
 * lock) and the death of bet-slip.tsx's old magic-number coupling to TabBar's rendered height.
 */

const SHEET = join(process.cwd(), 'src', 'components', 'ui', 'sheet.tsx');
const BET_SLIP = join(process.cwd(), 'src', 'components', 'bet-slip', 'bet-slip.tsx');
const SLIP_PANEL = join(process.cwd(), 'src', 'components', 'bet-slip', 'slip-panel.tsx');
const SLIP_RAIL = join(process.cwd(), 'src', 'components', 'bet-slip', 'slip-rail.tsx');
const GAMES_PAGE = join(process.cwd(), 'src', 'app', '(app)', 'games', 'page.tsx');

const sheetSource = () => readFileSync(SHEET, 'utf8');
const betSlipSource = () => readFileSync(BET_SLIP, 'utf8');
const slipPanelSource = () => readFileSync(SLIP_PANEL, 'utf8');
const slipRailSource = () => readFileSync(SLIP_RAIL, 'utf8');
const gamesPageSource = () => readFileSync(GAMES_PAGE, 'utf8');

describe('Sheet', () => {
  it('is an accessible dialog', () => {
    expect(sheetSource()).toMatch(/role="dialog"/);
    expect(sheetSource()).toMatch(/aria-modal="true"/);
  });

  it('locks document.body scroll while open', () => {
    expect(sheetSource()).toMatch(/document\.body\.style\.overflow/);
  });

  it('renders through a portal', () => {
    expect(sheetSource()).toMatch(/createPortal/);
  });

  it('dismisses on Escape', () => {
    expect(sheetSource()).toMatch(/Escape/);
  });

  it('is a client component', () => {
    expect(sheetSource()).toMatch(/^'use client';/m);
  });
});

describe('bet slip structure (D74/D79)', () => {
  it('no longer hardcodes the TabBar-height magic number', () => {
    expect(betSlipSource()).not.toMatch(/bottom-\[calc\(41px/);
  });

  it('opens the Sheet rather than an inline expansion', () => {
    expect(betSlipSource()).toMatch(/from '@\/components\/ui\/sheet'/);
    expect(betSlipSource()).toMatch(/<Sheet/);
  });

  it('exposes the shared panel contents as SlipPanel', () => {
    expect(slipPanelSource()).toMatch(/export function SlipPanel/);
    expect(slipPanelSource()).toMatch(/^'use client';/m);
  });

  it('each leg shows its price and a payout summary appears before the stake input', () => {
    expect(slipPanelSource()).toMatch(/<Price american=\{leg\.priceAmerican\}/);
    expect(slipPanelSource()).toMatch(/payoutCents\(/);
    expect(slipPanelSource()).toMatch(/combine\(/);
    expect(slipPanelSource()).toMatch(/americanToRational\(/);
  });

  it('placing a bet toasts rather than showing an inline success message', () => {
    expect(slipPanelSource()).toMatch(/toast\(\{\s*tone: 'positive'/);
    expect(slipPanelSource()).toMatch(/toast\(\{\s*tone: 'negative'/);
  });

  it('the rail renders SlipPanel inside a lg-only aside', () => {
    expect(slipRailSource()).toMatch(/hidden lg:block/);
    expect(slipRailSource()).toMatch(/SlipPanel/);
  });

  it('the games page lays out a two-pane grid with the rail on the right', () => {
    expect(gamesPageSource()).toMatch(/lg:grid-cols-\[minmax\(0,1fr\)_21rem\]/);
    expect(gamesPageSource()).toMatch(/SlipRail/);
  });
});
