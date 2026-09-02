import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { bets, feedEvents, games, ledgerEntries, markets, seasonMemberships } from '@/db/schema';
import { placeBet } from '@/server/bets/place';
import { resettleBet } from '@/server/bets/resettle';
import { settleGame } from '@/server/bets/settle';
import { resolveCustomEvent } from '@/server/events/resolve';
import { postEntry } from '@/server/money/ledger';
import type { BetSettledPayload, CustomLegSnapshot } from '@/server/feed/payload';
import { resetDb } from '@/test/db';
import { makeCustomEvent } from '@/test/factories';
import { makeMembership, makeUser, seedBettableGame, type BettableGame } from './helpers';

async function balanceOf(membershipId: string): Promise<bigint> {
  const [row] = await db
    .select({ balanceCents: seasonMemberships.balanceCents })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, membershipId));
  return row.balanceCents;
}

async function finalize(gameId: string, homeScore: number, awayScore: number) {
  await db.update(games).set({ status: 'FINAL', homeScore, awayScore }).where(eq(games.id, gameId));
}

async function placeSingle(userId: string, selectionId: string): Promise<string> {
  const result = await placeBet({
    userId,
    type: 'SINGLE',
    stakeCents: 10_000n,
    legs: [{ selectionId, line: null, priceAmerican: -110 }],
    clientRequestId: randomUUID(),
  });
  if (!result.ok) throw new Error(`placement failed: ${result.error.code}`);
  return result.bet.id;
}

async function betRow(betId: string) {
  const [row] = await db.select().from(bets).where(eq(bets.id, betId));
  return row;
}

async function entriesFor(betId: string) {
  return db.select().from(ledgerEntries).where(eq(ledgerEntries.betId, betId));
}

