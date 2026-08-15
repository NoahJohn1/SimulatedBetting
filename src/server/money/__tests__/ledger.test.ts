import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { ledgerEntries, seasonMemberships } from '@/db/schema';
import { MoneyError } from '@/server/money/errors';
import { postEntry } from '@/server/money/ledger';
import { resetDb } from '@/test/db';
import { makeMembership } from '@/test/factories';

async function balanceOf(membershipId: string): Promise<bigint> {
  const [row] = await db
    .select({ balanceCents: seasonMemberships.balanceCents })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, membershipId));
  return row.balanceCents;
}

describe('postEntry', () => {
  beforeEach(resetDb);

  it('credits a balance and records the entry', async () => {
    const membership = await makeMembership(1_000_000n);

    const result = await db.transaction((tx) =>
      postEntry(tx, {
        membershipId: membership.id,
        amountCents: 50_000n,
        type: 'WEEKLY_ALLOWANCE',
        idempotencyKey: `allowance:${membership.id}:2026-W36`,
      }),
    );

    expect(result.applied).toBe(true);
    expect(result.balanceCents).toBe(1_050_000n);
    expect(await balanceOf(membership.id)).toBe(1_050_000n);

    const entries = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.membershipId, membership.id));
    expect(entries).toHaveLength(1);
    expect(entries[0].balanceAfterCents).toBe(1_050_000n);
  });

  it('is a no-op when the idempotency key was already used', async () => {
    const membership = await makeMembership(1_000_000n);
    const input = {
      membershipId: membership.id,
      amountCents: 50_000n,
      type: 'WEEKLY_ALLOWANCE' as const,
      idempotencyKey: `allowance:${membership.id}:2026-W36`,
    };

    await db.transaction((tx) => postEntry(tx, input));
    const second = await db.transaction((tx) => postEntry(tx, input));

    expect(second.applied).toBe(false);
    expect(await balanceOf(membership.id)).toBe(1_050_000n);
    expect(
      await db.select().from(ledgerEntries).where(eq(ledgerEntries.membershipId, membership.id)),
    ).toHaveLength(1);
  });

  it('refuses to overdraw a balance', async () => {
    const membership = await makeMembership(10_000n);

    await expect(
      db.transaction((tx) =>
        postEntry(tx, {
          membershipId: membership.id,
          amountCents: -10_001n,
          type: 'BET_PLACED',
          idempotencyKey: 'bet:x:placed',
        }),
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });

    expect(await balanceOf(membership.id)).toBe(10_000n);
  });

  it('requires a note on admin entries', async () => {
    const membership = await makeMembership();

    await expect(
      db.transaction((tx) =>
        postEntry(tx, {
          membershipId: membership.id,
          amountCents: 25_000n,
          type: 'ADMIN_CREDIT',
          idempotencyKey: 'admin:1',
        }),
      ),
    ).rejects.toBeInstanceOf(MoneyError);
  });

  it('serialises concurrent writes against the same membership', async () => {
    const membership = await makeMembership(10_000n);

    const attempt = (key: string) =>
      db
        .transaction((tx) =>
          postEntry(tx, {
            membershipId: membership.id,
            amountCents: -8_000n,
            type: 'BET_PLACED',
            idempotencyKey: key,
          }),
        )
        .then(() => 'ok' as const)
        .catch(() => 'rejected' as const);

    const results = await Promise.all([attempt('bet:a:placed'), attempt('bet:b:placed')]);

    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(await balanceOf(membership.id)).toBe(2_000n);
  });
});
