import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedEvents, ledgerEntries, p2pWagers, seasonMemberships } from '@/db/schema';
import { cancelOffer, declineWager, offerWager } from '@/server/p2p/offer';
import { resetDb } from '@/test/db';
import { makeCreditedMembership } from '@/test/factories';

async function credits(membershipId: string) {
  const [row] = await db
    .select({ credits: seasonMemberships.creditsBalanceCents })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, membershipId));
  return row.credits;
}

async function openOffer(actorUserId: string, opponentMembershipId?: string) {
  const result = await offerWager({
    actorUserId,
    kind: 'FREEFORM',
    opponentMembershipId,
    offererStakeCents: 50_000n,
    acceptorStakeCents: 20_000n,
    description: 'a test wager',
    expiresAt: new Date(Date.now() + 3_600_000),
    resolvesBy: new Date(Date.now() + 7 * 86_400_000),
  });
  if (!result.ok) throw new Error(`expected the offer to succeed: ${JSON.stringify(result)}`);
  return result.wagerId;
}

describe('cancelOffer', () => {
  beforeEach(resetDb);

  it('refunds the escrow and closes the offer', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const wagerId = await openOffer(offerer.user.id);
    expect(await credits(offerer.membership.id)).toBe(50_000n);

    const result = await cancelOffer({ wagerId, actorUserId: offerer.user.id });

    expect(result).toEqual({ ok: true, refundedCents: 50_000n });
    expect(await credits(offerer.membership.id)).toBe(100_000n);

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.status).toBe('CANCELED');

    const [refund] = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.type, 'P2P_REFUND'));
    expect(refund.amountCents).toBe(50_000n);
    expect(refund.currency).toBe('CREDITS');
    expect(refund.idempotencyKey).toBe(`p2p:${wagerId}:refund:canceled:${offerer.membership.id}`);
  });

  it('posts no feed card — a withdrawn offer is a non-event', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const wagerId = await openOffer(offerer.user.id);

    await cancelOffer({ wagerId, actorUserId: offerer.user.id });

    const types = await db.select({ type: feedEvents.type }).from(feedEvents);
    expect(types.map((t) => t.type)).toEqual(['P2P_OFFERED']);
  });

  it('is idempotent: cancelling twice refunds once', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const wagerId = await openOffer(offerer.user.id);

    await cancelOffer({ wagerId, actorUserId: offerer.user.id });
    const second = await cancelOffer({ wagerId, actorUserId: offerer.user.id });

    expect(second).toEqual({
      ok: false,
      error: { code: 'WAGER_NOT_OPEN', status: 'CANCELED' },
    });
    expect(await credits(offerer.membership.id)).toBe(100_000n);
    expect(
      await db.select().from(ledgerEntries).where(eq(ledgerEntries.type, 'P2P_REFUND')),
    ).toHaveLength(1);
  });

  it('refuses anyone who is not the offerer', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const other = await makeCreditedMembership(100_000n, offerer.seasonId);
    const wagerId = await openOffer(offerer.user.id);

    const result = await cancelOffer({ wagerId, actorUserId: other.user.id });

    expect(result).toEqual({ ok: false, error: { code: 'NOT_AUTHORIZED' } });
    expect(await credits(offerer.membership.id)).toBe(50_000n);
  });

  it('reports a missing wager', async () => {
    const offerer = await makeCreditedMembership(100_000n);

    const result = await cancelOffer({
      wagerId: '00000000-0000-4000-8000-000000000000',
      actorUserId: offerer.user.id,
    });

    expect(result).toEqual({ ok: false, error: { code: 'WAGER_NOT_FOUND' } });
  });
});

describe('declineWager', () => {
  beforeEach(resetDb);

  it('lets the named opponent refuse, refunding the offerer', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const opponent = await makeCreditedMembership(100_000n, offerer.seasonId);
    const wagerId = await openOffer(offerer.user.id, opponent.membership.id);

    const result = await declineWager({ wagerId, actorUserId: opponent.user.id });

    expect(result).toEqual({ ok: true, refundedCents: 50_000n });
    expect(await credits(offerer.membership.id)).toBe(100_000n);

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.status).toBe('CANCELED');
  });

  it('refuses a member who was not the one challenged', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const opponent = await makeCreditedMembership(100_000n, offerer.seasonId);
    const bystander = await makeCreditedMembership(100_000n, offerer.seasonId);
    const wagerId = await openOffer(offerer.user.id, opponent.membership.id);

    const result = await declineWager({ wagerId, actorUserId: bystander.user.id });

    expect(result).toEqual({ ok: false, error: { code: 'NOT_AUTHORIZED' } });
  });

  it('refuses to decline an open offer — nobody has standing', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const other = await makeCreditedMembership(100_000n, offerer.seasonId);
    const wagerId = await openOffer(offerer.user.id);

    const result = await declineWager({ wagerId, actorUserId: other.user.id });

    expect(result).toEqual({ ok: false, error: { code: 'NOT_AUTHORIZED' } });
  });
});
