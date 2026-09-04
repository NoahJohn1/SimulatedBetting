import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { notifications } from '@/db/schema';
import { makeCreditedMembership, makeUser } from '@/test/factories';
import { resetDb } from '@/test/db';
import { acceptWager } from '@/server/p2p/accept';
import { claimWinner } from '@/server/p2p/claim';
import { offerWager } from '@/server/p2p/offer';

vi.mock('@/server/notify/deliver', () => ({ flushSoon: vi.fn() }));

beforeEach(resetDb);

/**
 * Drives the real services, exactly as claim.test.ts's `accepted()` does, then has both
 * sides claim opposite verdicts so the wager lands in DISPUTED.
 */
async function offerAcceptAndDisagree(
  offerer: Awaited<ReturnType<typeof makeCreditedMembership>>,
  opponent: Awaited<ReturnType<typeof makeCreditedMembership>>,
): Promise<string> {
  const offered = await offerWager({
    actorUserId: offerer.user.id,
    kind: 'FREEFORM',
    description: 'a disputed wager',
    opponentMembershipId: opponent.membership.id,
    offererStakeCents: 10_000n,
    acceptorStakeCents: 10_000n,
    expiresAt: new Date(Date.now() + 86_400_000),
    resolvesBy: new Date(Date.now() + 7 * 86_400_000),
  });
  if (!offered.ok) throw new Error(`offer failed: ${offered.error.code}`);

  const taken = await acceptWager({
    wagerId: offered.wagerId,
    actorUserId: opponent.user.id,
  });
  if (!taken.ok) throw new Error(`accept failed: ${taken.error.code}`);

  await claimWinner({ wagerId: offered.wagerId, actorUserId: offerer.user.id, verdict: 'OFFERER' });
  await claimWinner({
    wagerId: offered.wagerId,
    actorUserId: opponent.user.id,
    verdict: 'ACCEPTOR',
  });

  return offered.wagerId;
}

describe('WAGER_OFFERED', () => {
  it('queues one notification for a directed offer, addressed to the opponent', async () => {
    const offerer = await makeCreditedMembership();
    const opponent = await makeCreditedMembership(100_000n, offerer.seasonId);

    const result = await offerWager({
      actorUserId: offerer.user.id,
      kind: 'FREEFORM',
      description: 'Dana takes the over',
      opponentMembershipId: opponent.membership.id,
      offererStakeCents: 10_000n,
      acceptorStakeCents: 10_000n,
      expiresAt: new Date(Date.now() + 86_400_000),
      resolvesBy: new Date(Date.now() + 7 * 86_400_000),
    });
    if (!result.ok) throw new Error(`offer failed: ${result.error.code}`);

    const rows = await db.select().from(notifications);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('WAGER_OFFERED');
    expect(rows[0].userId).toBe(opponent.user.id);
    expect(rows[0].dedupeKey).toBe(`p2p:${result.wagerId}:offered:${opponent.user.id}`);
  });

  it('queues nothing for an open offer — mailing the season is the noise that gets it muted', async () => {
    const offerer = await makeCreditedMembership();

    const result = await offerWager({
      actorUserId: offerer.user.id,
      kind: 'FREEFORM',
      description: 'anyone want this',
      opponentMembershipId: null,
      offererStakeCents: 10_000n,
      acceptorStakeCents: 10_000n,
      expiresAt: new Date(Date.now() + 86_400_000),
      resolvesBy: new Date(Date.now() + 7 * 86_400_000),
    });
    if (!result.ok) throw new Error(`offer failed: ${result.error.code}`);

    expect(await db.select().from(notifications)).toHaveLength(0);
  });
});

describe('DISPUTE_NEEDS_RULING from a contested claim', () => {
  it('queues one row per admin, keyed on the attempt', async () => {
    const offerer = await makeCreditedMembership();
    const opponent = await makeCreditedMembership(100_000n, offerer.seasonId);
    const adminA = await makeUser({ role: 'ADMIN', status: 'APPROVED' });
    const adminB = await makeUser({ role: 'ADMIN', status: 'APPROVED' });

    // Drive the real services, exactly as claim.test.ts does: offer, accept, then have both
    // sides claim opposite verdicts.
    const wagerId = await offerAcceptAndDisagree(offerer, opponent);

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.type, 'DISPUTE_NEEDS_RULING'));

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.userId).sort()).toEqual([adminA.id, adminB.id].sort());
    expect(rows[0].dedupeKey).toContain(`p2p:${wagerId}:disputed:1:`);
  });

  it('excludes a disabled admin, who cannot rule on anything', async () => {
    const offerer = await makeCreditedMembership();
    const opponent = await makeCreditedMembership(100_000n, offerer.seasonId);
    await makeUser({ role: 'ADMIN', status: 'APPROVED' });
    await makeUser({ role: 'ADMIN', status: 'DISABLED' });

    await offerAcceptAndDisagree(offerer, opponent);

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.type, 'DISPUTE_NEEDS_RULING'));
    expect(rows).toHaveLength(1);
  });
});
