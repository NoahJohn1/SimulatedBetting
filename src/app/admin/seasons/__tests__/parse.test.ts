import { describe, expect, it } from 'vitest';
import { parseAmountToCents } from '@/app/admin/seasons/parse';

describe('parseAmountToCents', () => {
  it.each([
    ['10000', 1_000_000n],
    ['10000.00', 1_000_000n],
    ['500.5', 50_050n],
    ['500.55', 50_055n],
    ['0', 0n],
  ])('reads %s as %s cents', (input, expected) => {
    expect(parseAmountToCents(input, 'Starting bankroll')).toBe(expected);
  });

  it.each(['', ' ', 'abc', '-5', '1.234', '1,000'])('rejects %s', (input) => {
    expect(() => parseAmountToCents(input, 'Starting bankroll')).toThrow('Starting bankroll');
  });
});
