import { beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedEvents, games } from '@/db/schema';
import { placeBet } from '@/server/bets/place';
import { resettleBet } from '@/server/bets/resettle';
import { settleGame } from '@/server/bets/settle';
import type { BetSettledPayload } from '@/server/feed/payload';
import { resetDb } from '@/test/db';
import { makeMembership, makeUser, seedBettableGame } from '@/server/bets/__tests__/helpers';

describe('resettleBet feed emission', () => {
  beforeEach(resetDb);

  it('posts a second card flagged as a correction and leaves the first intact', async () => {
    const { user } = await makeMembership();
    const admin = await makeUser({ role: 'ADMIN' });
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

    // Settle on a wrong score: home loses.
    await db.update(games).set({ status: 'FINAL', homeScore: 17, awayScore: 24 }).where(eq(games.id, game.game.id));
    await settleGame(game.game.id);

    const [first] = await db.select().from(feedEvents).where(eq(feedEvents.type, 'BET_SETTLED'));
    expect((first.payload as BetSettledPayload).outcome).toBe('LOST');

    // The score was wrong: home actually won.
    await db.update(games).set({ homeScore: 27, awayScore: 20 }).where(eq(games.id, game.game.id));
    const result = await resettleBet({
      betId: placed.bet.id,
      actorUserId: admin.id,
      note: 'official score corrected',
    });
    expect(result.ok).toBe(true);

    const cards = await db
      .select()
      .from(feedEvents)
      .where(eq(feedEvents.type, 'BET_SETTLED'))
      .orderBy(asc(feedEvents.createdAt));

    expect(cards).toHaveLength(2);

    // The original is untouched — history is never edited (D15).
    expect(cards[0].id).toBe(first.id);
    expect((cards[0].payload as BetSettledPayload).outcome).toBe('LOST');
    expect((cards[0].payload as BetSettledPayload).correction).toBe(false);

    const corrected = cards[1].payload as BetSettledPayload;
    expect(corrected.outcome).toBe('WON');
    expect(corrected.correction).toBe(true);
    expect(corrected.settlementAttempt).toBe(2);
    expect(cards[1].dedupeKey).toBe(`bet:${placed.bet.id}:settled:2`);
  });

  it('posts no BET_SETTLED or milestone card when a re-grade lands back on PENDING', async () => {
    const { user } = await makeMembership();
    const admin = await makeUser({ role: 'ADMIN' });
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

    await db.update(games).set({ status: 'FINAL', homeScore: 27, awayScore: 20 }).where(eq(games.id, game.game.id));
    await settleGame(game.game.id);

    const firstCards = await db.select().from(feedEvents).where(eq(feedEvents.type, 'BET_SETTLED'));
    expect(firstCards).toHaveLength(1);

    // The game's status gets reverted (e.g. a scoring error under review) — no longer FINAL,
    // so the leg can no longer be graded and the bet re-grades back to PENDING.
    await db.update(games).set({ status: 'IN_PROGRESS' }).where(eq(games.id, game.game.id));

    const result = await resettleBet({
      betId: placed.bet.id,
      actorUserId: admin.id,
      note: 'score under review, reverting to in-progress',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newStatus).toBe('PENDING');

    const settledCards = await db.select().from(feedEvents).where(eq(feedEvents.type, 'BET_SETTLED'));
    expect(settledCards).toHaveLength(1);
    expect(settledCards[0].id).toBe(firstCards[0].id);

    const milestones = await db
      .select()
      .from(feedEvents)
      .where(eq(feedEvents.type, 'MILESTONE_BIG_WIN'));
    expect(milestones).toHaveLength(0);

    const parlayHits = await db
      .select()
      .from(feedEvents)
      .where(eq(feedEvents.type, 'MILESTONE_PARLAY_HIT'));
    expect(parlayHits).toHaveLength(0);
  });
});
