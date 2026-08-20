import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { p2pWagers } from '@/db/schema';
import { resetDb } from '@/test/db';
import { makeCreditedMembership } from '@/test/factories';

describe('p2p_wagers schema', () => {
  beforeEach(resetDb);

  it('stores a freeform offer with both stakes and no acceptor', async () => {
    const offerer = await makeCreditedMembership(100_000n);

    const [row] = await db
      .insert(p2pWagers)
      .values({
        seasonId: offerer.seasonId,
        kind: 'FREEFORM',
        offererMembershipId: offerer.membership.id,
        offererStakeCents: 50_000n,
        acceptorStakeCents: 20_000n,
        description: 'Jake cannot name ten starting quarterbacks',
        expiresAt: new Date('2026-09-01T00:00:00Z'),
        resolvesBy: new Date('2026-09-08T00:00:00Z'),
      })
      .returning();

    expect(row.status).toBe('OFFERED');
    expect(row.kind).toBe('FREEFORM');
    expect(row.acceptorMembershipId).toBeNull();
    expect(row.opponentMembershipId).toBeNull();
    expect(row.verdict).toBeNull();
    expect(row.offererClaim).toBeNull();
    expect(row.acceptorClaim).toBeNull();
    expect(row.offererCancelProposed).toBe(false);
    expect(row.acceptorCancelProposed).toBe(false);
    expect(row.settlementAttempts).toBe(0);
    expect(row.offererStakeCents).toBe(50_000n);
    expect(row.acceptorStakeCents).toBe(20_000n);
  });

  it('rejects a FREEFORM wager that carries a selection', async () => {
    const offerer = await makeCreditedMembership(100_000n);

    await expect(
      db.insert(p2pWagers).values({
        seasonId: offerer.seasonId,
        kind: 'FREEFORM',
        offererMembershipId: offerer.membership.id,
        offererStakeCents: 1_000n,
        acceptorStakeCents: 1_000n,
        description: 'something',
        // A selection id that does not exist is fine — the CHECK fires before the FK.
        selectionId: '00000000-0000-4000-8000-000000000000',
        expiresAt: new Date('2026-09-01T00:00:00Z'),
        resolvesBy: new Date('2026-09-08T00:00:00Z'),
      }),
    ).rejects.toMatchObject({ cause: { message: /p2p_wagers_kind_shape/ } });
  });

  it('rejects a MARKET wager with no selection', async () => {
    const offerer = await makeCreditedMembership(100_000n);

    await expect(
      db.insert(p2pWagers).values({
        seasonId: offerer.seasonId,
        kind: 'MARKET',
        offererMembershipId: offerer.membership.id,
        offererStakeCents: 1_000n,
        acceptorStakeCents: 1_000n,
        expiresAt: new Date('2026-09-01T00:00:00Z'),
        resolvesBy: new Date('2026-09-08T00:00:00Z'),
      }),
    ).rejects.toMatchObject({ cause: { message: /p2p_wagers_kind_shape/ } });
  });

  it('rejects a non-positive stake', async () => {
    const offerer = await makeCreditedMembership(100_000n);

    await expect(
      db.insert(p2pWagers).values({
        seasonId: offerer.seasonId,
        kind: 'FREEFORM',
        offererMembershipId: offerer.membership.id,
        offererStakeCents: 0n,
        acceptorStakeCents: 1_000n,
        description: 'something',
        expiresAt: new Date('2026-09-01T00:00:00Z'),
        resolvesBy: new Date('2026-09-08T00:00:00Z'),
      }),
    ).rejects.toMatchObject({ cause: { message: /p2p_wagers_positive_stakes/ } });
  });

  it('round-trips a settled wager with a verdict', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const acceptor = await makeCreditedMembership(100_000n, offerer.seasonId);

    const [row] = await db
      .insert(p2pWagers)
      .values({
        seasonId: offerer.seasonId,
        kind: 'FREEFORM',
        status: 'SETTLED',
        offererMembershipId: offerer.membership.id,
        acceptorMembershipId: acceptor.membership.id,
        offererStakeCents: 50_000n,
        acceptorStakeCents: 20_000n,
        description: 'a settled bet',
        expiresAt: new Date('2026-09-01T00:00:00Z'),
        resolvesBy: new Date('2026-09-08T00:00:00Z'),
        offererClaim: 'OFFERER',
        acceptorClaim: 'OFFERER',
        verdict: 'OFFERER',
        settlementAttempts: 1,
      })
      .returning();

    const [read] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, row.id));
    expect(read.verdict).toBe('OFFERER');
    expect(read.acceptorMembershipId).toBe(acceptor.membership.id);
    expect(read.settlementAttempts).toBe(1);
  });
});
