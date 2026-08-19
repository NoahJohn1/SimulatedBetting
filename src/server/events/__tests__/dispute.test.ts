import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/db/client';
import {
  bets,
  customEventDisputes,
  feedEvents,
  ledgerEntries,
  seasonMemberships,
} from '@/db/schema';
import { placeBet } from '@/server/bets/place';
import { disputeResolution } from '@/server/events/dispute';
import { resolveCustomEvent } from '@/server/events/resolve';
import { postEntry } from '@/server/money/ledger';
import { resetDb } from '@/test/db';
import { makeCustomEvent } from '@/test/factories';
import { makeMembership, makeUser } from '@/server/bets/__tests__/helpers';

async function seedResolvedWrong() {
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

  // The bettor takes Ravens (index 1) in the first market.
  const placed = await placeBet({
    userId: bettor.user.id,
    type: 'SINGLE',
    stakeCents: 10_000n,
    clientRequestId: randomUUID(),
    legs: [
      { selectionId: event.marketSelections[0].selectionIds[1], line: null, priceAmerican: 100 },
    ],
  });
  if (!placed.ok) throw new Error('expected placement to succeed');

  // The creator wrongly declares Falcons (index 0) everywhere.
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

  return { creator, bettor, adminUser, event, betId: placed.bet.id };
}

async function credits(membershipId: string) {
  const [row] = await db
    .select({ credits: seasonMemberships.creditsBalanceCents })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, membershipId));
  return row.credits;
}

