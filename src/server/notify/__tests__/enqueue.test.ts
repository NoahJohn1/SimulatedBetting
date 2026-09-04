import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { notifications, users } from '@/db/schema';
import { enqueueNotification } from '@/server/notify/enqueue';
import { resetDb } from '@/test/db';

async function aUser(email = 'a@example.com') {
  const [row] = await db
    .insert(users)
    .values({ provider: 'GOOGLE', providerAccountId: email, email, displayName: 'A' })
    .returning({ id: users.id });
  return row.id;
}

beforeEach(resetDb);

describe('enqueueNotification', () => {
  it('writes one row, and takes the channel from the type rather than the caller', async () => {
    const userId = await aUser();

    const result = await db.transaction((tx) =>
      enqueueNotification(tx, {
        userId,
        type: 'ACCOUNT_APPROVED',
        dedupeKey: `user:${userId}:approved`,
        payload: {},
      }),
    );

    expect(result.applied).toBe(true);
    const rows = await db.select().from(notifications).where(eq(notifications.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0].channel).toBe('IMMEDIATE');
  });

  it('is a no-op on a repeat, which is what makes a settle re-run safe', async () => {
    const userId = await aUser();
    const input = {
      userId,
      type: 'BETS_SETTLED' as const,
      dedupeKey: `bet:abc:settled:1:${userId}`,
      payload: { outcome: 'WON' },
    };

    const first = await db.transaction((tx) => enqueueNotification(tx, input));
    const second = await db.transaction((tx) => enqueueNotification(tx, input));

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(await db.select().from(notifications)).toHaveLength(1);
  });

  it('treats a different attempt as a different fact, so a correction re-notifies', async () => {
    const userId = await aUser();
    const base = { userId, type: 'BETS_SETTLED' as const, payload: {} };

    await db.transaction((tx) =>
      enqueueNotification(tx, { ...base, dedupeKey: `bet:abc:settled:1:${userId}` }),
    );
    await db.transaction((tx) =>
      enqueueNotification(tx, { ...base, dedupeKey: `bet:abc:settled:2:${userId}` }),
    );

    expect(await db.select().from(notifications)).toHaveLength(2);
  });

  it('gives two recipients of the same fact a row each', async () => {
    const a = await aUser('a@example.com');
    const b = await aUser('b@example.com');

    for (const userId of [a, b]) {
      await db.transaction((tx) =>
        enqueueNotification(tx, {
          userId,
          type: 'ALLOWANCE_PAID',
          dedupeKey: `allowance:s1:2026-W36:${userId}`,
          payload: { amountCents: '50000' },
        }),
      );
    }

    const rows = await db.select().from(notifications);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.channel === 'DIGEST')).toBe(true);
  });

  it('rolls back with its transaction — a queued email never outlives a failed settle', async () => {
    const userId = await aUser();

    await expect(
      db.transaction(async (tx) => {
        await enqueueNotification(tx, {
          userId,
          type: 'ACCOUNT_APPROVED',
          dedupeKey: `user:${userId}:approved`,
          payload: {},
        });
        throw new Error('the settlement failed after the enqueue');
      }),
    ).rejects.toThrow('the settlement failed');

    expect(await db.select().from(notifications)).toHaveLength(0);
  });
});
