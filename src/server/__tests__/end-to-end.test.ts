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
import {
  bets,
  customEvents,
  feedEvents,
  games,
  ledgerEntries,
  markets,
  p2pWagers,
  seasonMemberships,
  seasons,
  selections,
  users,
} from '@/db/schema';
import { FixtureOddsProvider, FixtureScoreProvider } from '@/fixtures/providers';
import { placeBet } from '@/server/bets/place';
import { settleFinalGames } from '@/server/bets/settle';
import { createCustomEvent } from '@/server/events/create';
import { disputeResolution } from '@/server/events/dispute';
import { resolveCustomEvent } from '@/server/events/resolve';
import { postEntry } from '@/server/money/ledger';
import { reconcileBalances, reconcileEscrow } from '@/server/money/reconcile';
import { syncResults } from '@/server/odds/results';
import { syncOdds } from '@/server/odds/sync';
import { acceptWager } from '@/server/p2p/accept';
import { arbitrateWager } from '@/server/p2p/arbitrate';
import { claimWinner } from '@/server/p2p/claim';
import { offerWager } from '@/server/p2p/offer';
import { createSeason, joinSeason } from '@/server/seasons/service';
import { resetDb } from '@/test/db';
import { makeCreditedMembership, makeUser } from '@/test/factories';

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

  it('runs a custom event from creation through dispute and correction', async () => {
    // 1. An active season that grants both currencies.
    const season = await createSeason({
      name: 'Custom events season',
      startsAt: new Date('2026-09-01T00:00:00Z'),
      endsAt: new Date('2027-01-31T00:00:00Z'),
      startingBankrollCents: 1_000_000n,
      weeklyAllowanceCents: 50_000n,
      startingCreditsCents: 100_000n,
      weeklyCreditAllowanceCents: 10_000n,
    });
    await db.update(seasons).set({ status: 'ACTIVE' }).where(eq(seasons.id, season.id));

    const creatorUser = await makeUser();
    const bettorUser = await makeUser();
    const adminUser = await makeUser({ role: 'ADMIN' });

    const creator = await joinSeason(creatorUser.id, season.id);
    const bettor = await joinSeason(bettorUser.id, season.id);

    expect(creator.balanceCents).toBe(1_000_000n);
    expect(creator.creditsBalanceCents).toBe(100_000n);

    // 2. The creator opens a two-market event.
    const created = await createCustomEvent({
      creatorMembershipId: creator.membershipId,
      title: 'Jyxnzi Cup',
      startsAt: new Date(Date.now() + 3_600_000),
      resolvesBy: new Date(Date.now() + 7 * 86_400_000),
      markets: [
        {
          title: 'Who wins the cup?',
          outcomes: [
            { label: 'Falcons', priceAmerican: 100 },
            { label: 'Ravens', priceAmerican: 100 },
          ],
        },
        {
          title: 'Who wins map 1?',
          outcomes: [
            { label: 'Falcons', priceAmerican: 100 },
            { label: 'Ravens', priceAmerican: 100 },
          ],
        },
      ],
    });
    if (!created.ok) throw new Error('expected the event to be created');

    const eventMarkets = await db
      .select({ id: markets.id, title: markets.title })
      .from(markets)
      .where(eq(markets.eventId, created.eventId))
      .orderBy(asc(markets.createdAt));

    const outcomesFor = async (marketId: string) =>
      db
        .select({ id: selections.id, label: selections.label })
        .from(selections)
        .where(eq(selections.marketId, marketId))
        .orderBy(asc(selections.sortOrder));

    const cupOutcomes = await outcomesFor(eventMarkets[0].id);
    const mapOutcomes = await outcomesFor(eventMarkets[1].id);

    // 3. The bettor takes Ravens in the cup; the creator takes Falcons on map 1.
    const bettorBet = await placeBet({
      userId: bettorUser.id,
      type: 'SINGLE',
      stakeCents: 20_000n,
      clientRequestId: randomUUID(),
      legs: [{ selectionId: cupOutcomes[1].id, line: null, priceAmerican: 100 }],
    });
    const creatorBet = await placeBet({
      userId: creatorUser.id,
      type: 'SINGLE',
      stakeCents: 10_000n,
      clientRequestId: randomUUID(),
      legs: [{ selectionId: mapOutcomes[0].id, line: null, priceAmerican: 100 }],
    });
    if (!bettorBet.ok || !creatorBet.ok) throw new Error('expected both placements to succeed');

    const balances = async (membershipId: string) => {
      const [row] = await db
        .select({
          cash: seasonMemberships.balanceCents,
          credits: seasonMemberships.creditsBalanceCents,
        })
        .from(seasonMemberships)
        .where(eq(seasonMemberships.id, membershipId));
      return row;
    };

    // Credits moved; cash did not budge for anyone.
    expect(await balances(bettor.membershipId)).toEqual({ cash: 1_000_000n, credits: 80_000n });
    expect(await balances(creator.membershipId)).toEqual({ cash: 1_000_000n, credits: 90_000n });

    // 4. The creator resolves both markets for Falcons — the bettor loses, the creator wins.
    const first = await resolveCustomEvent({
      eventId: created.eventId,
      actorUserId: creatorUser.id,
      actorMembershipId: creator.membershipId,
      isAdmin: false,
      winners: [
        { marketId: eventMarkets[0].id, winningSelectionId: cupOutcomes[0].id },
        { marketId: eventMarkets[1].id, winningSelectionId: mapOutcomes[0].id },
      ],
    });
    expect(first).toMatchObject({ ok: true, attempt: 1, betsSettled: 2 });

    expect(await balances(bettor.membershipId)).toEqual({ cash: 1_000_000n, credits: 80_000n });
    // Even money on 10,000 staked pays 20,000 back: 90,000 + 20,000.
    expect(await balances(creator.membershipId)).toEqual({ cash: 1_000_000n, credits: 110_000n });

    // 5. The bettor disputes.
    const disputed = await disputeResolution({
      eventId: created.eventId,
      membershipId: bettor.membershipId,
      reason: 'the cup final was awarded to Ravens on a forfeit',
    });
    expect(disputed).toMatchObject({ ok: true, created: true });

    // 6. An admin corrects the cup market and leaves map 1 alone.
    const second = await resolveCustomEvent({
      eventId: created.eventId,
      actorUserId: adminUser.id,
      actorMembershipId: creator.membershipId,
      isAdmin: true,
      note: 'confirmed the forfeit on the tournament page',
      winners: [
        { marketId: eventMarkets[0].id, winningSelectionId: cupOutcomes[1].id },
        { marketId: eventMarkets[1].id, winningSelectionId: mapOutcomes[0].id },
      ],
    });
    expect(second).toMatchObject({ ok: true, attempt: 2 });

    // The bettor is paid 40,000 on a 20,000 stake; the creator's win is re-graded and stands,
    // so its payout is reversed and re-paid at the same amount.
    expect(await balances(bettor.membershipId)).toEqual({ cash: 1_000_000n, credits: 120_000n });
    expect(await balances(creator.membershipId)).toEqual({ cash: 1_000_000n, credits: 110_000n });

    const [bettorRow] = await db.select().from(bets).where(eq(bets.id, bettorBet.bet.id));
    expect(bettorRow.status).toBe('WON');
    expect(bettorRow.settlementAttempts).toBe(2);
    expect(bettorRow.currency).toBe('CREDITS');

    const [customRow] = await db
      .select()
      .from(customEvents)
      .where(eq(customEvents.eventId, created.eventId));
    expect(customRow.resolutionAttempts).toBe(2);
    expect(customRow.status).toBe('RESOLVED');

    // The creator's reversal is the proof history was appended to, never edited.
    const creatorEntryTypes = (
      await db
        .select({ type: ledgerEntries.type, key: ledgerEntries.idempotencyKey })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.betId, creatorBet.bet.id))
        .orderBy(asc(ledgerEntries.createdAt))
    ).map((r) => r.type);
    expect(creatorEntryTypes).toEqual(['BET_PLACED', 'BET_WON', 'SETTLEMENT_REVERSAL', 'BET_WON']);

    // 7. The feed tells the same story, in order.
    const feedTypes = (
      await db
        .select({ type: feedEvents.type })
        .from(feedEvents)
        .where(eq(feedEvents.seasonId, season.id))
        .orderBy(asc(feedEvents.occurredAt), asc(feedEvents.id))
    ).map((r) => r.type);

    expect(feedTypes.filter((t) => t.startsWith('CUSTOM_EVENT_'))).toEqual([
      'CUSTOM_EVENT_CREATED',
      'CUSTOM_EVENT_RESOLVED',
      'CUSTOM_EVENT_DISPUTED',
      'CUSTOM_EVENT_RESOLVED',
    ]);
    expect(feedTypes.filter((t) => t === 'BET_PLACED')).toHaveLength(2);
    // Two bets settled on attempt 1, two corrected on attempt 2.
    expect(feedTypes.filter((t) => t === 'BET_SETTLED')).toHaveLength(4);

    // 8. And the ledger is intact, in both denominations, for every membership.
    expect(await reconcileBalances()).toEqual([]);
  });
});

