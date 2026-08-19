import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/db/client';
import { betLegs, bets, customEvents, feedEvents, seasonMemberships } from '@/db/schema';
import { placeBet } from '@/server/bets/place';
import { resolveCustomEvent, voidCustomEvent } from '@/server/events/resolve';
import { postEntry } from '@/server/money/ledger';
import { resetDb } from '@/test/db';
import { makeCustomEvent } from '@/test/factories';
import { makeMembership, makeUser } from '@/server/bets/__tests__/helpers';

async function seedWithBets() {
  const creator = await makeMembership(1_000_000n);
  const bettor = await makeMembership(1_000_000n, creator.seasonId);
  const adminUser = await makeUser({ role: 'ADMIN' });

  for (const m of [creator.membership.id, bettor.membership.id]) {
    await db.transaction((tx) =>
      postEntry(tx, {
        membershipId: m,
        amountCents: 100_000n,
        type: 'SEASON_STARTING_GRANT',
        currency: 'CREDITS',
        idempotencyKey: `credits:${m}`,
      }),
    );
  }

  const event = await makeCustomEvent({
    creatorMembershipId: creator.membership.id,
    seasonId: creator.seasonId,
  });

  const placed = await placeBet({
    userId: bettor.user.id,
    type: 'SINGLE',
    stakeCents: 25_000n,
    clientRequestId: randomUUID(),
    legs: [
      { selectionId: event.marketSelections[0].selectionIds[0], line: null, priceAmerican: 100 },
    ],
  });
  if (!placed.ok) throw new Error('expected placement to succeed');

  return { creator, bettor, adminUser, event, betId: placed.bet.id };
}

async function credits(membershipId: string) {
  const [row] = await db
    .select({ credits: seasonMemberships.creditsBalanceCents })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, membershipId));
  return row.credits;
}

describe('voidCustomEvent', () => {
  beforeEach(resetDb);

  it('refunds every open stake and voids the bets', async () => {
    const { bettor, adminUser, event, betId } = await seedWithBets();

    expect(await credits(bettor.membership.id)).toBe(75_000n);

    const result = await voidCustomEvent({
      eventId: event.eventId,
      actorUserId: adminUser.id,
      note: 'the tournament was cancelled',
    });

    expect(result).toMatchObject({ ok: true, refundedBets: 1, refundedCents: 25_000n });
    expect(await credits(bettor.membership.id)).toBe(100_000n);

    const [bet] = await db.select().from(bets).where(eq(bets.id, betId));
    expect(bet.status).toBe('VOIDED');

    const legs = await db.select().from(betLegs).where(eq(betLegs.betId, betId));
    expect(legs.every((l) => l.status === 'VOIDED')).toBe(true);

    const [custom] = await db
      .select()
      .from(customEvents)
      .where(eq(customEvents.eventId, event.eventId));
    expect(custom.status).toBe('VOIDED');
  });

  it('unwinds a resolved event through the reversal path', async () => {
    const { creator, bettor, adminUser, event } = await seedWithBets();

    await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: creator.user.id,
      actorMembershipId: creator.membership.id,
      isAdmin: false,
      winners: event.marketSelections.map((m) => ({
        marketId: m.marketId,
        winningSelectionId: m.selectionIds[0],
      })),
    });
    // Won at even money: 75,000 + 50,000.
    expect(await credits(bettor.membership.id)).toBe(125_000n);

    await voidCustomEvent({
      eventId: event.eventId,
      actorUserId: adminUser.id,
      note: 'the result was fabricated',
    });

    // The 50,000 payout reverses and the 25,000 stake refunds.
    expect(await credits(bettor.membership.id)).toBe(100_000n);
  });

  it('requires a note', async () => {
    const { adminUser, event } = await seedWithBets();

    const result = await voidCustomEvent({
      eventId: event.eventId,
      actorUserId: adminUser.id,
      note: '  ',
    });

    expect(result).toEqual({ ok: false, error: { code: 'NOTE_REQUIRED' } });
  });

  it('rejects voiding twice', async () => {
    const { adminUser, event } = await seedWithBets();

    await voidCustomEvent({ eventId: event.eventId, actorUserId: adminUser.id, note: 'once' });
    const second = await voidCustomEvent({
      eventId: event.eventId,
      actorUserId: adminUser.id,
      note: 'twice',
    });

    expect(second).toEqual({ ok: false, error: { code: 'ALREADY_VOIDED' } });
  });

  it('posts one CUSTOM_EVENT_VOIDED card with the refund total', async () => {
    const { adminUser, event } = await seedWithBets();

    await voidCustomEvent({
      eventId: event.eventId,
      actorUserId: adminUser.id,
      note: 'the tournament was cancelled',
    });

    const [card] = await db
      .select()
      .from(feedEvents)
      .where(eq(feedEvents.type, 'CUSTOM_EVENT_VOIDED'));

    expect(card.dedupeKey).toBe(`customevent:${event.eventId}:voided`);
    expect(card.subjectMembershipId).toBeNull();
    expect(card.payload).toMatchObject({
      refundedBetCount: 1,
      refundedCreditsCents: '25000',
      note: 'the tournament was cancelled',
    });
  });
});
