import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { seasonMemberships } from '@/db/schema';
import { postEntry } from '@/server/money/ledger';
import { reconcileBalances } from '@/server/money/reconcile';
import { resetDb } from '@/test/db';
import { makeMembership } from '@/test/factories';

describe('reconcileBalances per currency', () => {
  beforeEach(resetDb);

  it('reports nothing when both currencies agree with the ledger', async () => {
    const membership = await makeMembership(0n);

    await db.transaction(async (tx) => {
      await postEntry(tx, {
        membershipId: membership.id,
        amountCents: 1000n,
        type: 'SEASON_STARTING_GRANT',
        idempotencyKey: 'c1',
      });
      await postEntry(tx, {
        membershipId: membership.id,
        amountCents: 250n,
        type: 'SEASON_STARTING_GRANT',
        currency: 'CREDITS',
        idempotencyKey: 'c2',
      });
    });

    expect(await reconcileBalances()).toEqual([]);
  });

  it('reports a credits drift while cash reads clean', async () => {
    const membership = await makeMembership(0n);

    await db.transaction(async (tx) => {
      await postEntry(tx, {
        membershipId: membership.id,
        amountCents: 1000n,
        type: 'SEASON_STARTING_GRANT',
        idempotencyKey: 'c3',
      });
      await postEntry(tx, {
        membershipId: membership.id,
        amountCents: 250n,
        type: 'SEASON_STARTING_GRANT',
        currency: 'CREDITS',
        idempotencyKey: 'c4',
      });
    });

    // Corrupt only the credits cache.
    await db
      .update(seasonMemberships)
      .set({ creditsBalanceCents: 999n })
      .where(eq(seasonMemberships.id, membership.id));

    const drift = await reconcileBalances();

    expect(drift).toEqual([
      {
        membershipId: membership.id,
        currency: 'CREDITS',
        cachedCents: 999n,
        ledgerCents: 250n,
      },
    ]);
  });

  it('reports a membership with no credit entries but a non-zero credits cache', async () => {
    const membership = await makeMembership(0n);

    await db
      .update(seasonMemberships)
      .set({ creditsBalanceCents: 5n })
      .where(eq(seasonMemberships.id, membership.id));

    const drift = await reconcileBalances();

    expect(drift).toEqual([
      { membershipId: membership.id, currency: 'CREDITS', cachedCents: 5n, ledgerCents: 0n },
    ]);
  });
});
