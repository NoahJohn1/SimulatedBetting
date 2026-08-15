import { describe, expect, it } from 'vitest';
import { americanToRational, combine, payoutCents, rationalToAmerican } from '@/domain/odds';

describe('americanToRational', () => {
  it('converts a favourite', () => {
    expect(americanToRational(-110)).toEqual({ num: 210n, den: 110n });
  });

  it('converts an underdog', () => {
    expect(americanToRational(150)).toEqual({ num: 250n, den: 100n });
  });

  it('rejects prices inside the invalid band', () => {
    expect(() => americanToRational(0)).toThrow();
    expect(() => americanToRational(50)).toThrow();
    expect(() => americanToRational(-99)).toThrow();
  });

  it('rejects non-integer prices', () => {
    expect(() => americanToRational(-110.5)).toThrow();
  });
});

describe('payoutCents', () => {
  it('returns stake plus profit for a single bet', () => {
    expect(payoutCents(10_000n, americanToRational(-110))).toBe(19_091n);
    expect(payoutCents(10_000n, americanToRational(150))).toBe(25_000n);
  });

  it('rounds half up', () => {
    // 3 cents at +150 = 7.5 cents exactly
    expect(payoutCents(3n, americanToRational(150))).toBe(8n);
  });

  it('computes a three-leg parlay with a single rounding', () => {
    const parlay = combine([
      americanToRational(-110),
      americanToRational(-110),
      americanToRational(150),
    ]);
    expect(payoutCents(10_000n, parlay)).toBe(91_116n);
  });

  it('never loses precision on large parlays', () => {
    const legs = Array.from({ length: 10 }, () => americanToRational(-110));
    const payout = payoutCents(10_000n, combine(legs));
    expect(payout).toBeGreaterThan(10_000n);
    expect(typeof payout).toBe('bigint');
  });
});

describe('rationalToAmerican', () => {
  it('round-trips a favourite and an underdog', () => {
    expect(rationalToAmerican(americanToRational(-110))).toBe(-110);
    expect(rationalToAmerican(americanToRational(150))).toBe(150);
  });

  it('expresses combined parlay odds as a positive price', () => {
    const parlay = combine([americanToRational(-110), americanToRational(-110)]);
    expect(rationalToAmerican(parlay)).toBe(264);
  });
});
