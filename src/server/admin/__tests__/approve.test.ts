import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { notifications, users } from '@/db/schema';
import { resetDb } from '@/test/db';

vi.mock('@/server/notify/deliver', () => ({ flushSoon: vi.fn() }));

import { setUserStatus } from '@/server/admin/approve';

async function aPendingUser(email = 'p@example.com') {
  const [row] = await db
    .insert(users)
    .values({ provider: 'GOOGLE', providerAccountId: email, email, displayName: 'P' })
    .returning({ id: users.id });
  return row.id;
}

beforeEach(resetDb);

describe('setUserStatus', () => {
  it('approves a pending user and queues exactly one notification', async () => {
    const userId = await aPendingUser();

    const result = await setUserStatus(userId, 'APPROVED');

    expect(result.changed).toBe(true);
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user.status).toBe('APPROVED');

    const rows = await db.select().from(notifications);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('ACCOUNT_APPROVED');
    expect(rows[0].dedupeKey).toBe(`user:${userId}:approved`);
  });

  it('is idempotent on a double-click', async () => {
    const userId = await aPendingUser();

    await setUserStatus(userId, 'APPROVED');
    const second = await setUserStatus(userId, 'APPROVED');

    expect(second.changed).toBe(false);
    expect(await db.select().from(notifications)).toHaveLength(1);
  });

  it('does not re-notify after a disable and re-approve — it is not news twice', async () => {
    const userId = await aPendingUser();

    await setUserStatus(userId, 'APPROVED');
    await setUserStatus(userId, 'DISABLED');
    await setUserStatus(userId, 'APPROVED');

    expect(await db.select().from(notifications)).toHaveLength(1);
  });

  it('queues nothing when denying', async () => {
    const userId = await aPendingUser();

    await setUserStatus(userId, 'DISABLED');

    expect(await db.select().from(notifications)).toHaveLength(0);
  });

  it('reports no change for a user id that does not exist', async () => {
    const result = await setUserStatus('11111111-1111-1111-1111-111111111111', 'APPROVED');
    expect(result.changed).toBe(false);
  });
});
