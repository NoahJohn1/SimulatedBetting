import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  customEvents,
  feedEvents,
  games,
  markets,
  p2pWagers,
  seasonMemberships,
} from '@/db/schema';
import { acceptWager } from '@/server/p2p/accept';
import { offerWager } from '@/server/p2p/offer';
import { sweepP2PWagers } from '@/server/p2p/sweep';
import { resetDb } from '@/test/db';
import { makeCreditedMembership, makeCustomEvent } from '@/test/factories';
import { seedBettableGame } from '@/server/bets/__tests__/helpers';

async function credits(membershipId: string) {
  const [row] = await db
    .select({ credits: seasonMemberships.creditsBalanceCents })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, membershipId));
  return row.credits;
}

async function pair() {
  const offerer = await makeCreditedMembership(100_000n);
  const acceptor = await makeCreditedMembership(100_000n, offerer.seasonId);
  return { offerer, acceptor };
}

async function offerAndAccept(
  offererUserId: string,
  acceptorUserId: string,
  over: Record<string, unknown>,
) {
  const offered = await offerWager({
    actorUserId: offererUserId,
    kind: 'FREEFORM',
    offererStakeCents: 50_000n,
    acceptorStakeCents: 20_000n,
    description: 'a test wager',
    expiresAt: new Date(Date.now() + 3_600_000),
    resolvesBy: new Date(Date.now() + 7 * 86_400_000),
    ...over,
  });
  if (!offered.ok) throw new Error(`offer failed: ${JSON.stringify(offered)}`);
  const taken = await acceptWager({ wagerId: offered.wagerId, actorUserId: acceptorUserId });
  if (!taken.ok) throw new Error(`accept failed: ${JSON.stringify(taken)}`);
  return offered.wagerId;
}

describe('sweepP2PWagers — expiry', () => {
  beforeEach(resetDb);

  it('expires an unaccepted offer past its date and refunds the offerer', async () => {
    const { offerer } = await pair();
    const offered = await offerWager({
      actorUserId: offerer.user.id,
      kind: 'FREEFORM',
      offererStakeCents: 50_000n,
      acceptorStakeCents: 20_000n,
      description: 'a test wager',
      expiresAt: new Date(Date.now() + 3_600_000),
      resolvesBy: new Date(Date.now() + 7 * 86_400_000),
    });
    if (!offered.ok) throw new Error('expected the offer to succeed');
    expect(await credits(offerer.membership.id)).toBe(50_000n);

    const summary = await sweepP2PWagers(new Date(Date.now() + 2 * 3_600_000));

    expect(summary.expired).toBe(1);
    expect(await credits(offerer.membership.id)).toBe(100_000n);

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, offered.wagerId));
    expect(wager.status).toBe('EXPIRED');
  });

  it('leaves an offer inside its window alone', async () => {
    const { offerer } = await pair();
    await offerWager({
      actorUserId: offerer.user.id,
      kind: 'FREEFORM',
      offererStakeCents: 50_000n,
      acceptorStakeCents: 20_000n,
      description: 'a test wager',
      expiresAt: new Date(Date.now() + 3_600_000),
      resolvesBy: new Date(Date.now() + 7 * 86_400_000),
    });

    const summary = await sweepP2PWagers();

    expect(summary.expired).toBe(0);
    expect(await credits(offerer.membership.id)).toBe(50_000n);
  });

  it('is idempotent — a second sweep refunds nothing more', async () => {
    const { offerer } = await pair();
    await offerWager({
      actorUserId: offerer.user.id,
      kind: 'FREEFORM',
      offererStakeCents: 50_000n,
      acceptorStakeCents: 20_000n,
      description: 'a test wager',
      expiresAt: new Date(Date.now() + 3_600_000),
      resolvesBy: new Date(Date.now() + 7 * 86_400_000),
    });

    const later = new Date(Date.now() + 2 * 3_600_000);
    await sweepP2PWagers(later);
    const second = await sweepP2PWagers(later);

    expect(second.expired).toBe(0);
    expect(await credits(offerer.membership.id)).toBe(100_000n);
  });

  it('posts no card for an expiry — an ignored offer is a non-event', async () => {
    const { offerer } = await pair();
    await offerWager({
      actorUserId: offerer.user.id,
      kind: 'FREEFORM',
      offererStakeCents: 50_000n,
      acceptorStakeCents: 20_000n,
      description: 'a test wager',
      expiresAt: new Date(Date.now() + 3_600_000),
      resolvesBy: new Date(Date.now() + 7 * 86_400_000),
    });

    await sweepP2PWagers(new Date(Date.now() + 2 * 3_600_000));

    const types = await db.select({ type: feedEvents.type }).from(feedEvents);
    expect(types.map((t) => t.type)).toEqual(['P2P_OFFERED']);
  });
});

