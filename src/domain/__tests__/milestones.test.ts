import { describe, expect, it } from 'vitest';
import {
  isBigWin,
  isParlayHit,
  multipleBasisPoints,
  pickLeader,
  survivingLegCount,
} from '@/domain/milestones';

describe('isBigWin', () => {
  it('fires at exactly ten times the stake', () => {
    expect(isBigWin(10_000n, 100_000n)).toBe(true);
  });

  it('does not fire just under ten times', () => {
    expect(isBigWin(10_000n, 99_999n)).toBe(false);
  });

  it('does not fire on a zero payout', () => {
    expect(isBigWin(10_000n, 0n)).toBe(false);
  });

  it('does not divide by zero on a zero stake', () => {
    expect(isBigWin(0n, 100_000n)).toBe(false);
  });
});

describe('multipleBasisPoints', () => {
  it('reports 12.4x as 124000 basis points', () => {
    expect(multipleBasisPoints(5_000n, 62_000n)).toBe(124_000);
  });

  it('truncates rather than rounding, and never returns a float', () => {
    const bp = multipleBasisPoints(3n, 10n);
    expect(bp).toBe(33_333);
    expect(Number.isInteger(bp)).toBe(true);
  });

  it('returns 0 for a zero stake instead of Infinity', () => {
    expect(multipleBasisPoints(0n, 10_000n)).toBe(0);
  });
});

describe('survivingLegCount', () => {
  it('counts only legs that were not removed', () => {
    expect(survivingLegCount(['WON', 'WON', 'PUSHED', 'VOIDED', 'WON'])).toBe(3);
  });
});

describe('isParlayHit', () => {
  it('fires on a won parlay with four surviving legs', () => {
    expect(isParlayHit('PARLAY', 'WON', ['WON', 'WON', 'WON', 'WON'])).toBe(true);
  });

  it('does not fire on three surviving legs', () => {
    expect(isParlayHit('PARLAY', 'WON', ['WON', 'WON', 'WON'])).toBe(false);
  });

  it('does not fire when pushes reduce a five-leg parlay below the threshold', () => {
    expect(isParlayHit('PARLAY', 'WON', ['WON', 'WON', 'WON', 'PUSHED', 'PUSHED'])).toBe(false);
  });

  it('never fires on a single', () => {
    expect(isParlayHit('SINGLE', 'WON', ['WON'])).toBe(false);
  });

  it('never fires on a parlay that did not win', () => {
    expect(isParlayHit('PARLAY', 'LOST', ['WON', 'WON', 'WON', 'LOST'])).toBe(false);
  });
});

describe('pickLeader', () => {
  it('returns the single highest balance', () => {
    const leader = pickLeader([
      { membershipId: 'a', balanceCents: 100n },
      { membershipId: 'b', balanceCents: 300n },
      { membershipId: 'c', balanceCents: 200n },
    ]);
    expect(leader?.membershipId).toBe('b');
  });

  it('returns null when the top balance is tied — a tie has no leader', () => {
    expect(
      pickLeader([
        { membershipId: 'a', balanceCents: 300n },
        { membershipId: 'b', balanceCents: 300n },
      ]),
    ).toBeNull();
  });

  it('returns null for an empty season', () => {
    expect(pickLeader([])).toBeNull();
  });

  it('returns the only member when there is exactly one', () => {
    expect(pickLeader([{ membershipId: 'a', balanceCents: 1n }])?.membershipId).toBe('a');
  });
});
