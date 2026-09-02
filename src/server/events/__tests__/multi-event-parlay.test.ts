/**
 * A credits parlay whose legs live on two different custom events.
 *
 * The DUPLICATE_EVENT rule only bans two legs on the *same* event, so this shape is legal —
 * and it is the one case where a correction or a void lands on a bet that is still PENDING
 * overall, because its other leg has not resolved yet. Nothing has been paid on such a bet,
 * so `resettleBetInTx` correctly refuses it; the leg's stored grade still has to be brought
 * up to date, or the eventual settlement grades against a superseded result.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/db/client';
import { betLegs, bets, seasonMemberships, selections } from '@/db/schema';
import { placeBet } from '@/server/bets/place';
import { disputeResolution } from '@/server/events/dispute';
import { resolveCustomEvent, voidCustomEvent } from '@/server/events/resolve';
import { postEntry } from '@/server/money/ledger';
import { reconcileBalances } from '@/server/money/reconcile';
import { resetDb } from '@/test/db';
import { makeCustomEvent, type MadeCustomEvent } from '@/test/factories';
import { makeMembership, makeUser } from '@/server/bets/__tests__/helpers';

/** Every market of the event resolved to the outcome at `index` (0 = Falcons, 1 = Ravens). */
function winners(event: MadeCustomEvent, index: number) {
  return event.marketSelections.map((m) => ({
    marketId: m.marketId,
    winningSelectionId: m.selectionIds[index],
  }));
}

async function credits(membershipId: string) {
  const [row] = await db
    .select({ credits: seasonMemberships.creditsBalanceCents })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, membershipId));
  return row.credits;
}

/** The status of this bet's single leg on the given event. */
async function legStatusOn(betId: string, event: MadeCustomEvent) {
  const rows = await db
    .select({ status: betLegs.status })
    .from(betLegs)
    .innerJoin(selections, eq(betLegs.selectionId, selections.id))
    .where(
      and(
        eq(betLegs.betId, betId),
        inArray(
          selections.marketId,
          event.marketSelections.map((m) => m.marketId),
        ),
      ),
    );
  expect(rows).toHaveLength(1);
  return rows[0].status;
}

async function seedTwoEventParlay() {
  // Cash balances start at zero and are never touched, so `reconcileBalances` has nothing to
  // complain about on the cash side of a credits-only story.
  const creator = await makeMembership(0n);
  const bettor = await makeMembership(0n, creator.seasonId);
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

  const eventA = await makeCustomEvent({
    creatorMembershipId: creator.membership.id,
    seasonId: creator.seasonId,
  });
  const eventB = await makeCustomEvent({
    creatorMembershipId: creator.membership.id,
    seasonId: creator.seasonId,
  });

  // Falcons in each event's cup market. Both legs are even money, so the two-leg parlay pays
  // 4× and a lone surviving leg pays 2×.
  const placed = await placeBet({
    userId: bettor.user.id,
    type: 'PARLAY',
    stakeCents: 10_000n,
    clientRequestId: randomUUID(),
    legs: [
      { selectionId: eventA.marketSelections[0].selectionIds[0], line: null, priceAmerican: 100 },
      { selectionId: eventB.marketSelections[0].selectionIds[0], line: null, priceAmerican: 100 },
    ],
  });
  if (!placed.ok) throw new Error(`expected placement to succeed, got ${placed.error.code}`);
  expect(placed.bet.potentialPayoutCents).toBe(40_000n);

  return { creator, bettor, adminUser, eventA, eventB, betId: placed.bet.id };
}