describe('sweepP2PWagers — market-backed settlement', () => {
  beforeEach(resetDb);

  it('pays the offerer when their spread covers', async () => {
    const { offerer, acceptor } = await pair();
    const game = await seedBettableGame();
    const wagerId = await offerAndAccept(offerer.user.id, acceptor.user.id, {
      kind: 'MARKET',
      selectionId: game.spread.home,
      description: undefined,
    });

    // Home -3.50 wins by 10.
    await db
      .update(games)
      .set({ status: 'FINAL', homeScore: 27, awayScore: 17 })
      .where(eq(games.id, game.game.id));

    const summary = await sweepP2PWagers();

    expect(summary.settled).toBe(1);
    expect(await credits(offerer.membership.id)).toBe(120_000n);
    expect(await credits(acceptor.membership.id)).toBe(80_000n);

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.status).toBe('SETTLED');
    expect(wager.verdict).toBe('OFFERER');
  });

  it('pays the acceptor when the offerer’s side loses', async () => {
    const { offerer, acceptor } = await pair();
    const game = await seedBettableGame();
    await offerAndAccept(offerer.user.id, acceptor.user.id, {
      kind: 'MARKET',
      selectionId: game.spread.home,
      description: undefined,
    });

    // Home -3.50 loses outright.
    await db
      .update(games)
      .set({ status: 'FINAL', homeScore: 17, awayScore: 27 })
      .where(eq(games.id, game.game.id));

    await sweepP2PWagers();

    expect(await credits(acceptor.membership.id)).toBe(150_000n);
    expect(await credits(offerer.membership.id)).toBe(50_000n);
  });

  it('grades from the frozen line, not the current one', async () => {
    const { offerer, acceptor } = await pair();
    const game = await seedBettableGame();
    await offerAndAccept(offerer.user.id, acceptor.user.id, {
      kind: 'MARKET',
      selectionId: game.spread.home,
      description: undefined,
    });

    const { setSelectionPrice } = await import('@/server/bets/__tests__/helpers');
    // The live line moves to -14.5; the wager was struck at -3.5 and must grade at -3.5.
    await setSelectionPrice(game.spread.home, -110, '-14.50');

    await db
      .update(games)
      .set({ status: 'FINAL', homeScore: 27, awayScore: 17 })
      .where(eq(games.id, game.game.id));

    await sweepP2PWagers();

    // At -3.5 the offerer covers by 10 and wins. At -14.5 they would have lost.
    expect(await credits(offerer.membership.id)).toBe(120_000n);
  });

  it('refunds both on a push', async () => {
    const { offerer, acceptor } = await pair();
    const game = await seedBettableGame();
    const { selections } = await import('@/db/schema');
    await db.update(selections).set({ line: '-3.00' }).where(eq(selections.id, game.spread.home));

    await offerAndAccept(offerer.user.id, acceptor.user.id, {
      kind: 'MARKET',
      selectionId: game.spread.home,
      description: undefined,
    });

    // Home -3 in a game won by exactly 3 is a push.
    await db
      .update(games)
      .set({ status: 'FINAL', homeScore: 20, awayScore: 17 })
      .where(eq(games.id, game.game.id));

    await sweepP2PWagers();

    expect(await credits(offerer.membership.id)).toBe(100_000n);
    expect(await credits(acceptor.membership.id)).toBe(100_000n);
  });

  it('voids both sides when the game is canceled', async () => {
    const { offerer, acceptor } = await pair();
    const game = await seedBettableGame();
    const wagerId = await offerAndAccept(offerer.user.id, acceptor.user.id, {
      kind: 'MARKET',
      selectionId: game.moneyline.home,
      description: undefined,
    });

    await db.update(games).set({ status: 'CANCELED' }).where(eq(games.id, game.game.id));

    await sweepP2PWagers();

    expect(await credits(offerer.membership.id)).toBe(100_000n);
    expect(await credits(acceptor.membership.id)).toBe(100_000n);

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));
    expect(wager.status).toBe('VOIDED');

    const [card] = await db.select().from(feedEvents).where(eq(feedEvents.type, 'P2P_VOIDED'));
    expect(card.payload).toMatchObject({ reason: 'EVENT_DEAD' });
  });

  it('settles a wager on a resolved custom market', async () => {
    const { offerer, acceptor } = await pair();
    const event = await makeCustomEvent({
      creatorMembershipId: offerer.membership.id,
      seasonId: offerer.seasonId,
    });
    const target = event.marketSelections[0];

    await offerAndAccept(offerer.user.id, acceptor.user.id, {
      kind: 'MARKET',
      selectionId: target.selectionIds[0],
      description: undefined,
    });

    await db
      .update(markets)
      .set({ status: 'SETTLED', winningSelectionId: target.selectionIds[0] })
      .where(eq(markets.id, target.marketId));

    const summary = await sweepP2PWagers();

    expect(summary.settled).toBe(1);
    expect(await credits(offerer.membership.id)).toBe(120_000n);
  });

  it('voids a wager whose custom event was voided', async () => {
    const { offerer, acceptor } = await pair();
    const event = await makeCustomEvent({
      creatorMembershipId: offerer.membership.id,
      seasonId: offerer.seasonId,
    });
    const target = event.marketSelections[0];

    await offerAndAccept(offerer.user.id, acceptor.user.id, {
      kind: 'MARKET',
      selectionId: target.selectionIds[0],
      description: undefined,
    });

    await db
      .update(customEvents)
      .set({ status: 'VOIDED' })
      .where(eq(customEvents.eventId, event.eventId));

    await sweepP2PWagers();

    expect(await credits(offerer.membership.id)).toBe(100_000n);
    expect(await credits(acceptor.membership.id)).toBe(100_000n);
  });

  it('leaves an unfinished game alone', async () => {
    const { offerer, acceptor } = await pair();
    const game = await seedBettableGame();
    await offerAndAccept(offerer.user.id, acceptor.user.id, {
      kind: 'MARKET',
      selectionId: game.moneyline.home,
      description: undefined,
    });

    const summary = await sweepP2PWagers();

    expect(summary.settled).toBe(0);
    expect(await credits(offerer.membership.id)).toBe(50_000n);
  });

  it('never settles a FREEFORM wager, however overdue', async () => {
    const { offerer, acceptor } = await pair();
    await offerAndAccept(offerer.user.id, acceptor.user.id, {
      resolvesBy: new Date(Date.now() + 86_400_000),
    });

    const summary = await sweepP2PWagers(new Date(Date.now() + 2 * 86_400_000));

    expect(summary.settled).toBe(0);
    expect(await credits(offerer.membership.id)).toBe(50_000n);
    expect(await credits(acceptor.membership.id)).toBe(80_000n);
  });
});

