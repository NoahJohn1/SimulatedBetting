import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/client';
import { rateLimits } from '@/db/schema';
import { BUCKETS } from '@/server/limits/policy';
import { consume, pruneRateLimits } from '@/server/limits/consume';
import { resetDb } from '@/test/db';

const SUBJECT = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const at = (iso: string) => new Date(iso);

beforeEach(async () => {
  await resetDb();
});

afterEach(() => vi.restoreAllMocks());

describe('consume', () => {
  it('allows every request up to the limit and refuses the next', async () => {
    const now = at('2026-09-03T12:34:00.000Z');

    for (let i = 0; i < BUCKETS.COMMENT.limit; i++) {
      expect(await consume(SUBJECT, 'COMMENT', now)).toBeNull();
    }

    const refused = await consume(SUBJECT, 'COMMENT', now);
    expect(refused).toEqual({ code: 'RATE_LIMITED', retryAfterSeconds: 60 });
  });

  it('starts a fresh count in the next window', async () => {
    const first = at('2026-09-03T12:34:00.000Z');
    for (let i = 0; i <= BUCKETS.COMMENT.limit; i++) await consume(SUBJECT, 'COMMENT', first);

    expect(await consume(SUBJECT, 'COMMENT', at('2026-09-03T12:35:00.000Z'))).toBeNull();
  });

  it('keeps buckets independent', async () => {
    const now = at('2026-09-03T12:34:00.000Z');
    for (let i = 0; i <= BUCKETS.COMMENT.limit; i++) await consume(SUBJECT, 'COMMENT', now);

    expect(await consume(SUBJECT, 'REACTION', now)).toBeNull();
  });

  it('keeps subjects independent', async () => {
    const now = at('2026-09-03T12:34:00.000Z');
    for (let i = 0; i <= BUCKETS.COMMENT.limit; i++) await consume(SUBJECT, 'COMMENT', now);

    expect(await consume(OTHER, 'COMMENT', now)).toBeNull();
  });

  it('counts the attempt exactly once per call', async () => {
    const now = at('2026-09-03T12:34:00.000Z');
    await consume(SUBJECT, 'BET_PLACE', now);
    await consume(SUBJECT, 'BET_PLACE', now);

    const rows = await db.select().from(rateLimits);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(2);
  });

  it('fails open when the counter query throws', async () => {
    const boom = new Error('connection terminated');
    vi.spyOn(db, 'insert').mockImplementation(() => {
      throw boom;
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await consume(SUBJECT, 'BET_PLACE')).toBeNull();
    expect(logged).toHaveBeenCalled();
  });
});

describe('pruneRateLimits', () => {
  it('deletes closed windows and leaves the current one alone', async () => {
    const old = new Date(Date.now() - 3 * 60 * 60 * 1_000);
    await db
      .insert(rateLimits)
      .values({ subjectId: SUBJECT, bucket: 'COMMENT', windowStart: old, count: 4 });
    await consume(SUBJECT, 'COMMENT');

    expect(await pruneRateLimits()).toBe(1);

    const remaining = await db.select().from(rateLimits);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].windowStart.getTime()).toBeGreaterThan(old.getTime());
  });
});
