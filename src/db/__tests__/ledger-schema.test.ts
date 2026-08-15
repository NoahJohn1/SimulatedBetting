import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { ledgerEntries } from '@/db/schema';
import { resetDb } from '@/test/db';
import { makeMembership } from '@/test/factories';

describe('ledger schema', () => {
  beforeEach(resetDb);

  it('rejects a duplicate idempotency key', async () => {
    const membership = await makeMembership();

    const entry = {
      membershipId: membership.id,
      amountCents: 1_000_000n,
      type: 'SEASON_STARTING_GRANT' as const,
      balanceAfterCents: 1_000_000n,
      idempotencyKey: `grant:${membership.id}`,
    };

    await db.insert(ledgerEntries).values(entry);
    await expect(db.insert(ledgerEntries).values(entry)).rejects.toThrow();
  });

  it('stores amounts as bigint cents', async () => {
    const membership = await makeMembership();

    const [row] = await db
      .insert(ledgerEntries)
      .values({
        membershipId: membership.id,
        amountCents: -12_345n,
        type: 'BET_PLACED',
        balanceAfterCents: 987_655n,
        idempotencyKey: `bet:${membership.id}:placed`,
      })
      .returning();

    expect(row.amountCents).toBe(-12_345n);
    expect(typeof row.amountCents).toBe('bigint');
  });
});
