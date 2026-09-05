/**
 * Plain constants shared by the board's server and client pieces. Deliberately its own module,
 * with no `'use client'` directive: `day-section.tsx` and `game-row.tsx` are server components,
 * and importing a plain value out of a `'use client'` module (odds-cell.tsx) from server code
 * doesn't give you the value — Next's compiler rewrites that import into a client-reference
 * proxy meant for passing components as props, not for reading data out of. `MARKET_ORDER.map`
 * on a proxy throws `MARKET_ORDER.map is not a function` at render time, which the test suite
 * (no jsdom, no runtime harness) has no way to catch — this is a real bug found only by
 * running the page in a browser.
 */
export const MARKET_ORDER = ['SPREAD', 'MONEYLINE', 'TOTAL'] as const;
export const MARKET_LABEL: Record<string, string> = {
  SPREAD: 'Spread',
  MONEYLINE: 'Money',
  TOTAL: 'Total',
};
