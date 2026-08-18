/**
 * The whole system, end to end, against the committed fixture slate:
 * sync odds -> open a season -> join -> place bets -> results arrive -> settle -> reconcile.
 *
 * Every other test in the suite covers one layer. This one exists to catch the failures that
 * only appear when the layers are wired together.
 */
import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { bets, feedEvents, games, markets, seasonMemberships, seasons, selections, users } from '@/db/schema';
import { FixtureOddsProvider, FixtureScoreProvider } from '@/fixtures/providers';
import { placeBet } from '@/server/bets/place';
import { settleFinalGames } from '@/server/bets/settle';
import { reconcileBalances } from '@/server/money/reconcile';
import { syncResults } from '@/server/odds/results';
import { syncOdds } from '@/server/odds/sync';
import { createSeason, joinSeason } from '@/server/seasons/service';
import { resetDb } from '@/test/db';

async function selectionId(gameExternalId: string, marketType: string, side: string) {
  const all = await db
    .select({
      id: selections.id,
      line: selections.line,
      price: selections.priceAmerican,
      side: selections.side,
      type: markets.type,
    })
    .from(selections)
    .innerJoin(markets, eq(selections.marketId, markets.id))
    .innerJoin(games, eq(markets.eventId, games.eventId))
    .where(eq(games.externalId, gameExternalId));

  const found = all.find((s) => s.type === marketType && s.side === side);
  if (!found) throw new Error(`no ${marketType}/${side} on ${gameExternalId}`);
  return found;
}

async function balanceOf(membershipId: string): Promise<bigint> {
  const [row] = await db
    .select({ balanceCents: seasonMemberships.balanceCents })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, membershipId));
  return row.balanceCents;
}

describe('end to end', () => {
  beforeEach(resetDb);

  it('runs a full week: sync, join, bet, settle, reconcile', async () => {
    // 1. Odds arrive.
    await syncOdds({ provider: new FixtureOddsProvider() });
    expect((await db.select().from(games)).length).toBeGreaterThanOrEqual(8);

    // 2. A season opens and a member joins, granted the starting bankroll.
    const season = await createSeason({
      name: '2026 Football',
      startsAt: new Date('2026-09-01T00:00:00Z'),
      endsAt: new Date('2027-01-31T00:00:00Z'),
    });
    await db.update(seasons).set({ status: 'ACTIVE' }).where(eq(seasons.id, season.id));

    const [user] = await db
      .insert(users)
      .values({
        provider: 'GOOGLE',
        providerAccountId: 'google-e2e',
        email: 'e2e@example.com',
        displayName: 'End To End',
        status: 'APPROVED',
      })
      .returning();

    const membership = await joinSeason(user.id, season.id);
    expect(membership.balanceCents).toBe(1_000_000n);

    // 3. Four bets across the slate: a winner, a loser, a spread push, and a moneyline push.
    const winner = await selectionId('nfl-2026-w1-buf-nyj', 'MONEYLINE', 'HOME');
    const loser = await selectionId('nfl-2026-w1-sf-sea', 'SPREAD', 'AWAY');
    const spreadPush = await selectionId('nfl-2026-w1-buf-nyj', 'SPREAD', 'HOME');
    const tiePush = await selectionId('nfl-2026-w1-dal-phi', 'MONEYLINE', 'HOME');

    for (const pick of [winner, loser, spreadPush, tiePush]) {
      const result = await placeBet({
        userId: user.id,
        type: 'SINGLE',
        stakeCents: 10_000n,
        legs: [{ selectionId: pick.id, line: pick.line, priceAmerican: pick.price }],
        clientRequestId: randomUUID(),
      });
      expect(result.ok).toBe(true);
    }

    // Four stakes of $100 left the balance.
    expect(await balanceOf(membership.membershipId)).toBe(960_000n);

    // 4. Results arrive.
    const results = await syncResults({ provider: new FixtureScoreProvider() });
    expect(results.gamesUpdated).toBeGreaterThanOrEqual(4);

    // 5. Settlement sweeps the slate.
    const run = await settleFinalGames();
    expect(run.errors).toEqual([]);
    expect(run.betsSettled).toBe(4);

    const settled = await db.select().from(bets);
    const byStatus = settled.reduce<Record<string, number>>((acc, bet) => {
      acc[bet.status] = (acc[bet.status] ?? 0) + 1;
      return acc;
    }, {});

    // -180 home moneyline wins, the away spread loses, and both pushes refund.
    expect(byStatus).toEqual({ WON: 1, LOST: 1, PUSHED: 2 });

    // 960,000 + 15,556 (won) + 10,000 + 10,000 (pushes) = 995,556.
    expect(await balanceOf(membership.membershipId)).toBe(995_556n);

    // 6. The cached balance still equals the ledger.
    expect(await reconcileBalances()).toEqual([]);

    // 7. The feed is a read model over the same events the ledger recorded. If these two
    // ever disagree, one of them is lying.
    const events = await db
      .select({ type: feedEvents.type, betId: feedEvents.betId })
      .from(feedEvents)
      .orderBy(asc(feedEvents.occurredAt), asc(feedEvents.id));

    const types = events.map((event) => event.type);
    expect(types).toContain('MEMBER_JOINED');
    expect(types).toContain('BET_PLACED');
    expect(types).toContain('BET_SETTLED');

    // Four bets placed, four settled — one card of each type per bet, no more, no less.
    expect(types.filter((t) => t === 'BET_PLACED')).toHaveLength(4);
    expect(types.filter((t) => t === 'BET_SETTLED')).toHaveLength(4);

    // Every placement card points at a real, distinct bet.
    const placedCards = events.filter((event) => event.type === 'BET_PLACED');
    expect(new Set(placedCards.map((card) => card.betId)).size).toBe(placedCards.length);
    expect(placedCards.every((card) => card.betId !== null)).toBe(true);
  });

  it('voids bets on a canceled game and still reconciles', async () => {
    await syncOdds({ provider: new FixtureOddsProvider() });

    const season = await createSeason({
      name: '2026 Football',
      startsAt: new Date('2026-09-01T00:00:00Z'),
      endsAt: new Date('2027-01-31T00:00:00Z'),
    });
    await db.update(seasons).set({ status: 'ACTIVE' }).where(eq(seasons.id, season.id));

    const [user] = await db
      .insert(users)
      .values({
        provider: 'GOOGLE',
        providerAccountId: 'google-e2e-void',
        email: 'void@example.com',
        displayName: 'Void Case',
        status: 'APPROVED',
      })
      .returning();

    const membership = await joinSeason(user.id, season.id);
    const canceled = await selectionId('ncaaf-2026-w2-mich-osu', 'SPREAD', 'HOME');

    const placed = await placeBet({
      userId: user.id,
      type: 'SINGLE',
      stakeCents: 25_000n,
      legs: [{ selectionId: canceled.id, line: canceled.line, priceAmerican: canceled.price }],
      clientRequestId: randomUUID(),
    });
    expect(placed.ok).toBe(true);
    expect(await balanceOf(membership.membershipId)).toBe(975_000n);

    await syncResults({ provider: new FixtureScoreProvider() });
    await settleFinalGames();

    const [bet] = await db.select().from(bets);
    expect(bet.status).toBe('VOIDED');
    // Refunded in full, as if it had never been placed.
    expect(await balanceOf(membership.membershipId)).toBe(1_000_000n);
    expect(await reconcileBalances()).toEqual([]);
  });
});
