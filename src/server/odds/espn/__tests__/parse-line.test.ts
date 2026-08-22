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
});
