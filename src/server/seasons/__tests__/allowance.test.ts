import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { ledgerEntries, seasons } from '@/db/schema';
import { isoWeekKey, payWeeklyAllowance } from '@/server/seasons/allowance';
import { createSeason, joinSeason } from '@/server/seasons/service';
import { resetDb } from '@/test/db';
import { makeUser } from '@/test/factories';

async function activeSeasonWithMember() {
  const user = await makeUser();
  const season = await createSeason({
    name: '2026 Football',
    startsAt: new Date('2026-09-01T00:00:00Z'),
    endsAt: new Date('2027-01-31T00:00:00Z'),
  });
  await db.update(seasons).set({ status: 'ACTIVE' }).where(eq(seasons.id, season.id));
  const membership = await joinSeason(user.id, season.id);
  return membership;
}

describe('weekly allowance', () => {
  beforeEach(resetDb);

  it('derives a stable ISO week key in New York time', () => {
    expect(isoWeekKey(new Date('2026-09-01T12:00:00Z'))).toBe('2026-W36');
    expect(isoWeekKey(new Date('2026-09-06T12:00:00Z'))).toBe('2026-W36');
    expect(isoWeekKey(new Date('2026-09-07T12:00:00Z'))).toBe('2026-W37');
  });

  it('credits every member of the active season once', async () => {
    const membership = await activeSeasonWithMember();
    const now = new Date('2026-09-01T13:00:00Z');

    const first = await payWeeklyAllowance(now);
    const second = await payWeeklyAllowance(now);

    expect(first.credited).toBe(1);
    expect(second.credited).toBe(0);
    expect(second.skipped).toBe(1);

    const entries = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.membershipId, membership.membershipId));

    const allowances = entries.filter((e) => e.type === 'WEEKLY_ALLOWANCE');
    expect(allowances).toHaveLength(1);
    expect(allowances[0].amountCents).toBe(50_000n);
  });

  it('credits again in a later week', async () => {
    const membership = await activeSeasonWithMember();

    await payWeeklyAllowance(new Date('2026-09-01T13:00:00Z'));
    await payWeeklyAllowance(new Date('2026-09-08T13:00:00Z'));

    const entries = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.membershipId, membership.membershipId));

    expect(entries.filter((e) => e.type === 'WEEKLY_ALLOWANCE')).toHaveLength(2);
  });
});
