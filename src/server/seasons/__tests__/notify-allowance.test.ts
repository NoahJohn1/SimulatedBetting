import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { notifications, seasonMemberships } from '@/db/schema';
import { payWeeklyAllowance } from '@/server/seasons/allowance';
import { makeSeason, makeUser } from '@/test/factories';
import { resetDb } from '@/test/db';

async function seedSeasonWith(members: number) {
  const season = await makeSeason({ status: 'ACTIVE', weeklyAllowanceCents: 50_000n });
  const userIds: string[] = [];
  for (let i = 0; i < members; i++) {
    const user = await makeUser({ providerAccountId: `m${i}`, email: `m${i}@example.com` });
    await db
      .insert(seasonMemberships)
      .values({ userId: user.id, seasonId: season.id, balanceCents: 0n });
    userIds.push(user.id);
  }
  return { seasonId: season.id, userIds };
}

beforeEach(resetDb);

describe('ALLOWANCE_PAID', () => {
  it('fans one season-wide card out to a row per member', async () => {
    const { seasonId, userIds } = await seedSeasonWith(3);

    await payWeeklyAllowance(new Date('2026-09-03T12:00:00Z'));

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.type, 'ALLOWANCE_PAID'));

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.userId).sort()).toEqual([...userIds].sort());
    expect(rows.every((r) => r.channel === 'DIGEST')).toBe(true);
    expect(rows[0].dedupeKey).toContain(`allowance:${seasonId}:`);
  });

  it('queues nothing extra on a second run in the same week', async () => {
    await seedSeasonWith(3);
    const now = new Date('2026-09-03T12:00:00Z');

    await payWeeklyAllowance(now);
    await payWeeklyAllowance(now);

    expect(await db.select().from(notifications)).toHaveLength(3);
  });

  it('queues a fresh set the following week', async () => {
    await seedSeasonWith(2);

    await payWeeklyAllowance(new Date('2026-09-03T12:00:00Z'));
    await payWeeklyAllowance(new Date('2026-09-10T12:00:00Z'));

    expect(await db.select().from(notifications)).toHaveLength(4);
  });
});