describe('sweepP2PWagers — overdue', () => {
  beforeEach(resetDb);

  it('flags an overdue freeform wager exactly once', async () => {
    const { offerer, acceptor } = await pair();
    const wagerId = await offerAndAccept(offerer.user.id, acceptor.user.id, {
      resolvesBy: new Date(Date.now() + 86_400_000),
    });

    const later = new Date(Date.now() + 2 * 86_400_000);
    const first = await sweepP2PWagers(later);
    const second = await sweepP2PWagers(later);

    expect(first.overdueFlagged).toBe(1);
    expect(second.overdueFlagged).toBe(0);

    const cards = await db.select().from(feedEvents).where(eq(feedEvents.type, 'P2P_DISPUTED'));
    expect(cards).toHaveLength(1);
    expect(cards[0].dedupeKey).toBe(`p2p:${wagerId}:overdue:1`);
  });

  it('does not flag a wager the two have already agreed on', async () => {
    const { offerer, acceptor } = await pair();
    const wagerId = await offerAndAccept(offerer.user.id, acceptor.user.id, {
      resolvesBy: new Date(Date.now() + 86_400_000),
    });

    const { claimWinner } = await import('@/server/p2p/claim');
    await claimWinner({ wagerId, actorUserId: offerer.user.id, verdict: 'OFFERER' });
    await claimWinner({ wagerId, actorUserId: acceptor.user.id, verdict: 'OFFERER' });

    const summary = await sweepP2PWagers(new Date(Date.now() + 2 * 86_400_000));

    expect(summary.overdueFlagged).toBe(0);
  });
});
