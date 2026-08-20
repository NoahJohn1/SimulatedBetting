import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedEvents, ledgerEntries, p2pWagers, seasonMemberships } from '@/db/schema';
import { acceptWager } from '@/server/p2p/accept';
import { offerWager } from '@/server/p2p/offer';
import { resetDb } from '@/test/db';
import { makeCreditedMembership, makeSeason } from '@/test/factories';

async function credits(membershipId: string) {
  const [row] = await db
    .select({ credits: seasonMemberships.creditsBalanceCents })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, membershipId));
  return row.credits;
}

async function openOffer(actorUserId: string, over: Record<string, unknown> = {}) {
  const result = await offerWager({
    actorUserId,
    kind: 'FREEFORM',
    offererStakeCents: 50_000n,
    acceptorStakeCents: 20_000n,
    description: 'a test wager',
    expiresAt: new Date(Date.now() + 3_600_000),
    resolvesBy: new Date(Date.now() + 7 * 86_400_000),
    ...over,
  });
  if (!result.ok) throw new Error(`expected the offer to succeed: ${JSON.stringify(result)}`);
  return result.wagerId;
}

describe('acceptWager', () => {
  beforeEach(resetDb);

  it('escrows the acceptor stake and marks the wager accepted', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const acceptor = await makeCreditedMembership(100_000n, offerer.seasonId);
    const wagerId = await openOffer(offerer.user.id);

    const result = await acceptWager({ wagerId, actorUserId: acceptor.user.id });

    expect(result).toMatchObject({ ok: true, wagerId, creditsBalanceCents: 80_000n });
    expect(await credits(acceptor.membership.id)).toBe(80_000n);
    // The offerer's stake left at offer and has not moved again.
    expect(await credits(offerer.membership.id)).toBe(50_000n);

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.status).toBe('ACCEPTED');
    expect(wager.acceptorMembershipId).toBe(acceptor.membership.id);
    expect(wager.acceptedAt).not.toBeNull();

    const escrows = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.type, 'P2P_ESCROW'));
    expect(escrows).toHaveLength(2);
    expect(escrows.map((e) => e.idempotencyKey).sort()).toEqual([
      `p2p:${wagerId}:escrow:acceptor`,
      `p2p:${wagerId}:escrow:offerer`,
    ]);
  });

  it('posts one P2P_ACCEPTED card naming the pot', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const acceptor = await makeCreditedMembership(100_000n, offerer.seasonId);
    const wagerId = await openOffer(offerer.user.id);

    await acceptWager({ wagerId, actorUserId: acceptor.user.id });

    const [card] = await db.select().from(feedEvents).where(eq(feedEvents.type, 'P2P_ACCEPTED'));
    expect(card.dedupeKey).toBe(`p2p:${wagerId}:accepted`);
    expect(card.subjectMembershipId).toBe(acceptor.membership.id);
    expect(card.payload).toMatchObject({ wagerId, potCents: '70000', subject: 'a test wager' });
  });

  it('lets exactly one of two simultaneous acceptors win', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const a = await makeCreditedMembership(100_000n, offerer.seasonId);
    const b = await makeCreditedMembership(100_000n, offerer.seasonId);
    const wagerId = await openOffer(offerer.user.id);

    const [first, second] = await Promise.all([
      acceptWager({ wagerId, actorUserId: a.user.id }),
      acceptWager({ wagerId, actorUserId: b.user.id }),
    ]);

    const wins = [first, second].filter((r) => r.ok);
    const losses = [first, second].filter((r) => !r.ok);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    expect(losses[0]).toMatchObject({
      ok: false,
      error: { code: 'WAGER_NOT_OPEN', status: 'ACCEPTED' },
    });

    // Exactly one acceptor escrow was written, so exactly one member was charged.
    const escrows = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.idempotencyKey, `p2p:${wagerId}:escrow:acceptor`));
    expect(escrows).toHaveLength(1);

    // Default Array.sort() compares bigints as strings ("100000" < "80000" lexically), so a
    // numeric comparator is required here to get an order-independent, correct assertion.
    const balances = [await credits(a.membership.id), await credits(b.membership.id)].sort(
      (x, y) => (x < y ? -1 : x > y ? 1 : 0),
    );
    expect(balances).toEqual([80_000n, 100_000n]);
  });

  it('refuses the offerer accepting their own offer', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const wagerId = await openOffer(offerer.user.id);

    const result = await acceptWager({ wagerId, actorUserId: offerer.user.id });

    expect(result).toEqual({ ok: false, error: { code: 'CANNOT_ACCEPT_OWN_OFFER' } });
  });

  it('refuses anyone but the named opponent on a directed offer', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const opponent = await makeCreditedMembership(100_000n, offerer.seasonId);
    const bystander = await makeCreditedMembership(100_000n, offerer.seasonId);
    const wagerId = await openOffer(offerer.user.id, {
      opponentMembershipId: opponent.membership.id,
    });

    const denied = await acceptWager({ wagerId, actorUserId: bystander.user.id });
    expect(denied).toEqual({ ok: false, error: { code: 'NOT_THE_INVITED_OPPONENT' } });

    const allowed = await acceptWager({ wagerId, actorUserId: opponent.user.id });
    expect(allowed.ok).toBe(true);
  });

  it('refuses an acceptor who cannot cover their stake', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const acceptor = await makeCreditedMembership(5_000n, offerer.seasonId);
    const wagerId = await openOffer(offerer.user.id);

    const result = await acceptWager({ wagerId, actorUserId: acceptor.user.id });

    expect(result).toEqual({
      ok: false,
      error: { code: 'INSUFFICIENT_CREDITS', availableCents: 5_000n },
    });

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.status).toBe('OFFERED');
  });

  it('refuses an offer whose expiry has passed', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const acceptor = await makeCreditedMembership(100_000n, offerer.seasonId);
    const wagerId = await openOffer(offerer.user.id);

    const result = await acceptWager({
      wagerId,
      actorUserId: acceptor.user.id,
      now: new Date(Date.now() + 2 * 3_600_000),
    });

    expect(result).toEqual({ ok: false, error: { code: 'OFFER_EXPIRED' } });
    expect(await credits(acceptor.membership.id)).toBe(100_000n);
  });

  it('refuses a member of another season', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const wagerId = await openOffer(offerer.user.id);
    // Only one ACTIVE season may exist at a time (seasons_one_active_idx), so the stranger's
    // season here has to be a real, distinct, non-active one rather than another default —
    // same fix offer.test.ts's "refuses an opponent from another season" already needed.
    const otherSeason = await makeSeason({ status: 'UPCOMING' });
    const stranger = await makeCreditedMembership(100_000n, otherSeason.id);

    const result = await acceptWager({ wagerId, actorUserId: stranger.user.id });

    expect(result).toEqual({ ok: false, error: { code: 'NOT_A_MEMBER' } });
  });

  it('reports a missing wager', async () => {
    const acceptor = await makeCreditedMembership(100_000n);

    const result = await acceptWager({
      wagerId: '00000000-0000-4000-8000-000000000000',
      actorUserId: acceptor.user.id,
    });

    expect(result).toEqual({ ok: false, error: { code: 'WAGER_NOT_FOUND' } });
  });
});
