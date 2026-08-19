import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedEvents, ledgerEntries, p2pWagers, seasonMemberships } from '@/db/schema';
import { acceptWager } from '@/server/p2p/accept';
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

/** Offerer stakes 50,000; acceptor stakes 20,000; pot is 70,000. */
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

describe('claimWinner', () => {
  beforeEach(resetDb);

  it('records the first claim and waits for the other side', async () => {
    const { offerer, acceptor, wagerId } = await accepted();

    const result = await claimWinner({
      wagerId,
      actorUserId: offerer.user.id,
      verdict: 'OFFERER',
    });

    expect(result).toEqual({
      ok: true,
      outcome: 'AWAITING_OTHER',
      verdict: null,
      paidCents: 0n,
    });

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.status).toBe('ACCEPTED');
    expect(wager.offererClaim).toBe('OFFERER');
    expect(wager.acceptorClaim).toBeNull();

    // Nothing moved.
    expect(await credits(offerer.membership.id)).toBe(50_000n);
    expect(await credits(acceptor.membership.id)).toBe(80_000n);
  });

  it('settles the moment both parties agree', async () => {
    const { offerer, acceptor, wagerId } = await accepted();

    await claimWinner({ wagerId, actorUserId: offerer.user.id, verdict: 'OFFERER' });
    const result = await claimWinner({
      wagerId,
      actorUserId: acceptor.user.id,
      verdict: 'OFFERER',
    });

    expect(result).toEqual({
      ok: true,
      outcome: 'SETTLED',
      verdict: 'OFFERER',
      paidCents: 70_000n,
    });
    expect(await credits(offerer.membership.id)).toBe(120_000n);
    expect(await credits(acceptor.membership.id)).toBe(80_000n);

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.status).toBe('SETTLED');
    expect(wager.verdict).toBe('OFFERER');
  });

  it('treats a mutual VOID claim as an agreement to refund', async () => {
    const { offerer, acceptor, wagerId } = await accepted();

    await claimWinner({ wagerId, actorUserId: offerer.user.id, verdict: 'VOID' });
    const result = await claimWinner({
      wagerId,
      actorUserId: acceptor.user.id,
      verdict: 'VOID',
    });

    expect(result).toMatchObject({ outcome: 'SETTLED', verdict: 'VOID' });
    expect(await credits(offerer.membership.id)).toBe(100_000n);
    expect(await credits(acceptor.membership.id)).toBe(100_000n);

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.status).toBe('VOIDED');

    const [card] = await db.select().from(feedEvents).where(eq(feedEvents.type, 'P2P_VOIDED'));
    expect(card.payload).toMatchObject({ reason: 'AGREED_VOID' });
  });

  it('disputes when the two disagree, moving no money', async () => {
    const { offerer, acceptor, wagerId } = await accepted();

    await claimWinner({ wagerId, actorUserId: offerer.user.id, verdict: 'OFFERER' });
    const result = await claimWinner({
      wagerId,
      actorUserId: acceptor.user.id,
      verdict: 'ACCEPTOR',
    });

    expect(result).toEqual({
      ok: true,
      outcome: 'DISPUTED',
      verdict: null,
      paidCents: 0n,
    });

    // Still ACCEPTED — disputed is derived from the two claims, never stored (D44).
    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.status).toBe('ACCEPTED');
    expect(wager.offererClaim).toBe('OFFERER');
    expect(wager.acceptorClaim).toBe('ACCEPTOR');
    expect(wager.verdict).toBeNull();

    expect(await credits(offerer.membership.id)).toBe(50_000n);
    expect(await credits(acceptor.membership.id)).toBe(80_000n);
    expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.type, 'P2P_WON'))).toHaveLength(0);
  });

  it('posts one P2P_DISPUTED card', async () => {
    const { offerer, acceptor, wagerId } = await accepted();

    await claimWinner({ wagerId, actorUserId: offerer.user.id, verdict: 'OFFERER' });
    await claimWinner({ wagerId, actorUserId: acceptor.user.id, verdict: 'ACCEPTOR' });

    const [card] = await db.select().from(feedEvents).where(eq(feedEvents.type, 'P2P_DISPUTED'));
    expect(card.dedupeKey).toBe(`p2p:${wagerId}:disputed:1`);
    expect(card.subjectMembershipId).toBe(acceptor.membership.id);
    expect(card.payload).toMatchObject({ wagerId, subject: 'a test wager', attempt: 1 });
  });

  it('lets a party change their mind, which can resolve a dispute', async () => {
    const { offerer, acceptor, wagerId } = await accepted();

    await claimWinner({ wagerId, actorUserId: offerer.user.id, verdict: 'OFFERER' });
    await claimWinner({ wagerId, actorUserId: acceptor.user.id, verdict: 'ACCEPTOR' });

    // The acceptor concedes.
    const result = await claimWinner({
      wagerId,
      actorUserId: acceptor.user.id,
      verdict: 'OFFERER',
    });

    expect(result).toMatchObject({ outcome: 'SETTLED', verdict: 'OFFERER' });
    expect(await credits(offerer.membership.id)).toBe(120_000n);
  });

  it('refuses a claim from someone who is not a party', async () => {
    const { offerer, wagerId } = await accepted();
    const bystander = await makeCreditedMembership(100_000n, offerer.seasonId);

    const result = await claimWinner({
      wagerId,
      actorUserId: bystander.user.id,
      verdict: 'OFFERER',
    });

    expect(result).toEqual({ ok: false, error: { code: 'NOT_A_PARTY' } });
  });

  it('refuses a claim on an unaccepted offer', async () => {
    const offerer = await makeCreditedMembership(100_000n);
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

    const result = await claimWinner({
      wagerId: offered.wagerId,
      actorUserId: offerer.user.id,
      verdict: 'OFFERER',
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'WAGER_NOT_ACCEPTED', status: 'OFFERED' },
    });
  });

  it('refuses a claim on an already settled wager', async () => {
    const { offerer, acceptor, wagerId } = await accepted();

    await claimWinner({ wagerId, actorUserId: offerer.user.id, verdict: 'OFFERER' });
    await claimWinner({ wagerId, actorUserId: acceptor.user.id, verdict: 'OFFERER' });

    const result = await claimWinner({
      wagerId,
      actorUserId: acceptor.user.id,
      verdict: 'ACCEPTOR',
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'WAGER_NOT_ACCEPTED', status: 'SETTLED' },
    });
    // The settled payout is untouched.
    expect(await credits(offerer.membership.id)).toBe(120_000n);
  });

  it('pays once when both parties claim simultaneously', async () => {
    const { offerer, acceptor, wagerId } = await accepted();

    await Promise.all([
      claimWinner({ wagerId, actorUserId: offerer.user.id, verdict: 'OFFERER' }),
      claimWinner({ wagerId, actorUserId: acceptor.user.id, verdict: 'OFFERER' }),
    ]);

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.status).toBe('SETTLED');
    expect(wager.settlementAttempts).toBe(1);

    const won = await db.select().from(ledgerEntries).where(eq(ledgerEntries.type, 'P2P_WON'));
    expect(won).toHaveLength(1);
    expect(await credits(offerer.membership.id)).toBe(120_000n);
  });
});
