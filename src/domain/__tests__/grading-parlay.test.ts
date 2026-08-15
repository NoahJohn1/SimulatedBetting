import { describe, expect, it } from 'vitest';
import { gradeParlay, settledPayoutCents } from '@/domain/grading';

describe('gradeParlay', () => {
  it('wins when every leg wins', () => {
    expect(gradeParlay(['WON', 'WON', 'WON'])).toBe('WON');
  });

  it('loses as soon as one leg loses, even with legs pending', () => {
    expect(gradeParlay(['WON', 'LOST', 'PENDING'])).toBe('LOST');
  });

  it('stays pending while legs are unresolved', () => {
    expect(gradeParlay(['WON', 'PENDING'])).toBe('PENDING');
  });

  it('wins on the surviving legs when one pushes', () => {
    expect(gradeParlay(['WON', 'PUSHED', 'WON'])).toBe('WON');
  });

  it('pushes when every leg pushed or voided', () => {
    expect(gradeParlay(['PUSHED', 'VOIDED'])).toBe('PUSHED');
  });
});

describe('settledPayoutCents', () => {
  it('pays a two-leg parlay at combined odds', () => {
    const payout = settledPayoutCents(10_000n, [
      { status: 'WON', priceAmerican: -110 },
      { status: 'WON', priceAmerican: -110 },
    ]);
    expect(payout).toBe(36_446n);
  });

  it('drops a pushed leg and pays the reduced parlay', () => {
    const threeLegs = settledPayoutCents(10_000n, [
      { status: 'WON', priceAmerican: -110 },
      { status: 'PUSHED', priceAmerican: -110 },
      { status: 'WON', priceAmerican: -110 },
    ]);
    const twoLegs = settledPayoutCents(10_000n, [
      { status: 'WON', priceAmerican: -110 },
      { status: 'WON', priceAmerican: -110 },
    ]);
    expect(threeLegs).toBe(twoLegs);
  });

  it('refunds the stake when every leg pushed', () => {
    expect(
      settledPayoutCents(10_000n, [
        { status: 'PUSHED', priceAmerican: -110 },
        { status: 'VOIDED', priceAmerican: 150 },
      ]),
    ).toBe(10_000n);
  });

  it('pays nothing when any leg lost', () => {
    expect(
      settledPayoutCents(10_000n, [
        { status: 'WON', priceAmerican: -110 },
        { status: 'LOST', priceAmerican: -110 },
      ]),
    ).toBe(0n);
  });

  it('throws when a leg is still pending', () => {
    expect(() =>
      settledPayoutCents(10_000n, [{ status: 'PENDING', priceAmerican: -110 }]),
    ).toThrow();
  });
});
