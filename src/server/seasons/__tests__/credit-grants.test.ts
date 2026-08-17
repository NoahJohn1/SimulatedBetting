import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { ledgerEntries, seasonMemberships, seasons } from '@/db/schema';
import { createSeason, joinSeason } from '@/server/seasons/service';
import { payWeeklyAllowance } from '@/server/seasons/allowance';
import { adjustBalance } from '@/server/admin/adjust';
import { resetDb } from '@/test/db';
import { makeUser } from '@/test/factories';

async function activeSeason() {
  const season = await createSeason({
    name: 'Credits season',
    startsAt: new Date('2026-09-01T00:00:00Z'),
    endsAt: new Date('2027-01-31T00:00:00Z'),
    startingBankrollCents: 100_000n,
    weeklyAllowanceCents: 5_000n,
    startingCreditsCents: 20_000n,
    weeklyCreditAllowanceCents: 1_000n,
  });
  await db.update(seasons).set({ status: 'ACTIVE' }).where(eq(seasons.id, season.id));
  return season;
}

describe('credit grants', () => {
  beforeEach(resetDb);

  it('grants both currencies on join, with distinct keys', async () => {
    const season = await activeSeason();
    const user = await makeUser();

    const result = await joinSeason(user.id, season.id);

    expect(result.balanceCents).toBe(100_000n);
    expect(result.creditsBalanceCents).toBe(20_000n);

    const keys = (
      await db
        .select({ key: ledgerEntries.idempotencyKey, currency: ledgerEntries.currency })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.membershipId, result.membershipId))
    ).sort((a, b) => a.key.localeCompare(b.key));

    expect(keys).toEqual([
      { key: `grant:${result.membershipId}`, currency: 'CASH' },
      { key: `grant:${result.membershipId}:credits`, currency: 'CREDITS' },
    ]);
  });

  it('joining twice grants nothing extra', async () => {
    const season = await activeSeason();
    const user = await makeUser();

    await joinSeason(user.id, season.id);
    const second = await joinSeason(user.id, season.id);

    expect(second.balanceCents).toBe(100_000n);
    expect(second.creditsBalanceCents).toBe(20_000n);
  });

  it('pays both allowances in one weekly run and is idempotent', async () => {
    const season = await activeSeason();
    const user = await makeUser();
    const { membershipId } = await joinSeason(user.id, season.id);

    const now = new Date('2026-09-08T12:00:00Z');
    await payWeeklyAllowance(now);
    await payWeeklyAllowance(now);

    const [row] = await db
      .select({
        cash: seasonMemberships.balanceCents,
        credits: seasonMemberships.creditsBalanceCents,
      })
      .from(seasonMemberships)
      .where(eq(seasonMemberships.id, membershipId));

    expect(row).toEqual({ cash: 105_000n, credits: 21_000n });
  });

  it('an admin can adjust credits without touching cash', async () => {
    const season = await activeSeason();
    const user = await makeUser();
    const admin = await makeUser({ role: 'ADMIN' });
    const { membershipId } = await joinSeason(user.id, season.id);

    await adjustBalance({
      membershipId,
      amountCents: -5_000n,
      currency: 'CREDITS',
      note: 'refunding a broken market by hand',
      actorUserId: admin.id,
      idempotencyKey: 'adj:1:credits',
    });

    const [row] = await db
      .select({
        cash: seasonMemberships.balanceCents,
        credits: seasonMemberships.creditsBalanceCents,
      })
      .from(seasonMemberships)
      .where(eq(seasonMemberships.id, membershipId));

    expect(row).toEqual({ cash: 100_000n, credits: 15_000n });

    const [entry] = await db
      .select()
      .from(ledgerEntries)
      .where(
        and(eq(ledgerEntries.membershipId, membershipId), eq(ledgerEntries.type, 'ADMIN_DEBIT')),
      );
    expect(entry.currency).toBe('CREDITS');
  });
});