describe('disputes and re-resolution', () => {
  beforeEach(resetDb);

  it('records a dispute and posts a card', async () => {
    const { bettor, event } = await seedResolvedWrong();

    const result = await disputeResolution({
      eventId: event.eventId,
      membershipId: bettor.membership.id,
      reason: 'map 3 was forfeited, Ravens took the series',
    });

    expect(result).toMatchObject({ ok: true, created: true });

    const rows = await db
      .select()
      .from(customEventDisputes)
      .where(eq(customEventDisputes.eventId, event.eventId));
    expect(rows).toHaveLength(1);
    expect(rows[0].resolvedAt).toBeNull();

    const [card] = await db
      .select()
      .from(feedEvents)
      .where(eq(feedEvents.type, 'CUSTOM_EVENT_DISPUTED'));
    expect(card.dedupeKey).toBe(`customevent:${event.eventId}:disputed:${bettor.membership.id}`);
  });

  it('a second dispute from the same member is a no-op', async () => {
    const { bettor, event } = await seedResolvedWrong();

    await disputeResolution({
      eventId: event.eventId,
      membershipId: bettor.membership.id,
      reason: 'first',
    });
    const second = await disputeResolution({
      eventId: event.eventId,
      membershipId: bettor.membership.id,
      reason: 'second',
    });

    expect(second).toMatchObject({ ok: true, created: false });
    expect(
      await db
        .select()
        .from(customEventDisputes)
        .where(eq(customEventDisputes.eventId, event.eventId)),
    ).toHaveLength(1);
  });

  it('rejects a dispute on an event that is not resolved', async () => {
    const creator = await makeMembership(1_000_000n);
    const event = await makeCustomEvent({
      creatorMembershipId: creator.membership.id,
      seasonId: creator.seasonId,
    });

    const result = await disputeResolution({
      eventId: event.eventId,
      membershipId: creator.membership.id,
      reason: 'too early',
    });

    expect(result).toEqual({ ok: false, error: { code: 'NOT_RESOLVED' } });
  });

  it('rejects an empty reason', async () => {
    const { bettor, event } = await seedResolvedWrong();

    const result = await disputeResolution({
      eventId: event.eventId,
      membershipId: bettor.membership.id,
      reason: '   ',
    });

    expect(result).toEqual({ ok: false, error: { code: 'REASON_REQUIRED' } });
  });

  it('an admin re-resolution reverses the wrong payout and pays the right one', async () => {
    const { bettor, adminUser, creator, event, betId } = await seedResolvedWrong();

    // After the wrong call the bettor lost: 100,000 - 10,000 staked.
    expect(await credits(bettor.membership.id)).toBe(90_000n);

    await disputeResolution({
      eventId: event.eventId,
      membershipId: bettor.membership.id,
      reason: 'map 3 was forfeited',
    });

    const result = await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: adminUser.id,
      actorMembershipId: creator.membership.id,
      isAdmin: true,
      note: 'confirmed the forfeit on the tournament page',
      winners: event.marketSelections.map((m) => ({
        marketId: m.marketId,
        winningSelectionId: m.selectionIds[1],
      })),
    });

    expect(result).toMatchObject({ ok: true, attempt: 2 });

    // Even money on a 10,000 stake: the bettor is made whole and paid 20,000 back.
    expect(await credits(bettor.membership.id)).toBe(110_000n);

    const [bet] = await db.select().from(bets).where(eq(bets.id, betId));
    expect(bet.status).toBe('WON');
    expect(bet.settlementAttempts).toBe(2);

    const keys = (
      await db
        .select({ key: ledgerEntries.idempotencyKey, currency: ledgerEntries.currency })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.betId, betId))
    ).map((r) => `${r.key}|${r.currency}`);

    expect(keys).toContain(`bet:${betId}:placed|CREDITS`);
    expect(keys).toContain(`bet:${betId}:settled:2|CREDITS`);
    // The first attempt paid nothing (the bet lost), so there is no reversal to write.
    expect(keys).not.toContain(`bet:${betId}:reversal:2|CREDITS`);
  });

  it('reverses a payout that was made in error', async () => {
    const { bettor, adminUser, creator, event } = await seedResolvedWrong();

    // Correct the call so the bettor is paid, then correct it back. The second correction
    // is the one under test: it must reverse a payout that has already landed.
    await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: adminUser.id,
      actorMembershipId: creator.membership.id,
      isAdmin: true,
      note: 'first correction',
      winners: event.marketSelections.map((m) => ({
        marketId: m.marketId,
        winningSelectionId: m.selectionIds[1],
      })),
    });
    expect(await credits(bettor.membership.id)).toBe(110_000n);

    await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: adminUser.id,
      actorMembershipId: creator.membership.id,
      isAdmin: true,
      note: 'second correction, the forfeit was overturned',
      winners: event.marketSelections.map((m) => ({
        marketId: m.marketId,
        winningSelectionId: m.selectionIds[0],
      })),
    });

    // Back to the losing state: the 20,000 paid on attempt 2 is reversed and nothing is paid.
    expect(await credits(bettor.membership.id)).toBe(90_000n);
  });

  it('stamps open disputes resolved when the admin re-resolves', async () => {
    const { bettor, adminUser, creator, event } = await seedResolvedWrong();

    await disputeResolution({
      eventId: event.eventId,
      membershipId: bettor.membership.id,
      reason: 'wrong',
    });

    await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: adminUser.id,
      actorMembershipId: creator.membership.id,
      isAdmin: true,
      note: 'corrected',
      winners: event.marketSelections.map((m) => ({
        marketId: m.marketId,
        winningSelectionId: m.selectionIds[1],
      })),
    });

    const [row] = await db
      .select()
      .from(customEventDisputes)
      .where(eq(customEventDisputes.eventId, event.eventId));
    expect(row.resolvedAt).not.toBeNull();
  });

  it('posts the correction card flagged as one', async () => {
    const { adminUser, creator, event } = await seedResolvedWrong();

    await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: adminUser.id,
      actorMembershipId: creator.membership.id,
      isAdmin: true,
      note: 'corrected',
      winners: event.marketSelections.map((m) => ({
        marketId: m.marketId,
        winningSelectionId: m.selectionIds[1],
      })),
    });

    const cards = await db
      .select()
      .from(feedEvents)
      .where(eq(feedEvents.type, 'CUSTOM_EVENT_RESOLVED'));

    expect(cards).toHaveLength(2);
    const correction = cards.find((c) => c.dedupeKey.endsWith(':resolved:2'))!;
    expect(correction.payload).toMatchObject({ correction: true, attempt: 2 });
  });
});
