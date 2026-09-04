import type { RateLimited } from './types';

/**
 * What each mutation bucket allows, and over what window (D69).
 *
 * One window per bucket, minute-scale, and no hourly tier. What this guards against is a
 * runaway render loop or an impatient double-tap, not an adversary — a member spamming
 * steadily for an hour in a private group of four is a social problem with a social fix, and
 * an hourly tier would double the query count on every mutation to address it.
 *
 * Deliberately a module with no imports but its own types. It is the piece of this subsystem
 * most likely to be wrong, and nothing in its import graph should need a database.
 */
export const BUCKETS = {
  BET_PLACE: { limit: 10, windowMs: 60_000 },
  P2P_OFFER: { limit: 10, windowMs: 60_000 },
  P2P_RESPOND: { limit: 20, windowMs: 60_000 },
  EVENT_WRITE: { limit: 10, windowMs: 60_000 },
  COMMENT: { limit: 10, windowMs: 60_000 },
  REACTION: { limit: 30, windowMs: 60_000 },
  ADMIN_ACTION: { limit: 30, windowMs: 60_000 },
  DEFAULT: { limit: 30, windowMs: 60_000 },
} as const;

export type Bucket = keyof typeof BUCKETS;

/**
 * The start of the fixed window `now` falls in. Computed here rather than in SQL so the
 * arithmetic is testable without a database.
 */
export function windowStartFor(bucket: Bucket, now: Date): Date {
  const { windowMs } = BUCKETS[bucket];
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

/**
 * `count` is the value the counter holds *after* this request was counted, so the request that
 * brings it exactly to the limit is the last allowed one.
 */
export function decide(bucket: Bucket, count: number, now: Date): RateLimited | null {
  const { limit, windowMs } = BUCKETS[bucket];
  if (count <= limit) return null;

  const windowEndMs = windowStartFor(bucket, now).getTime() + windowMs;
  return {
    code: 'RATE_LIMITED',
    // Never zero: a countdown that reads "try again in 0 seconds" is a bug in the copy.
    retryAfterSeconds: Math.max(1, Math.ceil((windowEndMs - now.getTime()) / 1_000)),
  };
}
