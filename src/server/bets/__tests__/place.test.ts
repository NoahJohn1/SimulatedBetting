import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { betLegs, bets, ledgerEntries, seasonMemberships } from '@/db/schema';
import { loadPlacementContext, placeBet } from '@/server/bets/place';
import type { PlaceBetInput } from '@/server/bets/types';
import { resetDb } from '@/test/db';
import { makeMembership, seedBettableGame, setSelectionPrice } from './helpers';

async function balanceOf(membershipId: string): Promise<bigint> {
  const [row] = await db
    .select({ balanceCents: seasonMemberships.balanceCents })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, membershipId));
  return row.balanceCents;
}

async function counts() {
  return {
    bets: (await db.select().from(bets)).length,
    legs: (await db.select().from(betLegs)).length,
    entries: (await db.select().from(ledgerEntries)).length,
  };
}

function singleInput(
  userId: string,
  selectionId: string,
  over: Partial<PlaceBetInput> = {},
): PlaceBetInput {
  return {
    userId,
    type: 'SINGLE',
    stakeCents: 10_000n,
    legs: [{ selectionId, line: null, priceAmerican: -110 }],
    clientRequestId: randomUUID(),
    ...over,
  };
}

describe('placeBet', () => {
  beforeEach(resetDb);

  it('places a single, writing one bet, one leg and one BET_PLACED entry', async () => {
    const { membership, user } = await makeMembership(1_000_000n);
    const seeded = await seedBettableGame();

    const result = await placeBet(singleInput(user.id, seeded.moneyline.home));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.bet.stakeCents).toBe(10_000n);
    expect(result.bet.potentialPayoutCents).toBe(19_091n);
    expect(result.bet.balanceAfterCents).toBe(990_000n);
    expect(await balanceOf(membership.id)).toBe(990_000n);

    const [row] = await db.select().from(bets);
    expect(row.status).toBe('PENDING');
    expect(row.type).toBe('SINGLE');

    const legs = await db.select().from(betLegs).where(eq(betLegs.betId, row.id));
    expect(legs).toHaveLength(1);

    const entries = await db.select().from(ledgerEntries);
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('BET_PLACED');
    expect(entries[0].amountCents).toBe(-10_000n);
    expect(entries[0].betId).toBe(row.id);
  });

  it('places a three-leg parlay quoted at the combined price', async () => {
    const { user } = await makeMembership(1_000_000n);
    const a = await seedBettableGame();
    const b = await seedBettableGame();
    const c = await seedBettableGame();

    const result = await placeBet({
      userId: user.id,
      type: 'PARLAY',
      stakeCents: 10_000n,
      legs: [
        { selectionId: a.moneyline.home, line: null, priceAmerican: -110 },
        { selectionId: b.spread.home, line: '-3.5', priceAmerican: -110 },
        { selectionId: c.total.over, line: '44.5', priceAmerican: -110 },
      ],
      clientRequestId: randomUUID(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // (210/110)^3 x 10000 cents = 69579.26..., rounded half-up exactly once.
    expect(result.bet.potentialPayoutCents).toBe(69_579n);

    const legs = await db.select().from(betLegs);
    expect(legs).toHaveLength(3);
    expect(legs.every((leg) => leg.priceAtPlacement === -110)).toBe(true);

    const spreadLeg = legs.find((leg) => leg.selectionId === b.spread.home);
    expect(spreadLeg?.lineAtPlacement).toBe('-3.50');
  });

  it('freezes the leg price against later line movement', async () => {
    const { user } = await makeMembership(1_000_000n);
    const seeded = await seedBettableGame();

    const result = await placeBet(singleInput(user.id, seeded.moneyline.home));
    expect(result.ok).toBe(true);

    await setSelectionPrice(seeded.moneyline.home, +250, null);

    const [leg] = await db.select().from(betLegs);
    expect(leg.priceAtPlacement).toBe(-110);
  });

  it('writes nothing at all when the stake exceeds the balance', async () => {
    const { membership, user } = await makeMembership(5_000n);
    const seeded = await seedBettableGame();

    const result = await placeBet(singleInput(user.id, seeded.moneyline.home));

    expect(result).toEqual({
      ok: false,
      error: { code: 'INSUFFICIENT_FUNDS', stakeCents: 10_000n, balanceCents: 5_000n },
    });
    expect(await counts()).toEqual({ bets: 0, legs: 0, entries: 0 });
    expect(await balanceOf(membership.id)).toBe(5_000n);
  });

  it('rejects a price that moved after the snapshot the caller validated against', async () => {
    const { user } = await makeMembership(1_000_000n);
    const seeded = await seedBettableGame();
    const input = singleInput(user.id, seeded.moneyline.home);

    // Snapshot the context, then move the price underneath it. The pre-transaction check
    // passes against the stale snapshot; only the re-check inside the transaction, holding
    // the row lock, can catch this. That re-check is the actual guarantee.
    const stale = await loadPlacementContext(input);
    await setSelectionPrice(seeded.moneyline.home, -200, null);

    const result = await placeBet(input, stale);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LINE_MOVED');
    expect(await counts()).toEqual({ bets: 0, legs: 0, entries: 0 });
  });

  it('lets exactly one of two concurrent placements win the balance', async () => {
    const { membership, user } = await makeMembership(10_000n);
    const a = await seedBettableGame();
    const b = await seedBettableGame();

    const results = await Promise.all([
      placeBet(singleInput(user.id, a.moneyline.home, { stakeCents: 8_000n })),
      placeBet(singleInput(user.id, b.moneyline.home, { stakeCents: 8_000n })),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const rejected = results.find((r) => !r.ok);
    expect(rejected && !rejected.ok && rejected.error.code).toBe('INSUFFICIENT_FUNDS');

    const balance = await balanceOf(membership.id);
    expect(balance).toBe(2_000n);
    expect(balance >= 0n).toBe(true);
    expect((await counts()).bets).toBe(1);
  });

  it('treats a repeated clientRequestId as the same submission', async () => {
    const { user } = await makeMembership(1_000_000n);
    const seeded = await seedBettableGame();
    const input = singleInput(user.id, seeded.moneyline.home);

    const first = await placeBet(input);
    const second = await placeBet(input);

    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toEqual({ code: 'DUPLICATE_REQUEST', betId: first.bet.id });

    expect(await counts()).toEqual({ bets: 1, legs: 1, entries: 1 });
  });
});
