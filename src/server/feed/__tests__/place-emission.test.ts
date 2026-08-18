import { beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedEvents } from '@/db/schema';
import { placeBet } from '@/server/bets/place';
import type { BetPlacedPayload } from '@/server/feed/payload';
import { resetDb } from '@/test/db';
import { makeMembership, seedBettableGame } from '@/server/bets/__tests__/helpers';

describe('placeBet feed emission', () => {
  beforeEach(resetDb);

  it('writes one BET_PLACED event whose payload matches the frozen leg', async () => {
    const { membership, user, seasonId } = await makeMembership();
    const game = await seedBettableGame();

    const result = await placeBet({
      userId: user.id,
      type: 'SINGLE',
      stakeCents: 10_000n,
      legs: [{ selectionId: game.spread.home, line: '-3.50', priceAmerican: -110 }],
      clientRequestId: randomUUID(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const events = await db.select().from(feedEvents).where(eq(feedEvents.seasonId, seasonId));
    expect(events).toHaveLength(1);

    const event = events[0];
    expect(event.type).toBe('BET_PLACED');
    expect(event.subjectMembershipId).toBe(membership.id);
    expect(event.betId).toBe(result.bet.id);
    expect(event.dedupeKey).toBe(`bet:${result.bet.id}:placed`);

    const payload = event.payload as BetPlacedPayload;
    expect(payload.betType).toBe('SINGLE');
    expect(payload.currency).toBe('CASH');
    expect(payload.stakeCents).toBe('10000');
    expect(payload.legs).toHaveLength(1);
    const [leg] = payload.legs;
    if (leg.kind !== 'GAME') throw new Error('expected a GAME leg');
    expect(leg.line).toBe('-3.50');
    expect(leg.priceAmerican).toBe(-110);
    expect(leg.marketType).toBe('SPREAD');
    expect(leg.homeAbbr).toEqual(expect.any(String));
  });

  it('writes one event per leg of a parlay inside a single payload', async () => {
    const { user } = await makeMembership();
    const first = await seedBettableGame();
    const second = await seedBettableGame();

    const result = await placeBet({
      userId: user.id,
      type: 'PARLAY',
      stakeCents: 5_000n,
      legs: [
        { selectionId: first.moneyline.home, line: null, priceAmerican: -110 },
        { selectionId: second.total.over, line: '44.50', priceAmerican: -110 },
      ],
      clientRequestId: randomUUID(),
    });

    expect(result.ok).toBe(true);

    const events = await db.select().from(feedEvents);
    expect(events).toHaveLength(1);
    expect((events[0].payload as BetPlacedPayload).legs).toHaveLength(2);
  });

  it('writes no event when placement is rejected', async () => {
    const { user } = await makeMembership(500n);
    const game = await seedBettableGame();

    const result = await placeBet({
      userId: user.id,
      type: 'SINGLE',
      stakeCents: 100_000n, // more than the balance
      legs: [{ selectionId: game.moneyline.home, line: null, priceAmerican: -110 }],
      clientRequestId: randomUUID(),
    });

    expect(result.ok).toBe(false);
    expect(await db.select().from(feedEvents)).toHaveLength(0);
  });
});
