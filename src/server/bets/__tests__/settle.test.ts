import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { betLegs, bets, games, ledgerEntries, markets, seasonMemberships } from '@/db/schema';
import { placeBet } from '@/server/bets/place';
import { settleGame } from '@/server/bets/settle';
import type { PlaceBetInput } from '@/server/bets/types';
import { resetDb } from '@/test/db';
import {
  makeGame,
  makeMarket,
  makeMembership,
  makeSelection,
  seedBettableGame,
  type BettableGame,
} from './helpers';

async function balanceOf(membershipId: string): Promise<bigint> {
  const [row] = await db
    .select({ balanceCents: seasonMemberships.balanceCents })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, membershipId));
  return row.balanceCents;
}

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

function parlay(userId: string, legs: { selectionId: string; line: string | null }[]): PlaceBetInput {
  return {
    userId,
    type: 'PARLAY',
    stakeCents: 10_000n,
    legs: legs.map((l) => ({ ...l, priceAmerican: -110 })),
    clientRequestId: randomUUID(),
  };
}

/** A game whose spread sits on a whole number, so the leg can actually push. */
async function seedPushableSpread() {
  const game = await makeGame();
  const market = await makeMarket(game.id, 'SPREAD');
  const home = await makeSelection(market.id, 'HOME', -110, '-3.00');
  return { game, homeSelectionId: home.id };
}

async function betRow(betId: string) {
  const [row] = await db.select().from(bets).where(eq(bets.id, betId));
  return row;
}

async function entriesFor(betId: string) {
  return db.select().from(ledgerEntries).where(eq(ledgerEntries.betId, betId));
}

async function entryCount(): Promise<number> {
  return (await db.select().from(ledgerEntries)).length;
}

