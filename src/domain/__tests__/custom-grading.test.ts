import { describe, expect, it } from 'vitest';
import { currencyForKinds, gradeCustomLeg } from '@/domain/custom-grading';

describe('gradeCustomLeg', () => {
  it('grades the winning selection WON', () => {
    expect(gradeCustomLeg({ selectionId: 'a', winningSelectionId: 'a' })).toBe('WON');
  });

  it('grades any other selection LOST', () => {
    expect(gradeCustomLeg({ selectionId: 'b', winningSelectionId: 'a' })).toBe('LOST');
  });

  it('grades PENDING while the market is unresolved', () => {
    expect(gradeCustomLeg({ selectionId: 'a', winningSelectionId: null })).toBe('PENDING');
  });
});

describe('currencyForKinds', () => {
  it('is CASH for an all-game slip', () => {
    expect(currencyForKinds(['GAME', 'GAME'])).toEqual({ ok: true, currency: 'CASH' });
  });

  it('is CREDITS for an all-custom slip', () => {
    expect(currencyForKinds(['CUSTOM'])).toEqual({ ok: true, currency: 'CREDITS' });
  });

  it('rejects a mixed slip and reports both index lists', () => {
    expect(currencyForKinds(['GAME', 'CUSTOM', 'GAME'])).toEqual({
      ok: false,
      gameIndexes: [0, 2],
      customIndexes: [1],
    });
  });

  it('throws on an empty leg list', () => {
    expect(() => currencyForKinds([])).toThrow();
  });
});
