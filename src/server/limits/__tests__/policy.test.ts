import { describe, expect, it } from 'vitest';
import { BUCKETS, decide, windowStartFor } from '@/server/limits/policy';
import { isRateLimited } from '@/server/limits/types';

const at = (iso: string) => new Date(iso);

describe('windowStartFor', () => {
  it('floors to the start of the containing minute', () => {
    expect(windowStartFor('COMMENT', at('2026-09-03T12:34:56.789Z')).toISOString()).toBe(
      '2026-09-03T12:34:00.000Z',
    );
  });

  it('returns the instant itself when it is already a window boundary', () => {
    expect(windowStartFor('COMMENT', at('2026-09-03T12:34:00.000Z')).toISOString()).toBe(
      '2026-09-03T12:34:00.000Z',
    );
  });
});

describe('decide', () => {
  const now = at('2026-09-03T12:34:00.000Z');

  it('allows the first request in a window', () => {
    expect(decide('COMMENT', 1, now)).toBeNull();
  });

  it('allows the request that exactly reaches the limit', () => {
    expect(decide('COMMENT', BUCKETS.COMMENT.limit, now)).toBeNull();
  });

  it('refuses the request after the limit', () => {
    const refused = decide('COMMENT', BUCKETS.COMMENT.limit + 1, now);
    expect(refused).toEqual({ code: 'RATE_LIMITED', retryAfterSeconds: 60 });
  });

  it('counts the retry from the end of the current window, not from now', () => {
    const refused = decide('COMMENT', 99, at('2026-09-03T12:34:45.000Z'));
    expect(refused?.retryAfterSeconds).toBe(15);
  });

  it('never advises a wait of zero seconds', () => {
    // 999ms into the final millisecond of the window: ceil() would give 1, floor() would
    // give 0, and a countdown that says "try again in 0 seconds" is a bug in the copy.
    const refused = decide('COMMENT', 99, at('2026-09-03T12:34:59.999Z'));
    expect(refused?.retryAfterSeconds).toBe(1);
  });

  it('applies each bucket its own limit', () => {
    expect(decide('REACTION', 30, now)).toBeNull();
    expect(decide('BET_PLACE', 30, now)).not.toBeNull();
  });
});

describe('isRateLimited', () => {
  it('recognises the shape and rejects other error shapes', () => {
    expect(isRateLimited({ code: 'RATE_LIMITED', retryAfterSeconds: 5 })).toBe(true);
    expect(isRateLimited({ code: 'INSUFFICIENT_FUNDS' })).toBe(false);
    expect(isRateLimited(null)).toBe(false);
  });
});
