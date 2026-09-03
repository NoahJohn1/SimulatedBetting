import { describe, expect, it } from 'vitest';
import { parseLine } from '../parse-line';

describe('parseLine', () => {
  it('strips the leading + on a positive spread', () => {
    expect(parseLine('+1.5')).toBe('1.5');
  });

  it('leaves a negative spread untouched', () => {
    expect(parseLine('-1.5')).toBe('-1.5');
  });

  it('strips the o prefix on an over total', () => {
    expect(parseLine('o36.5')).toBe('36.5');
  });

  it('strips the u prefix on an under total', () => {
    expect(parseLine('u36.5')).toBe('36.5');
  });

  it('leaves a whole-number line untouched', () => {
    expect(parseLine('-3')).toBe('-3');
  });

  it('throws on ESPN\'s "OFF" (a pulled market, not a line)', () => {
    expect(() => parseLine('OFF')).toThrow();
  });

  it('throws on more than 2 decimal places, matching normalizeLine exactly', () => {
    expect(() => parseLine('-3.456')).toThrow();
  });

  it('accepts exactly 2 decimal places', () => {
    expect(parseLine('-3.45')).toBe('-3.45');
  });

  it('throws when the magnitude would overflow the numeric(5,2) selections.line column', () => {
    expect(() => parseLine('o1234.5')).toThrow();
  });
});
