import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { seasonMemberships } from '@/db/schema';
import { postEntry } from '@/server/money/ledger';
import { MoneyError } from '@/server/money/errors';
import { resetDb } from '@/test/db';
import { makeMembership } from '@/test/factories';

async function balances(membershipId: string) {
  const [row] = await db
    .select({
      cash: seasonMemberships.balanceCents,
      credits: seasonMemberships.creditsBalanceCents,
    })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, membershipId));
  return row;
}

describe('postEntry with a currency', () => {
  beforeEach(resetDb);

  it('defaults to cash and leaves credits alone', async () => {
    const membership = await makeMembership(1000n);

    await db.transaction((tx) =>
      postEntry(tx, {
        membershipId: membership.id,
        amountCents: 500n,
        type: 'WEEKLY_ALLOWANCE',
        idempotencyKey: 'k1',
      }),
    );

    expect(await balances(membership.id)).toEqual({ cash: 1500n, credits: 0n });
  });

  it('credits move the credits balance and leave cash alone', async () => {
    const membership = await makeMembership(1000n);

    const result = await db.transaction((tx) =>
      postEntry(tx, {
        membershipId: membership.id,
        amountCents: 700n,
        type: 'SEASON_STARTING_GRANT',
        currency: 'CREDITS',
        idempotencyKey: 'k2',
      }),
    );

    expect(result.balanceCents).toBe(700n);
    expect(await balances(membership.id)).toEqual({ cash: 1000n, credits: 700n });
  });

  it('rejects a credits debit the credits balance cannot absorb, even when cash is rich', async () => {
    const membership = await makeMembership(1_000_000n);

    await expect(
      db.transaction((tx) =>
        postEntry(tx, {
          membershipId: membership.id,
          amountCents: -1n,
          type: 'BET_PLACED',
          currency: 'CREDITS',
          idempotencyKey: 'k3',
        }),
      ),
    ).rejects.toBeInstanceOf(MoneyError);

    expect(await balances(membership.id)).toEqual({ cash: 1_000_000n, credits: 0n });
  });

  it('is still idempotent per key within a currency', async () => {
    const membership = await makeMembership(0n);

    const first = await db.transaction((tx) =>
      postEntry(tx, {
        membershipId: membership.id,
        amountCents: 100n,
        type: 'SEASON_STARTING_GRANT',
        currency: 'CREDITS',
        idempotencyKey: 'k4',
      }),
    );
    const second = await db.transaction((tx) =>
      postEntry(tx, {
        membershipId: membership.id,
        amountCents: 100n,
        type: 'SEASON_STARTING_GRANT',
        currency: 'CREDITS',
        idempotencyKey: 'k4',
      }),
    );

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(await balances(membership.id)).toEqual({ cash: 0n, credits: 100n });
  });
});
