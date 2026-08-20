import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedEvents, ledgerEntries, p2pWagers, seasonMemberships } from '@/db/schema';
import { acceptWager } from '@/server/p2p/accept';
import { arbitrateWager } from '@/server/p2p/arbitrate';
import { claimWinner } from '@/server/p2p/claim';
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

async function disputed() {
  const offerer = await makeCreditedMembership(100_000n);
  const acceptor = await makeCreditedMembership(100_000n, offerer.seasonId);
  const admin = await makeCreditedMembership(100_000n, offerer.seasonId);

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

  await claimWinner({ wagerId: offered.wagerId, actorUserId: offerer.user.id, verdict: 'OFFERER' });
  await claimWinner({
    wagerId: offered.wagerId,
    actorUserId: acceptor.user.id,
    verdict: 'ACCEPTOR',
  });

  return { offerer, acceptor, admin, wagerId: offered.wagerId };
}

describe('arbitrateWager', () => {
  beforeEach(resetDb);

  it('decides a disputed wager and pays the pot', async () => {
    const { offerer, acceptor, admin, wagerId } = await disputed();

    const result = await arbitrateWager({
      wagerId,
      actorUserId: admin.user.id,
      verdict: 'OFFERER',
      note: 'the group chat has the screenshot',
    });

    expect(result).toEqual({ ok: true, attempt: 1, paidCents: 70_000n });
    expect(await credits(offerer.membership.id)).toBe(120_000n);
    expect(await credits(acceptor.membership.id)).toBe(80_000n);

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.status).toBe('SETTLED');
    expect(wager.verdict).toBe('OFFERER');
    expect(wager.resolvedByUserId).toBe(admin.user.id);
    expect(wager.resolutionNote).toBe('the group chat has the screenshot');

    const [card] = await db.select().from(feedEvents).where(eq(feedEvents.type, 'P2P_SETTLED'));
    expect(card.payload).toMatchObject({ byArbitration: true, correction: false, attempt: 1 });
  });

  it('can refund both sides when neither was right', async () => {
    const { offerer, acceptor, admin, wagerId } = await disputed();

    const result = await arbitrateWager({
      wagerId,
      actorUserId: admin.user.id,
      verdict: 'VOID',
      note: 'nobody can establish what was said',
    });

    expect(result).toEqual({ ok: true, attempt: 1, paidCents: 70_000n });
    expect(await credits(offerer.membership.id)).toBe(100_000n);
    expect(await credits(acceptor.membership.id)).toBe(100_000n);

    const [card] = await db.select().from(feedEvents).where(eq(feedEvents.type, 'P2P_VOIDED'));
    expect(card.payload).toMatchObject({
      reason: 'ARBITRATED',
      note: 'nobody can establish what was said',
    });
    expect((card.payload as { adminDisplayName: string }).adminDisplayName).toBeTruthy();
  });

  it('corrects an already settled wager by reversing it first', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const acceptor = await makeCreditedMembership(100_000n, offerer.seasonId);
    const admin = await makeCreditedMembership(100_000n, offerer.seasonId);

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
    await acceptWager({ wagerId: offered.wagerId, actorUserId: acceptor.user.id });

    // Both agree, and it pays out.
    await claimWinner({
      wagerId: offered.wagerId,
      actorUserId: offerer.user.id,
      verdict: 'OFFERER',
    });
    await claimWinner({
      wagerId: offered.wagerId,
      actorUserId: acceptor.user.id,
      verdict: 'OFFERER',
    });
    expect(await credits(offerer.membership.id)).toBe(120_000n);

    const result = await arbitrateWager({
      wagerId: offered.wagerId,
      actorUserId: admin.user.id,
      verdict: 'ACCEPTOR',
      note: 'they agreed on the wrong reading of the terms',
    });

    expect(result).toEqual({ ok: true, attempt: 2, paidCents: 70_000n });
    expect(await credits(offerer.membership.id)).toBe(50_000n);
    expect(await credits(acceptor.membership.id)).toBe(150_000n);

    const reversals = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.type, 'SETTLEMENT_REVERSAL'));
    expect(reversals).toHaveLength(1);
    expect(reversals[0].note).toBe('they agreed on the wrong reading of the terms');
    expect(reversals[0].actorUserId).toBe(admin.user.id);
  });

  it('requires a note', async () => {
    const { admin, wagerId } = await disputed();

    const result = await arbitrateWager({
      wagerId,
      actorUserId: admin.user.id,
      verdict: 'OFFERER',
      note: '   ',
    });

    expect(result).toEqual({ ok: false, error: { code: 'NOTE_REQUIRED' } });

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.status).toBe('ACCEPTED');
  });

  it('refuses to arbitrate an offer nobody accepted', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const admin = await makeCreditedMembership(100_000n, offerer.seasonId);

    const offered = await offerWager({
      actorUserId: offerer.user.id,
      kind: 'FREEFORM',
      offererStakeCents: 10_000n,
      acceptorStakeCents: 10_000n,
      description: 'a test wager',
      expiresAt: new Date(Date.now() + 3_600_000),
      resolvesBy: new Date(Date.now() + 7 * 86_400_000),
    });
    if (!offered.ok) throw new Error('expected the offer to succeed');

    const result = await arbitrateWager({
      wagerId: offered.wagerId,
      actorUserId: admin.user.id,
      verdict: 'OFFERER',
      note: 'a note',
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'NOT_ARBITRABLE', status: 'OFFERED' },
    });
  });

  it('refuses to arbitrate a canceled or expired offer', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const admin = await makeCreditedMembership(100_000n, offerer.seasonId);
    const { cancelOffer } = await import('@/server/p2p/offer');

    const offered = await offerWager({
      actorUserId: offerer.user.id,
      kind: 'FREEFORM',
      offererStakeCents: 10_000n,
      acceptorStakeCents: 10_000n,
      description: 'a test wager',
      expiresAt: new Date(Date.now() + 3_600_000),
      resolvesBy: new Date(Date.now() + 7 * 86_400_000),
    });
    if (!offered.ok) throw new Error('expected the offer to succeed');
    await cancelOffer({ wagerId: offered.wagerId, actorUserId: offerer.user.id });

    const result = await arbitrateWager({
      wagerId: offered.wagerId,
      actorUserId: admin.user.id,
      verdict: 'VOID',
      note: 'a note',
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'NOT_ARBITRABLE', status: 'CANCELED' },
    });
  });

  it('reports a missing wager', async () => {
    const admin = await makeCreditedMembership(100_000n);

    const result = await arbitrateWager({
      wagerId: '00000000-0000-4000-8000-000000000000',
      actorUserId: admin.user.id,
      verdict: 'VOID',
      note: 'a note',
    });

    expect(result).toEqual({ ok: false, error: { code: 'WAGER_NOT_FOUND' } });
  });
});
