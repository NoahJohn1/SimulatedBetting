import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedEvents } from '@/db/schema';
import { emitFeedEvent } from '@/server/feed/emit';
import { resetDb } from '@/test/db';
import { makeMembership } from '@/test/factories';

describe('emitFeedEvent', () => {
  beforeEach(resetDb);

  it('writes an event and reports that it applied', async () => {
    const membership = await makeMembership();
    const occurredAt = new Date('2026-09-06T18:30:00Z');

    const result = await db.transaction((tx) =>
      emitFeedEvent(tx, {
        seasonId: membership.seasonId,
        type: 'MEMBER_JOINED',
        subjectMembershipId: membership.id,
        dedupeKey: `membership:${membership.id}:joined`,
        payload: { startingBankrollCents: '1000000', startingCreditsCents: '100000' },
        occurredAt,
      }),
    );

    expect(result.applied).toBe(true);
    expect(result.eventId).not.toBeNull();

    const [row] = await db.select().from(feedEvents).where(eq(feedEvents.id, result.eventId!));
    expect(row.type).toBe('MEMBER_JOINED');
    expect(row.occurredAt).toEqual(occurredAt);
    expect(row.payload).toEqual({ startingBankrollCents: '1000000', startingCreditsCents: '100000' });
  });

  it('is a no-op on a repeated dedupe key', async () => {
    const membership = await makeMembership();
    const input = {
      seasonId: membership.seasonId,
      type: 'MEMBER_JOINED' as const,
      subjectMembershipId: membership.id,
      dedupeKey: `membership:${membership.id}:joined`,
      payload: { startingBankrollCents: '1000000', startingCreditsCents: '100000' },
      occurredAt: new Date(),
    };

    const first = await db.transaction((tx) => emitFeedEvent(tx, input));
    const second = await db.transaction((tx) => emitFeedEvent(tx, input));

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(second.eventId).toBeNull();

    const rows = await db.select().from(feedEvents);
    expect(rows).toHaveLength(1);
  });

  it('defaults occurredAt to now when the caller has no business time', async () => {
    const membership = await makeMembership();
    const before = Date.now();

    const result = await db.transaction((tx) =>
      emitFeedEvent(tx, {
        seasonId: membership.seasonId,
        type: 'ALLOWANCE_PAID',
        dedupeKey: 'allowance:x:2026-W36',
        payload: {
          weekKey: '2026-W36',
          memberCount: 1,
          amountCents: '50000',
          creditAmountCents: '10000',
        },
      }),
    );

    const [row] = await db.select().from(feedEvents).where(eq(feedEvents.id, result.eventId!));
    expect(row.occurredAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });
});
