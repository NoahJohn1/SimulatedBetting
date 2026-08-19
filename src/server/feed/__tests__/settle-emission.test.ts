import { beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedEvents, games } from '@/db/schema';
import { placeBet } from '@/server/bets/place';
import { settleFinalGames, settleGame } from '@/server/bets/settle';
import type { BetSettledPayload, BigWinPayload } from '@/server/feed/payload';
import { resetDb } from '@/test/db';
import { makeMembership, seedBettableGame } from '@/server/bets/__tests__/helpers';

async function finalize(gameId: string, homeScore: number, awayScore: number) {
  await db.update(games).set({ status: 'FINAL', homeScore, awayScore }).where(eq(games.id, gameId));
}

describe('settleGame feed emission', () => {
  beforeEach(resetDb);

  it('posts a BET_SETTLED card carrying the outcome and payout', async () => {
    const { user } = await makeMembership();
    const game = await seedBettableGame();

    const placed = await placeBet({
      userId: user.id,
      type: 'SINGLE',
      stakeCents: 10_000n,
      legs: [{ selectionId: game.moneyline.home, line: null, priceAmerican: -110 }],
      clientRequestId: randomUUID(),
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    await finalize(game.game.id, 27, 20);
    await settleGame(game.game.id);

    const settled = await db
      .select()
      .from(feedEvents)
      .where(eq(feedEvents.type, 'BET_SETTLED'));

    expect(settled).toHaveLength(1);
    expect(settled[0].dedupeKey).toBe(`bet:${placed.bet.id}:settled:1`);

    const payload = settled[0].payload as BetSettledPayload;
    expect(payload.outcome).toBe('WON');
    expect(payload.payoutCents).toBe('19091');
    expect(payload.netCents).toBe('9091');
    expect(payload.legOutcomes).toEqual(['WON']);
    expect(payload.correction).toBe(false);
    expect(payload.settlementAttempt).toBe(1);
  });

  it('records a loss with a zero payout and a negative net', async () => {
    const { user } = await makeMembership();
    const game = await seedBettableGame();

    await placeBet({
      userId: user.id,
      type: 'SINGLE',
      stakeCents: 10_000n,
      legs: [{ selectionId: game.moneyline.home, line: null, priceAmerican: -110 }],
      clientRequestId: randomUUID(),
    });

    await finalize(game.game.id, 17, 24);
    await settleGame(game.game.id);

    const [event] = await db.select().from(feedEvents).where(eq(feedEvents.type, 'BET_SETTLED'));
    const payload = event.payload as BetSettledPayload;
    expect(payload.outcome).toBe('LOST');
    expect(payload.payoutCents).toBe('0');
    expect(payload.netCents).toBe('-10000');
  });

  it('posts a big-win milestone alongside the settlement when the payout clears 10x', async () => {
    const { user } = await makeMembership();
    const game = await seedBettableGame();
    // +1200 on $100 returns $1,300 — thirteen times the stake.
    await db.update(games).set({ status: 'SCHEDULED' }).where(eq(games.id, game.game.id));
    const { setSelectionPrice } = await import('@/server/bets/__tests__/helpers');
    await setSelectionPrice(game.moneyline.home, 1200);

    await placeBet({
      userId: user.id,
      type: 'SINGLE',
      stakeCents: 10_000n,
      legs: [{ selectionId: game.moneyline.home, line: null, priceAmerican: 1200 }],
      clientRequestId: randomUUID(),
    });

    await finalize(game.game.id, 30, 3);
    await settleGame(game.game.id);

    const [milestone] = await db
      .select()
      .from(feedEvents)
      .where(eq(feedEvents.type, 'MILESTONE_BIG_WIN'));

    expect(milestone).toBeDefined();
    const payload = milestone.payload as BigWinPayload;
    expect(payload.payoutCents).toBe('130000');
    expect(payload.multipleBasisPoints).toBe(130_000);
    expect(payload.currency).toBe('CASH');
  });

  it('posts no milestone on an ordinary win', async () => {
    const { user } = await makeMembership();
    const game = await seedBettableGame();

    await placeBet({
      userId: user.id,
      type: 'SINGLE',
      stakeCents: 10_000n,
      legs: [{ selectionId: game.moneyline.home, line: null, priceAmerican: -110 }],
      clientRequestId: randomUUID(),
    });

    await finalize(game.game.id, 27, 20);
    await settleGame(game.game.id);

    const milestones = await db
      .select()
      .from(feedEvents)
      .where(eq(feedEvents.type, 'MILESTONE_BIG_WIN'));
    expect(milestones).toHaveLength(0);
  });

  it('is idempotent: a second sweep adds no events', async () => {
    const { user } = await makeMembership();
    const game = await seedBettableGame();

    await placeBet({
      userId: user.id,
      type: 'SINGLE',
      stakeCents: 10_000n,
      legs: [{ selectionId: game.moneyline.home, line: null, priceAmerican: -110 }],
      clientRequestId: randomUUID(),
    });

    await finalize(game.game.id, 27, 20);

    await settleFinalGames();
    const afterFirst = await db.select().from(feedEvents).orderBy(asc(feedEvents.id));

    await settleFinalGames();
    const afterSecond = await db.select().from(feedEvents).orderBy(asc(feedEvents.id));

    expect(afterSecond).toEqual(afterFirst);
  });
});
