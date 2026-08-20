import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedEvents, p2pWagers, seasonMemberships } from '@/db/schema';
import { acceptWager } from '@/server/p2p/accept';
import { proposeCancel } from '@/server/p2p/claim';
import { offerWager } from '@/server/p2p/offer';
import { resetDb } from '@/test/db';
import { makeCreditedMembership } from '@/test/factories';

async function credits(membershipId: string) {
  const [row] = await db
    .select({ credits: seasonMemberships.creditsBalanceCents })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, membershipId));
  return row.credits;
}

async function accepted() {
  const offerer = await makeCreditedMembership(100_000n);
  const acceptor = await makeCreditedMembership(100_000n, offerer.seasonId);

  const offered = await offerWager({
    actorUserId: offerer.user.id,
    kind: 'FREEFORM',
    offererStakeCents: 50_000n,
    acceptorStakeCents: 20_000n,
    description: 'a test wager',
    expiresAt: new Date(Date.now() + 3_600_000),
    resolvesBy: new Date(Date.now() + 7 * 86_400_000),
  });
  if (!offered.ok) throw new Error('expected the offer to succeed');

  const taken = await acceptWager({ wagerId: offered.wagerId, actorUserId: acceptor.user.id });
  if (!taken.ok) throw new Error('expected the acceptance to succeed');

  return { offerer, acceptor, wagerId: offered.wagerId };
}

describe('proposeCancel', () => {
  beforeEach(resetDb);

  it('does nothing on its own', async () => {
    const { offerer, acceptor, wagerId } = await accepted();

    const result = await proposeCancel({ wagerId, actorUserId: offerer.user.id });

    expect(result).toEqual({ ok: true, outcome: 'AWAITING_OTHER', refundedCents: 0n });

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.status).toBe('ACCEPTED');
    expect(wager.offererCancelProposed).toBe(true);
    expect(wager.acceptorCancelProposed).toBe(false);

    expect(await credits(offerer.membership.id)).toBe(50_000n);
    expect(await credits(acceptor.membership.id)).toBe(80_000n);
  });

  it('voids and refunds both stakes once both agree', async () => {
    const { offerer, acceptor, wagerId } = await accepted();

    await proposeCancel({ wagerId, actorUserId: offerer.user.id });
    const result = await proposeCancel({ wagerId, actorUserId: acceptor.user.id });

    expect(result).toEqual({ ok: true, outcome: 'VOIDED', refundedCents: 70_000n });

    // Each gets back exactly what they put in, not half the pot each.
    expect(await credits(offerer.membership.id)).toBe(100_000n);
    expect(await credits(acceptor.membership.id)).toBe(100_000n);

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.status).toBe('VOIDED');
    expect(wager.verdict).toBe('VOID');

    const [card] = await db.select().from(feedEvents).where(eq(feedEvents.type, 'P2P_VOIDED'));
    expect(card.payload).toMatchObject({ reason: 'MUTUAL_CANCEL', refundedCents: '70000' });
  });

  it('is idempotent — one party proposing twice is still one proposal', async () => {
    const { offerer, acceptor, wagerId } = await accepted();

    await proposeCancel({ wagerId, actorUserId: offerer.user.id });
    const second = await proposeCancel({ wagerId, actorUserId: offerer.user.id });

    expect(second).toEqual({ ok: true, outcome: 'AWAITING_OTHER', refundedCents: 0n });
    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.status).toBe('ACCEPTED');
    expect(await credits(acceptor.membership.id)).toBe(80_000n);
  });

  it('refuses a non-party', async () => {
    const { offerer, wagerId } = await accepted();
    const bystander = await makeCreditedMembership(100_000n, offerer.seasonId);

    const result = await proposeCancel({ wagerId, actorUserId: bystander.user.id });

    expect(result).toEqual({ ok: false, error: { code: 'NOT_A_PARTY' } });
  });

  it('refuses once the wager has settled', async () => {
    const { offerer, acceptor, wagerId } = await accepted();

    await proposeCancel({ wagerId, actorUserId: offerer.user.id });
    await proposeCancel({ wagerId, actorUserId: acceptor.user.id });

    const result = await proposeCancel({ wagerId, actorUserId: offerer.user.id });

    expect(result).toEqual({
      ok: false,
      error: { code: 'WAGER_NOT_ACCEPTED', status: 'VOIDED' },
    });
  });
});
