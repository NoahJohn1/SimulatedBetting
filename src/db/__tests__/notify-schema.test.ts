import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { notifications, notificationPreferences, users } from '@/db/schema';
import { resetDb } from '@/test/db';

async function aUser(email = 'a@example.com') {
  const [row] = await db
    .insert(users)
    .values({ provider: 'GOOGLE', providerAccountId: email, email, displayName: 'A' })
    .returning({ id: users.id });
  return row.id;
}

beforeEach(resetDb);

describe('notifications', () => {
  it('rejects a second row with the same dedupe key', async () => {
    const userId = await aUser();
    const row = {
      userId,
      type: 'BETS_SETTLED' as const,
      channel: 'DIGEST' as const,
      dedupeKey: `bet:abc:settled:1:${userId}`,
      payload: { betId: 'abc' },
    };

    await db.insert(notifications).values(row);
    await db.insert(notifications).values(row).onConflictDoNothing({
      target: notifications.dedupeKey,
    });

    const all = await db.select().from(notifications).where(eq(notifications.userId, userId));
    expect(all).toHaveLength(1);
    expect(all[0].sentAt).toBeNull();
    expect(all[0].attempts).toBe(0);
    expect(all[0].outcome).toBeNull();
  });

  it('defaults a preferences row to everything on', async () => {
    const userId = await aUser('b@example.com');
    await db.insert(notificationPreferences).values({ userId });

    const [row] = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId));

    expect(row.mutedTypes).toEqual([]);
    expect(row.emailsEnabled).toBe(true);
  });
});
