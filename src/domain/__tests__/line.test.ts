import { describe, expect, it } from 'vitest';
import { linesEqual, lineToNumber, normalizeLine } from '@/domain/line';

describe('normalizeLine', () => {
  it('strips a trailing fractional zero', () => {
    expect(normalizeLine('-3.50')).toBe('-3.5');
  });

  it('leaves an already-canonical value untouched', () => {
    expect(normalizeLine('-3.5')).toBe('-3.5');
  });

  it('accepts a number input', () => {
    expect(normalizeLine(-3.5)).toBe('-3.5');
  });

  it('strips a trailing whole-number fraction', () => {
    expect(normalizeLine('44.00')).toBe('44');
  });

  it('strips a trailing fraction down to zero', () => {
    expect(normalizeLine('0.0')).toBe('0');
  });

  it('collapses negative zero to zero', () => {
    expect(normalizeLine('-0')).toBe('0');
  });

  it('passes null through', () => {
    expect(normalizeLine(null)).toBe(null);
  });

  it('throws on a non-numeric string', () => {
    expect(() => normalizeLine('abc')).toThrow();
  });

  it('throws on a value finer than a quarter point', () => {
    expect(() => normalizeLine('1.234')).toThrow();
  });
});

describe('linesEqual', () => {
  it('treats a string and equivalent number as equal', () => {
    expect(linesEqual('-3.50', -3.5)).toBe(true);
  });

  it('treats differently-formatted equal strings as equal', () => {
    expect(linesEqual('44', '44.0')).toBe(true);
  });

  it('treats null and null as equal', () => {
    expect(linesEqual(null, null)).toBe(true);
  });

  it('never treats null and a pick-em spread of 0 as equal', () => {
    expect(linesEqual(null, '0')).toBe(false);
  });

  it('treats different lines as unequal', () => {
    expect(linesEqual('-3.5', '-4')).toBe(false);
  });
});

describe('lineToNumber', () => {
  it('converts a normalized string to a number', () => {
    expect(lineToNumber('-3.5')).toBe(-3.5);
  });

  it('passes null through', () => {
    expect(lineToNumber(null)).toBe(null);
  });
});
