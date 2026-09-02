import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { betLegs, bets, games, ledgerEntries, markets, seasonMemberships } from '@/db/schema';
import { placeBet } from '@/server/bets/place';
import { settleGame } from '@/server/bets/settle';
import type { PlaceBetInput } from '@/server/bets/types';
import { resetDb } from '@/test/db';
import { makeMembership, seedBettableGame, type BettableGame } from './helpers';

async function balanceOf(membershipId: string): Promise<bigint> {
  const [row] = await db
    .select({ balanceCents: seasonMemberships.balanceCents })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, membershipId));
  return row.balanceCents;
}

async function setStatus(gameId: string, status: 'POSTPONED' | 'CANCELED' | 'SCHEDULED') {
  await db.update(games).set({ status }).where(eq(games.id, gameId));
}

async function finalize(gameId: string, homeScore: number, awayScore: number) {
  await db.update(games).set({ status: 'FINAL', homeScore, awayScore }).where(eq(games.id, gameId));
}

async function place(input: PlaceBetInput): Promise<string> {
  const result = await placeBet(input);
  if (!result.ok) throw new Error(`placement failed: ${result.error.code}`);
  return result.bet.id;
}

function single(userId: string, selectionId: string): PlaceBetInput {
  return {
    userId,
    type: 'SINGLE',
    stakeCents: 10_000n,
    legs: [{ selectionId, line: null, priceAmerican: -110 }],
    clientRequestId: randomUUID(),
  };
}

function parlay(userId: string, selectionIds: string[]): PlaceBetInput {
  return {
    userId,
    type: 'PARLAY',
    stakeCents: 10_000n,
    legs: selectionIds.map((selectionId) => ({ selectionId, line: null, priceAmerican: -110 })),
    clientRequestId: randomUUID(),
  };
}

async function betRow(betId: string) {
  const [row] = await db.select().from(bets).where(eq(bets.id, betId));
  return row;
}

async function entriesFor(betId: string) {
  return db.select().from(ledgerEntries).where(eq(ledgerEntries.betId, betId));
}

describe('voiding a game', () => {
  let seeded: BettableGame;

  beforeEach(async () => {
    await resetDb();
    seeded = await seedBettableGame();
  });

  it.each(['POSTPONED', 'CANCELED'] as const)(
    'refunds a single in full when %s',
    async (status) => {
      const { membership, user } = await makeMembership(1_000_000n);
      const betId = await place(single(user.id, seeded.moneyline.home));
      expect(await balanceOf(membership.id)).toBe(990_000n);

      await setStatus(seeded.game.id, status);
      const summary = await settleGame(seeded.game.id);

      expect(summary.centsPaid).toBe(10_000n);
      expect((await betRow(betId)).status).toBe('VOIDED');

      const [leg] = await db.select().from(betLegs).where(eq(betLegs.betId, betId));
      expect(leg.status).toBe('VOIDED');

      const voided = (await entriesFor(betId)).filter((e) => e.type === 'BET_VOIDED');
      expect(voided).toHaveLength(1);
      expect(voided[0].amountCents).toBe(10_000n);
      expect(await balanceOf(membership.id)).toBe(1_000_000n);
    },
  );

  it('drops a voided leg and pays the parlay at the reduced odds', async () => {
    const { user } = await makeMembership(1_000_000n);
    const other = await seedBettableGame();

    const betId = await place(parlay(user.id, [seeded.moneyline.home, other.moneyline.home]));
    const quoted = (await betRow(betId)).potentialPayoutCents;
    expect(quoted).toBe(36_446n);

    await setStatus(seeded.game.id, 'POSTPONED');
    await settleGame(seeded.game.id);
    expect((await betRow(betId)).status).toBe('PENDING');

    await finalize(other.game.id, 27, 20);
    await settleGame(other.game.id);

    expect((await betRow(betId)).status).toBe('WON');
    const won = (await entriesFor(betId)).filter((e) => e.type === 'BET_WON');
    // Pays as the surviving single leg, exactly as a push would.
    expect(won[0].amountCents).toBe(19_091n);
    expect(won[0].amountCents).toBeLessThan(quoted);
  });

  it('refunds the stake and marks the bet PUSHED when every leg voided', async () => {
    const { membership, user } = await makeMembership(1_000_000n);
    const other = await seedBettableGame();

    const betId = await place(parlay(user.id, [seeded.moneyline.home, other.moneyline.home]));

    await setStatus(seeded.game.id, 'CANCELED');
    await settleGame(seeded.game.id);
    await setStatus(other.game.id, 'CANCELED');
    await settleGame(other.game.id);

    expect((await betRow(betId)).status).toBe('PUSHED');
    const pushed = (await entriesFor(betId)).filter((e) => e.type === 'BET_PUSHED');
    expect(pushed).toHaveLength(1);
    expect(pushed[0].amountCents).toBe(10_000n);
    expect(await balanceOf(membership.id)).toBe(1_000_000n);
  });

  it('marks markets SETTLED on a voided game', async () => {
    await setStatus(seeded.game.id, 'POSTPONED');
    await settleGame(seeded.game.id);

    const rows = await db.select().from(markets).where(eq(markets.eventId, seeded.game.eventId));
    expect(rows.every((m) => m.status === 'SETTLED')).toBe(true);
  });

  it('does not un-void a bet when a postponed game is rescheduled', async () => {
    const { membership, user } = await makeMembership(1_000_000n);
    const betId = await place(single(user.id, seeded.moneyline.home));

    await setStatus(seeded.game.id, 'POSTPONED');
    await settleGame(seeded.game.id);
    const balanceAfterVoid = await balanceOf(membership.id);

    // Rescheduled and played. Voided is terminal — the member re-bets if they want to.
    await finalize(seeded.game.id, 27, 20);
    const summary = await settleGame(seeded.game.id);

    expect(summary.betsSettled).toBe(0);
    expect(summary.legsGraded).toBe(0);
    expect((await betRow(betId)).status).toBe('VOIDED');
    expect(await balanceOf(membership.id)).toBe(balanceAfterVoid);
  });
});
