import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { ledgerEntries } from '@/db/schema';
import { adjustBalance } from '@/server/admin/adjust';
import { resetDb } from '@/test/db';
import { makeMembership, makeUser } from '@/test/factories';

describe('adjustBalance', () => {
  beforeEach(resetDb);

  it('credits with an ADMIN_CREDIT entry carrying the note and actor', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const membership = await makeMembership(1_000_000n);

    const result = await adjustBalance({
      membershipId: membership.id,
      amountCents: 25_000n,
      note: 'tournament buy-in',
      actorUserId: admin.id,
      idempotencyKey: 'admin:test:1',
    });

    expect(result.balanceCents).toBe(1_025_000n);

    const [entry] = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.membershipId, membership.id));

    expect(entry.type).toBe('ADMIN_CREDIT');
    expect(entry.note).toBe('tournament buy-in');
    expect(entry.actorUserId).toBe(admin.id);
  });

  it('debits with an ADMIN_DEBIT entry', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const membership = await makeMembership(1_000_000n);

    await adjustBalance({
      membershipId: membership.id,
      amountCents: -40_000n,
      note: 'correcting a mistake',
      actorUserId: admin.id,
      idempotencyKey: 'admin:test:2',
    });

    const [entry] = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.membershipId, membership.id));

    expect(entry.type).toBe('ADMIN_DEBIT');
    expect(entry.amountCents).toBe(-40_000n);
  });

  it('rejects a blank note', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const membership = await makeMembership();

    await expect(
      adjustBalance({
        membershipId: membership.id,
        amountCents: 1_000n,
        note: '   ',
        actorUserId: admin.id,
        idempotencyKey: 'admin:test:3',
      }),
    ).rejects.toMatchObject({ code: 'NOTE_REQUIRED' });
  });

  it('rejects a zero adjustment', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const membership = await makeMembership();

    await expect(
      adjustBalance({
        membershipId: membership.id,
        amountCents: 0n,
        note: 'nothing',
        actorUserId: admin.id,
        idempotencyKey: 'admin:test:4',
      }),
    ).rejects.toThrow();
  });
});