describe('a parlay spanning two custom events', () => {
  beforeEach(resetDb);

  it('re-grades a still-pending leg when its event is corrected', async () => {
    const { creator, bettor, adminUser, eventA, eventB, betId } = await seedTwoEventParlay();

    expect(await credits(bettor.membership.id)).toBe(90_000n);

    // 1. Event A resolves for Falcons. The leg on A wins, but the parlay is still pending on
    //    its B leg, so nothing is paid and the bet stays PENDING.
    const first = await resolveCustomEvent({
      eventId: eventA.eventId,
      actorUserId: creator.user.id,
      actorMembershipId: creator.membership.id,
      isAdmin: false,
      winners: winners(eventA, 0),
    });
    expect(first).toMatchObject({ ok: true, attempt: 1, betsSettled: 0, creditsPaid: 0n });

    expect(await legStatusOn(betId, eventA)).toBe('WON');
    const [afterFirst] = await db.select().from(bets).where(eq(bets.id, betId));
    expect(afterFirst.status).toBe('PENDING');
    expect(await credits(bettor.membership.id)).toBe(90_000n);

    // 2. The bettor disputes and an admin overturns the call to Ravens.
    const disputed = await disputeResolution({
      eventId: eventA.eventId,
      membershipId: bettor.membership.id,
      reason: 'the cup was awarded to Ravens on a forfeit',
    });
    expect(disputed).toMatchObject({ ok: true, created: true });

    const second = await resolveCustomEvent({
      eventId: eventA.eventId,
      actorUserId: adminUser.id,
      actorMembershipId: creator.membership.id,
      isAdmin: true,
      note: 'confirmed the forfeit on the tournament page',
      winners: winners(eventA, 1),
    });
    // Nothing to reverse and nothing to pay: the bet was never settled in the first place.
    expect(second).toMatchObject({ ok: true, attempt: 2, betsSettled: 0, creditsPaid: 0n });

    // 3. The proof. The leg on A carries attempt 2's grade, not attempt 1's, even though
    //    resettleBetInTx refused the bet for still being PENDING overall.
    expect(await legStatusOn(betId, eventA)).toBe('LOST');
    const [afterSecond] = await db.select().from(bets).where(eq(bets.id, betId));
    expect(afterSecond.status).toBe('PENDING');
    expect(afterSecond.settlementAttempts).toBe(0);
    expect(await credits(bettor.membership.id)).toBe(90_000n);

    // 4. Event B resolves the bettor's way, and the parlay finally settles — against the
    //    corrected grade on A. A stale WON there would have paid 40,000 credits instead.
    const third = await resolveCustomEvent({
      eventId: eventB.eventId,
      actorUserId: creator.user.id,
      actorMembershipId: creator.membership.id,
      isAdmin: false,
      winners: winners(eventB, 0),
    });
    expect(third).toMatchObject({ ok: true, attempt: 1, betsSettled: 1, creditsPaid: 0n });

    expect(await legStatusOn(betId, eventB)).toBe('WON');
    const [settled] = await db.select().from(bets).where(eq(bets.id, betId));
    expect(settled.status).toBe('LOST');
    expect(await credits(bettor.membership.id)).toBe(90_000n);

    expect(await reconcileBalances()).toEqual([]);
  });

  it('voids a still-pending leg when its resolved event is voided', async () => {
    const { creator, bettor, adminUser, eventA, eventB, betId } = await seedTwoEventParlay();

    // 1. Same start: A resolves for Falcons, the leg wins, the bet stays pending on B.
    await resolveCustomEvent({
      eventId: eventA.eventId,
      actorUserId: creator.user.id,
      actorMembershipId: creator.membership.id,
      isAdmin: false,
      winners: winners(eventA, 0),
    });
    expect(await legStatusOn(betId, eventA)).toBe('WON');

    await disputeResolution({
      eventId: eventA.eventId,
      membershipId: bettor.membership.id,
      reason: 'the cup was never actually played',
    });

    // 2. This time the admin voids A rather than re-calling it. Nothing was paid on this
    //    bet, so nothing is refunded here — the refund is the shrunken parlay below.
    const voided = await voidCustomEvent({
      eventId: eventA.eventId,
      actorUserId: adminUser.id,
      note: 'the cup was never played',
    });
    expect(voided).toMatchObject({ ok: true, refundedBets: 0, refundedCents: 0n });

    // 3. The proof: the leg on A is VOIDED even though the bet was still pending at void
    //    time, so it will drop out of the parlay (D12) rather than counting as a winner.
    expect(await legStatusOn(betId, eventA)).toBe('VOIDED');
    const [afterVoid] = await db.select().from(bets).where(eq(bets.id, betId));
    expect(afterVoid.status).toBe('PENDING');
    expect(await credits(bettor.membership.id)).toBe(90_000n);

    // 4. B resolves the bettor's way. The voided leg drops out and the 10,000 stake pays at
    //    the one surviving even-money leg: 20,000 back, not the 40,000 a two-leg parlay
    //    would have paid.
    const resolvedB = await resolveCustomEvent({
      eventId: eventB.eventId,
      actorUserId: creator.user.id,
      actorMembershipId: creator.membership.id,
      isAdmin: false,
      winners: winners(eventB, 0),
    });
    expect(resolvedB).toMatchObject({ ok: true, attempt: 1, betsSettled: 1, creditsPaid: 20_000n });

    const [settled] = await db.select().from(bets).where(eq(bets.id, betId));
    expect(settled.status).toBe('WON');
    expect(await credits(bettor.membership.id)).toBe(110_000n);

    expect(await reconcileBalances()).toEqual([]);
  });
});
