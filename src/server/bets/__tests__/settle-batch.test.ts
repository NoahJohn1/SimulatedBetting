import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { betLegs, bets, games, ledgerEntries, seasonMemberships } from '@/db/schema';
import { placeBet } from '@/server/bets/place';
import { settleFinalGames } from '@/server/bets/settle';
import { resetDb } from '@/test/db';
import { makeMembership, seedBettableGame } from './helpers';

async function balanceOf(membershipId: string): Promise<bigint> {
  const [row] = await db
    .select({ balanceCents: seasonMemberships.balanceCents })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, membershipId));
  return row.balanceCents;
}

/** A game with a bet on it, kicked off `hoursAgo` in the past, already FINAL with a home win. */
async function settleableGame(userId: string, hoursAgo: number) {
  const startsAt = new Date(Date.now() - hoursAgo * 3_600_000);
  const seeded = await seedBettableGame({ startsAt: new Date(Date.now() + 86_400_000) });

  const placed = await placeBet({
    userId,
    type: 'SINGLE',
    stakeCents: 10_000n,
    legs: [{ selectionId: seeded.moneyline.home, line: null, priceAmerican: -110 }],
    clientRequestId: randomUUID(),
  });
  if (!placed.ok) throw new Error(`placement failed: ${placed.error.code}`);

  await db
    .update(games)
    .set({ status: 'FINAL', homeScore: 27, awayScore: 20, startsAt })
    .where(eq(games.id, seeded.game.id));

  return { gameId: seeded.game.id, betId: placed.bet.id, startsAt };
}

describe('settleFinalGames', () => {
  beforeEach(resetDb);

  it('settles in maxGames batches and resumes with no checkpoint state', async () => {
    const { user } = await makeMembership(1_000_000n);
    for (let i = 5; i >= 1; i--) await settleableGame(user.id, i);

    const first = await settleFinalGames({ maxGames: 2 });
    expect(first.gamesSettled).toBe(2);
    expect(first.remaining).toBe(3);
    expect(first.exhausted).toBe('maxGames');

    const second = await settleFinalGames({ maxGames: 2 });
    expect(second.gamesSettled).toBe(2);
    expect(second.remaining).toBe(1);
    expect(second.exhausted).toBe('maxGames');

    const third = await settleFinalGames({ maxGames: 2 });
    expect(third.gamesSettled).toBe(1);
    expect(third.remaining).toBe(0);
    expect(third.exhausted).toBe('none');

    expect((await db.select().from(bets)).every((b) => b.status === 'WON')).toBe(true);
  });

  it('processes games oldest kickoff first', async () => {
    const { user } = await makeMembership(1_000_000n);
    const oldest = await settleableGame(user.id, 10);
    await settleableGame(user.id, 5);
    await settleableGame(user.id, 1);

    await settleFinalGames({ maxGames: 1 });

    const [settled] = await db.select().from(bets).where(eq(bets.id, oldest.betId));
    expect(settled.status).toBe('WON');
  });

  it('stops cleanly when the injected clock passes the budget', async () => {
    const { user } = await makeMembership(1_000_000n);
    await settleableGame(user.id, 3);
    const untouched = await settleableGame(user.id, 2);

    // First call establishes the start time, second is checked before game one, third
    // jumps past the budget so game two is never started.
    let calls = 0;
    const now = () => {
      calls += 1;
      return calls >= 3 ? 100_000 : 0;
    };

    const summary = await settleFinalGames({ budgetMs: 45_000, now });

    expect(summary.exhausted).toBe('budget');
    expect(summary.gamesSettled).toBe(1);

    const [stillPending] = await db.select().from(bets).where(eq(bets.id, untouched.betId));
    expect(stillPending.status).toBe('PENDING');
  });

  it('records a failing game in errors and keeps settling the rest', async () => {
    const { user } = await makeMembership(1_000_000n);
    const broken = await settleableGame(user.id, 9);
    const healthy = await settleableGame(user.id, 1);

    // FINAL with no score is exactly the malformed-fixture case: settleGame throws.
    await db
      .update(games)
      .set({ homeScore: null, awayScore: null })
      .where(eq(games.id, broken.gameId));

    const summary = await settleFinalGames();

    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0].gameId).toBe(broken.gameId);
    expect(summary.gamesSettled).toBe(1);

    const [ok] = await db.select().from(bets).where(eq(bets.id, healthy.betId));
    expect(ok.status).toBe('WON');

    // The failed game's own transaction rolled back entirely.
    const [untouched] = await db.select().from(bets).where(eq(bets.id, broken.betId));
    expect(untouched.status).toBe('PENDING');
    const legs = await db.select().from(betLegs).where(eq(betLegs.betId, broken.betId));
    expect(legs.every((l) => l.status === 'PENDING')).toBe(true);
  });

  it('pays nobody twice when the whole run repeats', async () => {
    const { membership, user } = await makeMembership(1_000_000n);
    await settleableGame(user.id, 3);
    await settleableGame(user.id, 2);

    const first = await settleFinalGames();
    const balanceAfterFirst = await balanceOf(membership.id);
    const entriesAfterFirst = (await db.select().from(ledgerEntries)).length;

    const second = await settleFinalGames();

    expect(first.centsPaid).toBe(38_182n);
    expect(second.gamesSettled).toBe(0);
    expect(second.centsPaid).toBe(0n);
    expect(await balanceOf(membership.id)).toBe(balanceAfterFirst);
    expect((await db.select().from(ledgerEntries)).length).toBe(entriesAfterFirst);
  });
});