describe('settleGame', () => {
  let seeded: BettableGame;

  beforeEach(async () => {
    await resetDb();
    seeded = await seedBettableGame();
  });

  it('pays a winning single its stake plus profit', async () => {
    const { membership, user } = await makeMembership(1_000_000n);
    const betId = await place(single(user.id, seeded.moneyline.home, null));

    await finalize(seeded.game.id, 27, 20);
    const summary = await settleGame(seeded.game.id);

    expect(summary.betsSettled).toBe(1);
    expect(summary.legsGraded).toBe(1);
    expect(summary.centsPaid).toBe(19_091n);

    expect((await betRow(betId)).status).toBe('WON');
    const [leg] = await db.select().from(betLegs).where(eq(betLegs.betId, betId));
    expect(leg.status).toBe('WON');

    const won = (await entriesFor(betId)).filter((e) => e.type === 'BET_WON');
    expect(won).toHaveLength(1);
    expect(won[0].amountCents).toBe(19_091n);
    expect(await balanceOf(membership.id)).toBe(1_009_091n);
  });

  it('writes no ledger entry at all for a losing single', async () => {
    const { membership, user } = await makeMembership(1_000_000n);
    const betId = await place(single(user.id, seeded.moneyline.home, null));

    const before = await entryCount();
    await finalize(seeded.game.id, 17, 24);
    const summary = await settleGame(seeded.game.id);

    expect(summary.centsPaid).toBe(0n);
    expect(await entryCount()).toBe(before);
    expect((await betRow(betId)).status).toBe('LOST');
    // The stake left at placement; paying nothing is the correct action.
    expect(await balanceOf(membership.id)).toBe(990_000n);
  });

  it('refunds the stake exactly when a single pushes', async () => {
    const { membership, user } = await makeMembership(1_000_000n);
    const pushable = await seedPushableSpread();
    const betId = await place(single(user.id, pushable.homeSelectionId, '-3'));

    expect(await balanceOf(membership.id)).toBe(990_000n);

    // 24 - 3 = 21, exactly the away score.
    await finalize(pushable.game.id, 24, 21);
    const summary = await settleGame(pushable.game.id);

    expect(summary.centsPaid).toBe(10_000n);
    expect((await betRow(betId)).status).toBe('PUSHED');

    const pushed = (await entriesFor(betId)).filter((e) => e.type === 'BET_PUSHED');
    expect(pushed).toHaveLength(1);
    expect(pushed[0].amountCents).toBe(10_000n);
    expect(await balanceOf(membership.id)).toBe(1_000_000n);
  });

  it('drops a pushed leg and pays the reduced parlay, below the quoted payout', async () => {
    const { user } = await makeMembership(1_000_000n);
    const pushable = await seedPushableSpread();

    const betId = await place(
      parlay(user.id, [
        { selectionId: pushable.homeSelectionId, line: '-3' },
        { selectionId: seeded.moneyline.home, line: null },
      ]),
    );

    const quoted = (await betRow(betId)).potentialPayoutCents;
    expect(quoted).toBe(36_446n); // two legs at -110

    await finalize(pushable.game.id, 24, 21); // push
    await settleGame(pushable.game.id);
    expect((await betRow(betId)).status).toBe('PENDING');

    await finalize(seeded.game.id, 27, 20); // win
    await settleGame(seeded.game.id);

    expect((await betRow(betId)).status).toBe('WON');
    const won = (await entriesFor(betId)).filter((e) => e.type === 'BET_WON');
    expect(won).toHaveLength(1);
    // Pays as a one-leg bet, not the two-leg parlay that was quoted.
    expect(won[0].amountCents).toBe(19_091n);
    expect(won[0].amountCents).toBeLessThan(quoted);
  });

  it('leaves a parlay pending until every game has finished', async () => {
    const { user } = await makeMembership(1_000_000n);
    const other = await seedBettableGame();

    const betId = await place(
      parlay(user.id, [
        { selectionId: seeded.moneyline.home, line: null },
        { selectionId: other.moneyline.home, line: null },
      ]),
    );

    await finalize(seeded.game.id, 27, 20);
    const first = await settleGame(seeded.game.id);

    expect(first.betsSettled).toBe(0);
    expect((await betRow(betId)).status).toBe('PENDING');
    expect(await entriesFor(betId)).toHaveLength(1); // only BET_PLACED
  });

  it('settles a parlay LOST on the first losing leg and ignores the rest', async () => {
    const { user } = await makeMembership(1_000_000n);
    const other = await seedBettableGame();

    const betId = await place(
      parlay(user.id, [
        { selectionId: seeded.moneyline.home, line: null },
        { selectionId: other.moneyline.home, line: null },
      ]),
    );

    await finalize(seeded.game.id, 10, 30);
    await settleGame(seeded.game.id);

    expect((await betRow(betId)).status).toBe('LOST');
    const mid = await db.select().from(betLegs).where(eq(betLegs.betId, betId));
    expect(mid.find((l) => l.selectionId === other.moneyline.home)?.status).toBe('PENDING');

    // Settling the other game grades that leg but must not touch the bet or the ledger.
    const before = await entryCount();
    await finalize(other.game.id, 31, 3);
    await settleGame(other.game.id);

    expect((await betRow(betId)).status).toBe('LOST');
    expect(await entryCount()).toBe(before);
    const after = await db.select().from(betLegs).where(eq(betLegs.betId, betId));
    expect(after.find((l) => l.selectionId === other.moneyline.home)?.status).toBe('WON');
  });

  it('is idempotent — a second call writes nothing', async () => {
    const { membership, user } = await makeMembership(1_000_000n);
    await place(single(user.id, seeded.moneyline.home, null));

    await finalize(seeded.game.id, 27, 20);
    await settleGame(seeded.game.id);

    const afterFirst = (await db.select().from(ledgerEntries)).length;
    const balanceAfterFirst = await balanceOf(membership.id);

    const second = await settleGame(seeded.game.id);

    expect(second.betsSettled).toBe(0);
    expect(second.centsPaid).toBe(0n);
    expect(await entryCount()).toBe(afterFirst);
    expect(await balanceOf(membership.id)).toBe(balanceAfterFirst);
  });

  it('marks every market on the game SETTLED', async () => {
    await finalize(seeded.game.id, 27, 20);
    await settleGame(seeded.game.id);

    const rows = await db.select().from(markets).where(eq(markets.gameId, seeded.game.id));
    expect(rows).toHaveLength(3);
    expect(rows.every((m) => m.status === 'SETTLED')).toBe(true);
  });

  it('pays two members on the same game in one call', async () => {
    const first = await makeMembership(1_000_000n);
    const second = await makeMembership(1_000_000n, first.seasonId);

    await place(single(first.user.id, seeded.moneyline.home, null));
    await place(single(second.user.id, seeded.moneyline.home, null));

    await finalize(seeded.game.id, 27, 20);
    const summary = await settleGame(seeded.game.id);

    expect(summary.betsSettled).toBe(2);
    expect(summary.centsPaid).toBe(38_182n);
    expect(await balanceOf(first.membership.id)).toBe(1_009_091n);
    expect(await balanceOf(second.membership.id)).toBe(1_009_091n);
  });

  it('refuses to settle a game that is not FINAL', async () => {
    await expect(settleGame(seeded.game.id)).rejects.toThrow();
  });
});
