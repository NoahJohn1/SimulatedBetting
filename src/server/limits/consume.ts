import { lt, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { rateLimits } from '@/db/schema';
import { decide, windowStartFor, type Bucket } from './policy';
import type { RateLimited } from './types';

/**
 * Count one attempt against a bucket. Returns `null` when the request may proceed, and a
 * `RateLimited` when it may not (D69).
 *
 * **Never pass this a transaction handle, and never call it inside `db.transaction`.** It runs
 * in its own transaction, before the caller's, so that a counter conflict can never abort a
 * money write that had already been decided, and a money rollback can never silently refund a
 * token (money invariant 3).
 *
 * The counter increments on the attempt and is never refunded when the service rejects the
 * request (D70). Refunding reads fairer and hands anyone with a rejected-request loop an
 * unlimited retry budget, which is the case the limit exists for.
 *
 * One statement, not a read followed by a write, so two instances racing on the same subject
 * cannot both read the same count.
 */
export async function consume(
  subjectId: string,
  bucket: Bucket,
  now: Date = new Date(),
): Promise<RateLimited | null> {
  try {
    const [row] = await db
      .insert(rateLimits)
      .values({ subjectId, bucket, windowStart: windowStartFor(bucket, now), count: 1 })
      .onConflictDoUpdate({
        target: [rateLimits.subjectId, rateLimits.bucket, rateLimits.windowStart],
        set: { count: sql`${rateLimits.count} + 1` },
      })
      .returning({ count: rateLimits.count });

    return decide(bucket, row.count, now);
  } catch (err) {
    // Fails open (D70). This sits in the request path of every mutation a member makes; a
    // guard against a nuisance must not be able to become the outage. Sentry picks this up
    // through the server-action instrumentation wired in phase 6.
    console.error('[limits] rate-limit counter unavailable, allowing the request', err);
    return null;
  }
}

/**
 * Drop counters for windows that have closed. Called from the daily `reconcile` job beside
 * `pruneJobRuns` — housekeeping, not a requirement: the ceiling is members × buckets × windows
 * per day, which for this group is small enough to ignore if a prune is ever missed.
 */
export async function pruneRateLimits(olderThanMs = 60 * 60 * 1_000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const deleted = await db
    .delete(rateLimits)
    .where(lt(rateLimits.windowStart, cutoff))
    .returning({ bucket: rateLimits.bucket });
  return deleted.length;
}
