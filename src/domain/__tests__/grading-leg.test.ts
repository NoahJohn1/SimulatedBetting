import { describe, expect, it } from 'vitest';
import { gradeLeg } from '@/domain/grading';

const result = { homeScore: 24, awayScore: 20 };

describe('gradeLeg — moneyline', () => {
  it('grades the winner and loser', () => {
    expect(gradeLeg({ marketType: 'MONEYLINE', side: 'HOME', line: null, result })).toBe('WON');
    expect(gradeLeg({ marketType: 'MONEYLINE', side: 'AWAY', line: null, result })).toBe('LOST');
  });

  it('pushes a tie', () => {
    const tie = { homeScore: 20, awayScore: 20 };
    expect(gradeLeg({ marketType: 'MONEYLINE', side: 'HOME', line: null, result: tie })).toBe(
      'PUSHED',
    );
  });

  it('rejects a line on a moneyline', () => {
    expect(() => gradeLeg({ marketType: 'MONEYLINE', side: 'HOME', line: -3.5, result })).toThrow();
  });
});

describe('gradeLeg — spread', () => {
  it('covers and fails to cover', () => {
    expect(gradeLeg({ marketType: 'SPREAD', side: 'HOME', line: -3.5, result })).toBe('WON');
    expect(gradeLeg({ marketType: 'SPREAD', side: 'HOME', line: -6.5, result })).toBe('LOST');
    expect(gradeLeg({ marketType: 'SPREAD', side: 'AWAY', line: 6.5, result })).toBe('WON');
  });

  it('pushes on an exact whole-number hit', () => {
    expect(gradeLeg({ marketType: 'SPREAD', side: 'HOME', line: -4, result })).toBe('PUSHED');
    expect(gradeLeg({ marketType: 'SPREAD', side: 'AWAY', line: 4, result })).toBe('PUSHED');
  });

  it('never pushes on a half-point line', () => {
    for (const line of [-3.5, -4.5, 0.5]) {
      expect(gradeLeg({ marketType: 'SPREAD', side: 'HOME', line, result })).not.toBe('PUSHED');
    }
  });

  it('requires a line', () => {
    expect(() => gradeLeg({ marketType: 'SPREAD', side: 'HOME', line: null, result })).toThrow();
  });

  it('rejects an over/under side', () => {
    expect(() => gradeLeg({ marketType: 'SPREAD', side: 'OVER', line: -3.5, result })).toThrow();
  });
});

describe('gradeLeg — total', () => {
  it('grades over and under', () => {
    expect(gradeLeg({ marketType: 'TOTAL', side: 'OVER', line: 43.5, result })).toBe('WON');
    expect(gradeLeg({ marketType: 'TOTAL', side: 'UNDER', line: 43.5, result })).toBe('LOST');
    expect(gradeLeg({ marketType: 'TOTAL', side: 'UNDER', line: 44.5, result })).toBe('WON');
  });

  it('pushes on an exact whole-number total', () => {
    expect(gradeLeg({ marketType: 'TOTAL', side: 'OVER', line: 44, result })).toBe('PUSHED');
    expect(gradeLeg({ marketType: 'TOTAL', side: 'UNDER', line: 44, result })).toBe('PUSHED');
  });

  it('rejects a home/away side', () => {
    expect(() => gradeLeg({ marketType: 'TOTAL', side: 'HOME', line: 44, result })).toThrow();
  });
});
