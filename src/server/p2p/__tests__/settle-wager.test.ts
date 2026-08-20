import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedEvents, ledgerEntries, p2pWagers, seasonMemberships } from '@/db/schema';
import { settleWagerInTx } from '@/server/p2p/settle-wager';
import { acceptWager } from '@/server/p2p/accept';
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

/** An accepted wager: offerer stakes 50,000, acceptor stakes 20,000, pot is 70,000. */
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

function settle(wagerId: string, verdict: 'OFFERER' | 'ACCEPTOR' | 'VOID', over = {}) {
  return db.transaction((tx) =>
    settleWagerInTx(tx, {
      wagerId,
      verdict,
      settledAt: new Date('2026-09-10T00:00:00Z'),
      reason: 'AGREED_VOID',
      byArbitration: false,
      ...over,
    }),
  );
}

describe('settleWagerInTx', () => {
  beforeEach(resetDb);

  it('pays the whole pot to the offerer', async () => {
    const { offerer, acceptor, wagerId } = await accepted();

    const summary = await settle(wagerId, 'OFFERER');

    expect(summary).toMatchObject({ attempt: 1, paidCents: 70_000n });
    expect(summary.winnerMembershipId).toBe(offerer.membership.id);

    // Started 100,000, escrowed 50,000, took the 70,000 pot.
    expect(await credits(offerer.membership.id)).toBe(120_000n);
    // Started 100,000, escrowed 20,000, got nothing back.
    expect(await credits(acceptor.membership.id)).toBe(80_000n);

    const [won] = await db.select().from(ledgerEntries).where(eq(ledgerEntries.type, 'P2P_WON'));
    expect(won.membershipId).toBe(offerer.membership.id);
    expect(won.amountCents).toBe(70_000n);
    expect(won.currency).toBe('CREDITS');
    expect(won.idempotencyKey).toBe(`p2p:${wagerId}:settled:1:won`);

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.status).toBe('SETTLED');
    expect(wager.verdict).toBe('OFFERER');
    expect(wager.settlementAttempts).toBe(1);
  });

  it('pays the whole pot to the acceptor', async () => {
    const { offerer, acceptor, wagerId } = await accepted();

    await settle(wagerId, 'ACCEPTOR');

    expect(await credits(acceptor.membership.id)).toBe(150_000n);
    expect(await credits(offerer.membership.id)).toBe(50_000n);
  });

  it('refunds each stake to its owner on VOID', async () => {
    const { offerer, acceptor, wagerId } = await accepted();

    const summary = await settle(wagerId, 'VOID');

    expect(summary).toMatchObject({ attempt: 1, paidCents: 70_000n, winnerMembershipId: null });
    expect(await credits(offerer.membership.id)).toBe(100_000n);
    expect(await credits(acceptor.membership.id)).toBe(100_000n);

    const refunds = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.type, 'P2P_REFUND'));
    expect(refunds).toHaveLength(2);
    expect(refunds.map((r) => r.amountCents).sort()).toEqual([20_000n, 50_000n]);

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.status).toBe('VOIDED');
  });

  it('posts a P2P_SETTLED card on a decided wager', async () => {
    const { wagerId } = await accepted();

    await settle(wagerId, 'OFFERER');

    const [card] = await db.select().from(feedEvents).where(eq(feedEvents.type, 'P2P_SETTLED'));
    expect(card.dedupeKey).toBe(`p2p:${wagerId}:settled:1`);
    expect(card.payload).toMatchObject({
      wagerId,
      verdict: 'OFFERER',
      potCents: '70000',
      attempt: 1,
      correction: false,
      byArbitration: false,
    });
  });

  it('posts a P2P_VOIDED card instead when nobody won', async () => {
    const { wagerId } = await accepted();

    await settle(wagerId, 'VOID', { reason: 'MUTUAL_CANCEL' });

    expect(await db.select().from(feedEvents).where(eq(feedEvents.type, 'P2P_SETTLED'))).toHaveLength(0);
    const [card] = await db.select().from(feedEvents).where(eq(feedEvents.type, 'P2P_VOIDED'));
    expect(card.subjectMembershipId).toBeNull();
    expect(card.dedupeKey).toBe(`p2p:${wagerId}:voided:1`);
    expect(card.payload).toMatchObject({ reason: 'MUTUAL_CANCEL', refundedCents: '70000' });
  });

  it('reverses attempt 1 before paying attempt 2', async () => {
    const { offerer, acceptor, wagerId } = await accepted();

    await settle(wagerId, 'OFFERER');
    expect(await credits(offerer.membership.id)).toBe(120_000n);

    const summary = await settle(wagerId, 'ACCEPTOR', {
      byArbitration: true,
      note: 'the video shows otherwise',
      actorUserId: offerer.user.id,
    });

    expect(summary.attempt).toBe(2);
    // The offerer's 70,000 is taken back; the acceptor is paid the pot instead.
    expect(await credits(offerer.membership.id)).toBe(50_000n);
    expect(await credits(acceptor.membership.id)).toBe(150_000n);

    const reversals = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.type, 'SETTLEMENT_REVERSAL'));
    expect(reversals).toHaveLength(1);
    expect(reversals[0].amountCents).toBe(-70_000n);
    expect(reversals[0].idempotencyKey).toBe(
      `p2p:${wagerId}:reversal:2:${offerer.membership.id}`,
    );

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.verdict).toBe('ACCEPTOR');
    expect(wager.settlementAttempts).toBe(2);
    expect(wager.resolutionNote).toBe('the video shows otherwise');
  });

  it('marks a corrected settlement as a correction on its card', async () => {
    const { offerer, wagerId } = await accepted();

    await settle(wagerId, 'OFFERER');
    await settle(wagerId, 'ACCEPTOR', {
      byArbitration: true,
      note: 'corrected',
      actorUserId: offerer.user.id,
    });

    const cards = await db.select().from(feedEvents).where(eq(feedEvents.type, 'P2P_SETTLED'));
    expect(cards).toHaveLength(2);
    const second = cards.find((c) => c.dedupeKey === `p2p:${wagerId}:settled:2`)!;
    expect(second.payload).toMatchObject({ attempt: 2, correction: true, byArbitration: true });
  });

  it('reverses a void correctly — both refunds come back', async () => {
    const { offerer, acceptor, wagerId } = await accepted();

    await settle(wagerId, 'VOID');
    expect(await credits(offerer.membership.id)).toBe(100_000n);

    await settle(wagerId, 'OFFERER', {
      byArbitration: true,
      note: 'it was resolvable after all',
      actorUserId: offerer.user.id,
    });

    // Both refunds are pulled back, then the pot is paid to the offerer.
    expect(await credits(offerer.membership.id)).toBe(120_000n);
    expect(await credits(acceptor.membership.id)).toBe(80_000n);

    const reversals = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.type, 'SETTLEMENT_REVERSAL'));
    expect(reversals).toHaveLength(2);
    // Array.prototype.sort() with no comparator sorts by string coercion, which does not
    // match numeric order for negative bigints (e.g. [-50000n, -20000n].sort() ===
    // [-20000n, -50000n] because "-5" > "-2" lexicographically). Use a numeric comparator.
    expect(reversals.map((r) => r.amountCents).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual([
      -50_000n,
      -20_000n,
    ]);
  });

  it('nets a third correction against everything paid so far, not just the second attempt', async () => {
    const { offerer, acceptor, wagerId } = await accepted();

    // Attempt 1: offerer wins the pot.
    await settle(wagerId, 'OFFERER');
    // Attempt 2: corrected to the acceptor.
    await settle(wagerId, 'ACCEPTOR', { byArbitration: true, note: 'corrected once' });
    // Attempt 3: corrected again, to VOID. Both stakes must land back at their owners with no
    // drift, even though the offerer's attempt-1 win was already reversed once before.
    const summary = await settle(wagerId, 'VOID', {
      byArbitration: true,
      note: 'corrected twice',
    });

    expect(summary.attempt).toBe(3);
    expect(await credits(offerer.membership.id)).toBe(100_000n);
    expect(await credits(acceptor.membership.id)).toBe(100_000n);

    // Exactly one reversal per member at attempt 3 — the net of everything attempt 3 undoes,
    // not one entry per historical payout row.
    const attempt3Reversals = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.idempotencyKey, `p2p:${wagerId}:reversal:3:${acceptor.membership.id}`));
    expect(attempt3Reversals).toHaveLength(1);
    expect(attempt3Reversals[0].amountCents).toBe(-70_000n);

    // The offerer's attempt-1 win was already fully undone at attempt 2, so attempt 3 must not
    // touch the offerer's balance at all (no reversal row for the offerer at attempt 3).
    const offererAttempt3Reversals = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.idempotencyKey, `p2p:${wagerId}:reversal:3:${offerer.membership.id}`));
    expect(offererAttempt3Reversals).toHaveLength(0);
  });
});
