import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/db/client';
import { bets, customEvents, feedEvents, ledgerEntries, markets, seasonMemberships } from '@/db/schema';
import { placeBet } from '@/server/bets/place';
import { resolveCustomEvent } from '@/server/events/resolve';
import { postEntry } from '@/server/money/ledger';
import { resetDb } from '@/test/db';
import { makeCustomEvent } from '@/test/factories';
import { makeMembership } from '@/server/bets/__tests__/helpers';

async function seed() {
  const creator = await makeMembership(1_000_000n);
  const bettor = await makeMembership(1_000_000n, creator.seasonId);

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

  return { creator, bettor, event };
}

async function credits(membershipId: string) {
  const [row] = await db
    .select({ credits: seasonMemberships.creditsBalanceCents })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, membershipId));
  return row.credits;
}

function allWinners(event: Awaited<ReturnType<typeof makeCustomEvent>>, index = 0) {
  return event.marketSelections.map((m) => ({
    marketId: m.marketId,
    winningSelectionId: m.selectionIds[index],
  }));
}

describe('resolveCustomEvent', () => {
  beforeEach(resetDb);

  it('pays the winner in credits and marks the event resolved', async () => {
    const { creator, bettor, event } = await seed();

    const placed = await placeBet({
      userId: bettor.user.id,
      type: 'SINGLE',
      stakeCents: 10_000n,
      clientRequestId: randomUUID(),
      legs: [
        { selectionId: event.marketSelections[0].selectionIds[0], line: null, priceAmerican: 100 },
      ],
    });
    if (!placed.ok) throw new Error('expected placement to succeed');

    const result = await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: creator.user.id,
      actorMembershipId: creator.membership.id,
      isAdmin: false,
      winners: allWinners(event, 0),
    });

    expect(result).toMatchObject({ ok: true, attempt: 1, betsSettled: 1 });

    // Even money: 10,000 staked comes back as 20,000. Started 100,000, staked 10,000.
    expect(await credits(bettor.membership.id)).toBe(110_000n);

    const [bet] = await db.select().from(bets).where(eq(bets.id, placed.bet.id));
    expect(bet.status).toBe('WON');

    const [custom] = await db
      .select()
      .from(customEvents)
      .where(eq(customEvents.eventId, event.eventId));
    expect(custom.status).toBe('RESOLVED');
    expect(custom.resolutionAttempts).toBe(1);

    const [entry] = await db
      .select()
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.betId, placed.bet.id), eq(ledgerEntries.type, 'BET_WON')));
    expect(entry.currency).toBe('CREDITS');
    expect(entry.idempotencyKey).toBe(`bet:${placed.bet.id}:settled:1`);
  });

  it('grades a loser LOST and pays nothing', async () => {
    const { creator, bettor, event } = await seed();

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

    await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: creator.user.id,
      actorMembershipId: creator.membership.id,
      isAdmin: false,
      winners: allWinners(event, 0),
    });

    expect(await credits(bettor.membership.id)).toBe(90_000n);
    const [bet] = await db.select().from(bets).where(eq(bets.id, placed.bet.id));
    expect(bet.status).toBe('LOST');
  });

  it('records the winning selection on every market', async () => {
    const { creator, event } = await seed();

    await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: creator.user.id,
      actorMembershipId: creator.membership.id,
      isAdmin: false,
      winners: allWinners(event, 1),
    });

    const rows = await db.select().from(markets).where(eq(markets.eventId, event.eventId));
    expect(rows.every((m) => m.status === 'SETTLED')).toBe(true);
    for (const m of event.marketSelections) {
      const row = rows.find((r) => r.id === m.marketId)!;
      expect(row.winningSelectionId).toBe(m.selectionIds[1]);
    }
  });

  it('is idempotent: replaying the same resolution writes nothing new', async () => {
    const { creator, bettor, event } = await seed();

    await placeBet({
      userId: bettor.user.id,
      type: 'SINGLE',
      stakeCents: 10_000n,
      clientRequestId: randomUUID(),
      legs: [
        { selectionId: event.marketSelections[0].selectionIds[0], line: null, priceAmerican: 100 },
      ],
    });

    await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: creator.user.id,
      actorMembershipId: creator.membership.id,
      isAdmin: false,
      winners: allWinners(event, 0),
    });

    const ledgerBefore = await db.select().from(ledgerEntries);
    const feedBefore = await db.select().from(feedEvents);

    const second = await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: creator.user.id,
      actorMembershipId: creator.membership.id,
      isAdmin: false,
      winners: allWinners(event, 0),
    });

    expect(second).toEqual({ ok: false, error: { code: 'RE_RESOLUTION_IS_ADMIN_ONLY' } });
    expect(await db.select().from(ledgerEntries)).toHaveLength(ledgerBefore.length);
    expect(await db.select().from(feedEvents)).toHaveLength(feedBefore.length);
  });

  it('rejects a resolution that misses a market', async () => {
    const { creator, event } = await seed();

    const result = await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: creator.user.id,
      actorMembershipId: creator.membership.id,
      isAdmin: false,
      winners: [allWinners(event, 0)[0]],
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'INCOMPLETE_RESOLUTION' } });

    const [custom] = await db
      .select()
      .from(customEvents)
      .where(eq(customEvents.eventId, event.eventId));
    expect(custom.status).toBe('OPEN');
  });

  it('rejects a winning selection that belongs to another market', async () => {
    const { creator, event } = await seed();

    const result = await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: creator.user.id,
      actorMembershipId: creator.membership.id,
      isAdmin: false,
      winners: [
        {
          marketId: event.marketSelections[0].marketId,
          winningSelectionId: event.marketSelections[1].selectionIds[0],
        },
        {
          marketId: event.marketSelections[1].marketId,
          winningSelectionId: event.marketSelections[1].selectionIds[0],
        },
      ],
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'SELECTION_NOT_IN_MARKET' } });
  });

  it('rejects a member who is neither the creator nor an admin', async () => {
    const { bettor, event } = await seed();

    const result = await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: bettor.user.id,
      actorMembershipId: bettor.membership.id,
      isAdmin: false,
      winners: allWinners(event, 0),
    });

    expect(result).toEqual({ ok: false, error: { code: 'NOT_AUTHORIZED' } });
  });

  it('posts one CUSTOM_EVENT_RESOLVED card naming each winner', async () => {
    const { creator, event } = await seed();

    await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: creator.user.id,
      actorMembershipId: creator.membership.id,
      isAdmin: false,
      winners: allWinners(event, 0),
    });

    const [card] = await db
      .select()
      .from(feedEvents)
      .where(eq(feedEvents.type, 'CUSTOM_EVENT_RESOLVED'));

    expect(card.dedupeKey).toBe(`customevent:${event.eventId}:resolved:1`);
    expect(card.payload).toMatchObject({
      title: 'Test Cup',
      correction: false,
      attempt: 1,
      outcomes: [
        { marketTitle: 'Who wins the cup?', winningLabel: 'Falcons' },
        { marketTitle: 'Who wins map 1?', winningLabel: 'Falcons' },
      ],
    });
  });
});