describe('the peer-to-peer arc', () => {
  beforeEach(resetDb);

  it('carries a wager from offer through a dispute to an admin correction', async () => {
    const credits = async (membershipId: string) => {
      const [row] = await db
        .select({ credits: seasonMemberships.creditsBalanceCents })
        .from(seasonMemberships)
        .where(eq(seasonMemberships.id, membershipId));
      return row.credits;
    };

    // The factory sets its starting balance directly rather than through the ledger (its own
    // comment says so) — fine everywhere except here, where reconcileBalances() must come back
    // clean. So each membership starts at 0 credits and gets its grant posted for real, as a
    // CREDITS-only entry, keeping the CASH side of the ledger untouched throughout.
    const offerer = await makeCreditedMembership(0n);
    const acceptor = await makeCreditedMembership(0n, offerer.seasonId);
    const admin = await makeCreditedMembership(0n, offerer.seasonId);
    for (const { membership } of [offerer, acceptor, admin]) {
      await db.transaction((tx) =>
        postEntry(tx, {
          membershipId: membership.id,
          amountCents: 100_000n,
          type: 'SEASON_STARTING_GRANT',
          currency: 'CREDITS',
          idempotencyKey: `test-grant:${membership.id}`,
        }),
      );
    }

    // 1. The offer. The offerer's stake is held immediately (D46).
    const offered = await offerWager({
      actorUserId: offerer.user.id,
      kind: 'FREEFORM',
      offererStakeCents: 50_000n,
      acceptorStakeCents: 20_000n,
      description: 'Jake cannot name ten starting quarterbacks',
      expiresAt: new Date(Date.now() + 3_600_000),
      resolvesBy: new Date(Date.now() + 7 * 86_400_000),
    });
    expect(offered.ok).toBe(true);
    if (!offered.ok) return;
    expect(await credits(offerer.membership.id)).toBe(50_000n);
    expect(await reconcileEscrow()).toEqual([]);

    // 2. Taken. Both stakes are now in the pot.
    const taken = await acceptWager({
      wagerId: offered.wagerId,
      actorUserId: acceptor.user.id,
    });
    expect(taken.ok).toBe(true);
    expect(await credits(acceptor.membership.id)).toBe(80_000n);
    expect(await reconcileEscrow()).toEqual([]);

    // 3. They agree, and it pays out.
    await claimWinner({
      wagerId: offered.wagerId,
      actorUserId: offerer.user.id,
      verdict: 'OFFERER',
    });
    await claimWinner({
      wagerId: offered.wagerId,
      actorUserId: acceptor.user.id,
      verdict: 'OFFERER',
    });
    expect(await credits(offerer.membership.id)).toBe(120_000n);
    expect(await credits(acceptor.membership.id)).toBe(80_000n);
    expect(await reconcileEscrow()).toEqual([]);

    // 4. An admin corrects it. Attempt 1 is reversed, attempt 2 is paid (D15).
    const corrected = await arbitrateWager({
      wagerId: offered.wagerId,
      actorUserId: admin.user.id,
      verdict: 'ACCEPTOR',
      note: 'he named eleven; there is video',
    });
    expect(corrected).toEqual({ ok: true, attempt: 2, paidCents: 70_000n });

    expect(await credits(offerer.membership.id)).toBe(50_000n);
    expect(await credits(acceptor.membership.id)).toBe(150_000n);

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, offered.wagerId));
    expect(wager.status).toBe('SETTLED');
    expect(wager.verdict).toBe('ACCEPTOR');
    expect(wager.settlementAttempts).toBe(2);

    // 5. History was corrected by addition, never by edit: the original P2P_WON is still
    //    there, alongside the reversal that undid it.
    const entries = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.p2pWagerId, offered.wagerId));
    const byType = entries.reduce<Record<string, number>>((acc, e) => {
      acc[e.type] = (acc[e.type] ?? 0) + 1;
      return acc;
    }, {});
    expect(byType).toEqual({
      P2P_ESCROW: 2,
      P2P_WON: 2,
      SETTLEMENT_REVERSAL: 1,
    });
    // Every credit that left a balance came back to one: the pot nets to zero.
    expect(entries.reduce((sum, e) => sum + e.amountCents, 0n)).toBe(0n);

    // 6. Nothing anywhere in the system has drifted, on either check.
    expect(await reconcileBalances()).toEqual([]);
    expect(await reconcileEscrow()).toEqual([]);

    // 7. No cash moved at any point. P2P cannot touch the bankroll (D40).
    const cashEntries = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.currency, 'CASH'));
    expect(cashEntries).toHaveLength(0);
  });
});