describe('resettleBet', () => {
  let seeded: BettableGame;

  beforeEach(async () => {
    await resetDb();
    seeded = await seedBettableGame();
  });

  it('reverses a wrong win and lands on the balance the correct score would have given', async () => {
    const { membership, user } = await makeMembership(1_000_000n);
    const admin = await makeUser({ role: 'ADMIN' });
    const betId = await placeSingle(user.id, seeded.moneyline.home);

    await finalize(seeded.game.id, 27, 20); // wrong score: home wins
    await settleGame(seeded.game.id);
    expect(await balanceOf(membership.id)).toBe(1_009_091n);

    await finalize(seeded.game.id, 17, 24); // corrected: home actually lost
    const result = await resettleBet({ betId, actorUserId: admin.id, note: 'score corrected' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.previousStatus).toBe('WON');
    expect(result.newStatus).toBe('LOST');
    expect(result.reversedCents).toBe(19_091n);
    expect(result.paidCents).toBe(0n);

    expect((await betRow(betId)).status).toBe('LOST');

    const reversals = (await entriesFor(betId)).filter((e) => e.type === 'SETTLEMENT_REVERSAL');
    expect(reversals).toHaveLength(1);
    expect(reversals[0].amountCents).toBe(-19_091n);

    // The whole point: identical to never having been paid at all.
    expect(await balanceOf(membership.id)).toBe(990_000n);
  });

  it('writes no reversal when the original settlement paid nothing', async () => {
    const { membership, user } = await makeMembership(1_000_000n);
    const admin = await makeUser({ role: 'ADMIN' });
    const betId = await placeSingle(user.id, seeded.moneyline.home);

    await finalize(seeded.game.id, 17, 24); // wrong score: home loses
    await settleGame(seeded.game.id);
    expect(await balanceOf(membership.id)).toBe(990_000n);

    await finalize(seeded.game.id, 27, 20); // corrected: home actually won
    const result = await resettleBet({ betId, actorUserId: admin.id, note: 'score corrected' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reversedCents).toBe(0n);
    expect(result.paidCents).toBe(19_091n);

    const all = await entriesFor(betId);
    expect(all.filter((e) => e.type === 'SETTLEMENT_REVERSAL')).toHaveLength(0);
    expect(all.filter((e) => e.type === 'BET_WON')).toHaveLength(1);
    expect(await balanceOf(membership.id)).toBe(1_009_091n);
  });

  it('increments the attempt so the corrected key cannot collide with the original', async () => {
    const { user } = await makeMembership(1_000_000n);
    const admin = await makeUser({ role: 'ADMIN' });
    const betId = await placeSingle(user.id, seeded.moneyline.home);

    await finalize(seeded.game.id, 17, 24);
    await settleGame(seeded.game.id);
    await finalize(seeded.game.id, 27, 20);

    const result = await resettleBet({ betId, actorUserId: admin.id, note: 'corrected' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attempt).toBe(2);
    expect((await betRow(betId)).settlementAttempts).toBe(2);

    const keys = (await entriesFor(betId)).map((e) => e.idempotencyKey);
    expect(keys).toContain(`bet:${betId}:settled:2`);
    // The original attempt's key must still be distinct and present in the ledger's history.
    const all = await db.select().from(ledgerEntries);
    expect(all.some((e) => e.idempotencyKey === `bet:${betId}:placed`)).toBe(true);
  });

  it('nets to zero when re-settled with no score change', async () => {
    const { membership, user } = await makeMembership(1_000_000n);
    const admin = await makeUser({ role: 'ADMIN' });
    const betId = await placeSingle(user.id, seeded.moneyline.home);

    await finalize(seeded.game.id, 27, 20);
    await settleGame(seeded.game.id);
    const balanceBefore = await balanceOf(membership.id);
    const entriesBefore = (await entriesFor(betId)).length;

    await resettleBet({ betId, actorUserId: admin.id, note: 'no change' });

    // Appends rows rather than being idempotent — correct under D15, history is never edited.
    expect((await entriesFor(betId)).length).toBeGreaterThan(entriesBefore);
    expect(await balanceOf(membership.id)).toBe(balanceBefore);
    expect((await betRow(betId)).status).toBe('WON');
  });

  it('stamps the actor and note on both the reversal and the corrected entry', async () => {
    const { user } = await makeMembership(1_000_000n);
    const admin = await makeUser({ role: 'ADMIN' });
    const betId = await placeSingle(user.id, seeded.moneyline.home);

    await finalize(seeded.game.id, 27, 20);
    await settleGame(seeded.game.id);
    await resettleBet({ betId, actorUserId: admin.id, note: 'audit me' });

    const written = (await entriesFor(betId)).filter(
      (e) => e.type === 'SETTLEMENT_REVERSAL' || e.idempotencyKey.endsWith(':settled:2'),
    );
    expect(written.length).toBeGreaterThanOrEqual(2);
    expect(written.every((e) => e.actorUserId === admin.id)).toBe(true);
    expect(written.every((e) => e.note === 'audit me')).toBe(true);
  });

  it('refuses a bet that is still pending', async () => {
    const { user } = await makeMembership(1_000_000n);
    const admin = await makeUser({ role: 'ADMIN' });
    const betId = await placeSingle(user.id, seeded.moneyline.home);

    const result = await resettleBet({ betId, actorUserId: admin.id, note: 'too early' });
    expect(result).toEqual({ ok: false, error: { code: 'BET_STILL_PENDING' } });
  });

  it('refuses a blank note and writes nothing', async () => {
    const { membership, user } = await makeMembership(1_000_000n);
    const admin = await makeUser({ role: 'ADMIN' });
    const betId = await placeSingle(user.id, seeded.moneyline.home);

    await finalize(seeded.game.id, 27, 20);
    await settleGame(seeded.game.id);
    const before = (await entriesFor(betId)).length;
    const balanceBefore = await balanceOf(membership.id);

    const result = await resettleBet({ betId, actorUserId: admin.id, note: '   ' });

    expect(result).toEqual({ ok: false, error: { code: 'NOTE_REQUIRED' } });
    expect((await entriesFor(betId)).length).toBe(before);
    expect(await balanceOf(membership.id)).toBe(balanceBefore);
  });

  it("labels the creator's own custom-event bet on the corrected card, but not a non-creator's", async () => {
    const creator = await makeMembership(1_000_000n);
    const bettor = await makeMembership(1_000_000n, creator.seasonId);
    const admin = await makeUser({ role: 'ADMIN' });

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
    const market0 = event.marketSelections[0];

    const creatorBet = await placeBet({
      userId: creator.user.id,
      type: 'SINGLE',
      stakeCents: 10_000n,
      clientRequestId: randomUUID(),
      legs: [{ selectionId: market0.selectionIds[0], line: null, priceAmerican: 100 }],
    });
    if (!creatorBet.ok) throw new Error('expected creator placement to succeed');

    const bettorBet = await placeBet({
      userId: bettor.user.id,
      type: 'SINGLE',
      stakeCents: 10_000n,
      clientRequestId: randomUUID(),
      legs: [{ selectionId: market0.selectionIds[0], line: null, priceAmerican: 100 }],
    });
    if (!bettorBet.ok) throw new Error('expected bettor placement to succeed');

    // First resolution: selection 0 wins on every market — both bets settle WON.
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

    // A score correction, applied directly to the market — same shape as the CASH-branch
    // tests above flipping `games.homeScore/awayScore` before calling resettleBet.
    await db
      .update(markets)
      .set({ winningSelectionId: market0.selectionIds[1] })
      .where(eq(markets.id, market0.marketId));

    const creatorResult = await resettleBet({
      betId: creatorBet.bet.id,
      actorUserId: admin.id,
      note: 'result corrected',
    });
    expect(creatorResult.ok).toBe(true);
    if (!creatorResult.ok) return;
    expect(creatorResult.newStatus).toBe('LOST');

    const bettorResult = await resettleBet({
      betId: bettorBet.bet.id,
      actorUserId: admin.id,
      note: 'result corrected',
    });
    expect(bettorResult.ok).toBe(true);
    if (!bettorResult.ok) return;
    expect(bettorResult.newStatus).toBe('LOST');

    const [creatorCard] = await db
      .select()
      .from(feedEvents)
      .where(and(eq(feedEvents.type, 'BET_SETTLED'), eq(feedEvents.betId, creatorBet.bet.id)))
      .orderBy(desc(feedEvents.createdAt))
      .limit(1);
    const [bettorCard] = await db
      .select()
      .from(feedEvents)
      .where(and(eq(feedEvents.type, 'BET_SETTLED'), eq(feedEvents.betId, bettorBet.bet.id)))
      .orderBy(desc(feedEvents.createdAt))
      .limit(1);

    const creatorLeg = (creatorCard.payload as BetSettledPayload).legs[0] as CustomLegSnapshot;
    const bettorLeg = (bettorCard.payload as BetSettledPayload).legs[0] as CustomLegSnapshot;

    expect(creatorLeg.byCreator).toBe(true);
    expect(bettorLeg.byCreator).toBe(false);
  });

  it('reports a missing bet', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const result = await resettleBet({
      betId: '11111111-1111-4111-8111-111111111111',
      actorUserId: admin.id,
      note: 'nope',
    });
    expect(result).toEqual({ ok: false, error: { code: 'BET_NOT_FOUND' } });
  });
});
