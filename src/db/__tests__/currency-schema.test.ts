import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { ledgerEntries, seasonMemberships } from '@/db/schema';
import { resetDb } from '@/test/db';
import { makeMembership } from '@/test/factories';

describe('currency schema', () => {
  beforeEach(resetDb);

  it('defaults existing-style entries to CASH', async () => {
    const membership = await makeMembership();

    const [entry] = await db
      .insert(ledgerEntries)
      .values({
        membershipId: membership.id,
        amountCents: 1000n,
        type: 'SEASON_STARTING_GRANT',
        balanceAfterCents: 1000n,
        idempotencyKey: 'test:cash',
      })
      .returning();

    expect(entry.currency).toBe('CASH');
  });

  it('stores a CREDITS entry alongside a CASH one', async () => {
    const membership = await makeMembership();

    await db.insert(ledgerEntries).values([
      {
        membershipId: membership.id,
        amountCents: 1000n,
        type: 'SEASON_STARTING_GRANT',
        balanceAfterCents: 1000n,
        idempotencyKey: 'test:cash-2',
      },
      {
        membershipId: membership.id,
        amountCents: 500n,
        type: 'SEASON_STARTING_GRANT',
        currency: 'CREDITS',
        balanceAfterCents: 500n,
        idempotencyKey: 'test:credits-2',
      },
    ]);

    const rows = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.membershipId, membership.id));

    expect(rows.map((r) => r.currency).sort()).toEqual(['CASH', 'CREDITS']);
  });

  it('gives every membership a zero credits balance by default', async () => {
    const membership = await makeMembership();

    const [row] = await db
      .select()
      .from(seasonMemberships)
      .where(eq(seasonMemberships.id, membership.id));

    expect(row.creditsBalanceCents).toBe(0n);
  });
});
