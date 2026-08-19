import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/db/client';
import { bets, customEvents, feedEvents, ledgerEntries, seasonMemberships } from '@/db/schema';
import { placeBet } from '@/server/bets/place';
import { postEntry } from '@/server/money/ledger';
import { resetDb } from '@/test/db';
import { makeCustomEvent } from '@/test/factories';
import { makeMembership, seedBettableGame } from '@/server/bets/__tests__/helpers';

async function grantCredits(membershipId: string, cents: bigint) {
  await db.transaction((tx) =>
    postEntry(tx, {
      membershipId,
      amountCents: cents,
      type: 'SEASON_STARTING_GRANT',
      currency: 'CREDITS',
      idempotencyKey: `credits:${membershipId}`,
    }),
  );
}

describe('placing a bet on a custom event', () => {
  beforeEach(resetDb);

  it('debits credits, not cash, and stores the currency on the bet', async () => {
    const { membership, user, seasonId } = await makeMembership(1_000_000n);
    await grantCredits(membership.id, 50_000n);
    const event = await makeCustomEvent({
      creatorMembershipId: membership.id,
      seasonId,
    });

    const result = await placeBet({
      userId: user.id,
      type: 'SINGLE',
      stakeCents: 10_000n,
      clientRequestId: randomUUID(),
      legs: [
        {
          selectionId: event.marketSelections[0].selectionIds[0],
          line: null,
          priceAmerican: 100,
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [row] = await db
      .select({
        cash: seasonMemberships.balanceCents,
        credits: seasonMemberships.creditsBalanceCents,
      })
      .from(seasonMemberships)
      .where(eq(seasonMemberships.id, membership.id));

    expect(row).toEqual({ cash: 1_000_000n, credits: 40_000n });

    const [bet] = await db.select().from(bets).where(eq(bets.id, result.bet.id));
    expect(bet.currency).toBe('CREDITS');

    const [entry] = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.betId, result.bet.id));
    expect(entry.currency).toBe('CREDITS');
  });

  it('rejects a stake the credits balance cannot cover, however much cash there is', async () => {
    const { membership, user, seasonId } = await makeMembership(1_000_000n);
    await grantCredits(membership.id, 500n);
    const event = await makeCustomEvent({ creatorMembershipId: membership.id, seasonId });

    const result = await placeBet({
      userId: user.id,
      type: 'SINGLE',
      stakeCents: 10_000n,
      clientRequestId: randomUUID(),
      legs: [
        { selectionId: event.marketSelections[0].selectionIds[0], line: null, priceAmerican: 100 },
      ],
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'INSUFFICIENT_FUNDS', stakeCents: 10_000n, balanceCents: 500n },
    });
  });

  it('rejects a slip mixing a game leg with a custom leg', async () => {
    const { membership, user, seasonId } = await makeMembership(1_000_000n);
    await grantCredits(membership.id, 50_000n);
    const game = await seedBettableGame();
    const event = await makeCustomEvent({ creatorMembershipId: membership.id, seasonId });

    const result = await placeBet({
      userId: user.id,
      type: 'PARLAY',
      stakeCents: 1_000n,
      clientRequestId: randomUUID(),
      legs: [
        { selectionId: game.moneyline.home, line: null, priceAmerican: -110 },
        { selectionId: event.marketSelections[0].selectionIds[0], line: null, priceAmerican: 100 },
      ],
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'MIXED_CURRENCY_PARLAY', gameLegIndexes: [0], customLegIndexes: [1] },
    });

    expect(await db.select().from(bets)).toHaveLength(0);
  });

  it('rejects two legs on the same custom event', async () => {
    const { membership, user, seasonId } = await makeMembership(1_000_000n);
    await grantCredits(membership.id, 50_000n);
    const event = await makeCustomEvent({ creatorMembershipId: membership.id, seasonId });

    const result = await placeBet({
      userId: user.id,
      type: 'PARLAY',
      stakeCents: 1_000n,
      clientRequestId: randomUUID(),
      legs: [
        { selectionId: event.marketSelections[0].selectionIds[0], line: null, priceAmerican: 100 },
        { selectionId: event.marketSelections[1].selectionIds[0], line: null, priceAmerican: 100 },
      ],
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'DUPLICATE_EVENT', eventId: event.eventId, legIndexes: [0, 1] },
    });
  });

  it('rejects a leg on a closed event', async () => {
    const { membership, user, seasonId } = await makeMembership(1_000_000n);
    await grantCredits(membership.id, 50_000n);
    const event = await makeCustomEvent({ creatorMembershipId: membership.id, seasonId });

    await db
      .update(customEvents)
      .set({ status: 'VOIDED' })
      .where(eq(customEvents.eventId, event.eventId));

    const result = await placeBet({
      userId: user.id,
      type: 'SINGLE',
      stakeCents: 1_000n,
      clientRequestId: randomUUID(),
      legs: [
        { selectionId: event.marketSelections[0].selectionIds[0], line: null, priceAmerican: 100 },
      ],
    });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'EVENT_NOT_BETTABLE', eventStatus: 'VOIDED' }),
    });
  });

  it('labels the creator on their own bet card', async () => {
    const { membership, user, seasonId } = await makeMembership(1_000_000n);
    await grantCredits(membership.id, 50_000n);
    const event = await makeCustomEvent({ creatorMembershipId: membership.id, seasonId });

    const result = await placeBet({
      userId: user.id,
      type: 'SINGLE',
      stakeCents: 1_000n,
      clientRequestId: randomUUID(),
      legs: [
        { selectionId: event.marketSelections[0].selectionIds[0], line: null, priceAmerican: 100 },
      ],
    });
    if (!result.ok) throw new Error('expected ok');

    const [card] = await db
      .select()
      .from(feedEvents)
      .where(eq(feedEvents.betId, result.bet.id));

    expect(card.payload).toMatchObject({
      currency: 'CREDITS',
      legs: [
        {
          kind: 'CUSTOM',
          eventTitle: 'Test Cup',
          marketTitle: 'Who wins the cup?',
          outcomeLabel: 'Falcons',
          byCreator: true,
        },
      ],
    });
  });
});
