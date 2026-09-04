import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { games, notifications } from '@/db/schema';
import { placeBet } from '@/server/bets/place';
import { resettleBet } from '@/server/bets/resettle';
import { settleGame } from '@/server/bets/settle';
import type { PlaceBetInput } from '@/server/bets/types';
import { resetDb } from '@/test/db';
import { makeMembership, makeUser, seedBettableGame, type BettableGame } from './helpers';

// Copy the exact shapes settle.test.ts uses.
async function finalize(gameId: string, homeScore: number, awayScore: number): Promise<void> {
  await db.update(games).set({ status: 'FINAL', homeScore, awayScore }).where(eq(games.id, gameId));
}

async function place(input: PlaceBetInput): Promise<string> {
  const result = await placeBet(input);
  if (!result.ok) throw new Error(`placement failed: ${result.error.code}`);
  return result.bet.id;
}

function single(userId: string, selectionId: string, line: string | null): PlaceBetInput {
  return {
    userId,
    type: 'SINGLE',
    stakeCents: 10_000n,
    legs: [{ selectionId, line, priceAmerican: -110 }],
    clientRequestId: randomUUID(),
  };
}

beforeEach(resetDb);

describe('BETS_SETTLED', () => {
  it('queues one digest row per settled bet, addressed to its owner', async () => {
    const { user } = await makeMembership();
    const game: BettableGame = await seedBettableGame();
    const betId = await place(single(user.id, game.spread.home, '-3.5'));

    await finalize(game.game.id, 30, 20);
    await settleGame(game.game.id);

    const rows = await db.select().from(notifications);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('BETS_SETTLED');
    expect(rows[0].channel).toBe('DIGEST');
    expect(rows[0].userId).toBe(user.id);
    expect(rows[0].dedupeKey).toBe(`bet:${betId}:settled:1:${user.id}`);
  });

  it('queues nothing extra on a second settle run — this is the whole point', async () => {
    const { user } = await makeMembership();
    const game = await seedBettableGame();
    await place(single(user.id, game.spread.home, '-3.5'));

    await finalize(game.game.id, 30, 20);
    await settleGame(game.game.id);
    await settleGame(game.game.id);

    expect(await db.select().from(notifications)).toHaveLength(1);
  });

  it('queues a SECOND row after an admin correction, because the attempt changed', async () => {
    const { user } = await makeMembership();
    const admin = await makeUser({ role: 'ADMIN' });
    const game = await seedBettableGame();
    const betId = await place(single(user.id, game.spread.home, '-3.5'));

    await finalize(game.game.id, 30, 20);
    await settleGame(game.game.id);

    // Correct the score and re-settle, the way resettle.test.ts does.
    await db.update(games).set({ homeScore: 10, awayScore: 40 }).where(eq(games.id, game.game.id));
    const result = await resettleBet({
      betId,
      actorUserId: admin.id,
      note: 'scores were wrong',
    });
    expect(result.ok).toBe(true);

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.type, 'BETS_SETTLED'));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.dedupeKey).sort()).toEqual(
      [`bet:${betId}:settled:1:${user.id}`, `bet:${betId}:settled:2:${user.id}`].sort(),
    );
  });
});
