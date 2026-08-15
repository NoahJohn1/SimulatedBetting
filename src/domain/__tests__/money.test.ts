import { describe, expect, it } from 'vitest';
import { dollarsToCents, formatCents } from '@/domain/money';

describe('dollarsToCents', () => {
  it('converts whole and fractional dollars', () => {
    expect(dollarsToCents(100)).toBe(10_000n);
    expect(dollarsToCents('10.5')).toBe(1_050n);
    expect(dollarsToCents('0.07')).toBe(7n);
  });

  it('rejects sub-cent precision', () => {
    expect(() => dollarsToCents('1.234')).toThrow();
  });

  it('rejects values that are not numbers', () => {
    expect(() => dollarsToCents('abc')).toThrow();
  });
});

describe('formatCents', () => {
  it('formats positive, negative, and zero', () => {
    expect(formatCents(19_091n)).toBe('$190.91');
    expect(formatCents(-50_000n)).toBe('-$500.00');
    expect(formatCents(0n)).toBe('$0.00');
  });

  it('groups thousands', () => {
    expect(formatCents(1_000_000n)).toBe('$10,000.00');
  });
});
