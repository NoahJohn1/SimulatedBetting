import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { seasonMemberships } from '@/db/schema';
import { reconcileBalances } from '@/server/money/reconcile';
import { createSeason, joinSeason } from '@/server/seasons/service';
import { resetDb } from '@/test/db';
import { makeUser } from '@/test/factories';

async function memberWithGrant() {
  const user = await makeUser();
  const season = await createSeason({
    name: '2026 Football',
    startsAt: new Date('2026-09-01T00:00:00Z'),
    endsAt: new Date('2027-01-31T00:00:00Z'),
  });
  return joinSeason(user.id, season.id);
}

describe('reconcileBalances', () => {
  beforeEach(resetDb);

  it('reports nothing when balances match the ledger', async () => {
    await memberWithGrant();
    expect(await reconcileBalances()).toEqual([]);
  });

  it('reports a membership whose cached balance drifted', async () => {
    const membership = await memberWithGrant();

    await db
      .update(seasonMemberships)
      .set({ balanceCents: 999n })
      .where(eq(seasonMemberships.id, membership.membershipId));

    const discrepancies = await reconcileBalances();

    expect(discrepancies).toHaveLength(1);
    expect(discrepancies[0]).toMatchObject({
      membershipId: membership.membershipId,
      cachedCents: 999n,
      ledgerCents: 1_000_000n,
    });
  });

  it('treats a membership with no entries as zero', async () => {
    const membership = await memberWithGrant();

    await db
      .update(seasonMemberships)
      .set({ balanceCents: 0n })
      .where(eq(seasonMemberships.id, membership.membershipId));

    const discrepancies = await reconcileBalances();
    expect(discrepancies[0].ledgerCents).toBe(1_000_000n);
  });
});
