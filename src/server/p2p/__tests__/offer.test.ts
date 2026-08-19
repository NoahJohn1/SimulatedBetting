import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedEvents, ledgerEntries, p2pWagers, seasonMemberships } from '@/db/schema';
import { offerWager } from '@/server/p2p/offer';
import { resetDb } from '@/test/db';
import { makeCreditedMembership } from '@/test/factories';
import { seedBettableGame } from '@/server/bets/__tests__/helpers';

const SOON = () => new Date(Date.now() + 3_600_000);
const LATER = () => new Date(Date.now() + 7 * 86_400_000);

async function credits(membershipId: string) {
  const [row] = await db
    .select({ credits: seasonMemberships.creditsBalanceCents })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, membershipId));
  return row.credits;
}

function freeform(actorUserId: string, over: Record<string, unknown> = {}) {
  return {
    actorUserId,
    kind: 'FREEFORM' as const,
    offererStakeCents: 50_000n,
    acceptorStakeCents: 20_000n,
    description: 'Jake cannot name ten starting quarterbacks',
    expiresAt: SOON(),
    resolvesBy: LATER(),
    ...over,
  };
}

describe('offerWager', () => {
  beforeEach(resetDb);

  it('escrows the offerer stake at offer and opens the wager', async () => {
    const offerer = await makeCreditedMembership(100_000n);

    const result = await offerWager(freeform(offerer.user.id));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.creditsBalanceCents).toBe(50_000n);
    expect(await credits(offerer.membership.id)).toBe(50_000n);

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, result.wagerId));
    expect(wager.status).toBe('OFFERED');
    expect(wager.kind).toBe('FREEFORM');
    expect(wager.offererMembershipId).toBe(offerer.membership.id);
    expect(wager.acceptorMembershipId).toBeNull();
    expect(wager.opponentMembershipId).toBeNull();

    const [entry] = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.p2pWagerId, result.wagerId));
    expect(entry.type).toBe('P2P_ESCROW');
    expect(entry.currency).toBe('CREDITS');
    expect(entry.amountCents).toBe(-50_000n);
    expect(entry.idempotencyKey).toBe(`p2p:${result.wagerId}:escrow:offerer`);
  });

  it('posts one P2P_OFFERED card carrying the pot', async () => {
    const offerer = await makeCreditedMembership(100_000n);

    const result = await offerWager(freeform(offerer.user.id));
    if (!result.ok) throw new Error('expected the offer to succeed');

    const [card] = await db.select().from(feedEvents).where(eq(feedEvents.type, 'P2P_OFFERED'));
    expect(card.dedupeKey).toBe(`p2p:${result.wagerId}:offered`);
    expect(card.subjectMembershipId).toBe(offerer.membership.id);
    expect(card.payload).toMatchObject({
      wagerId: result.wagerId,
      kind: 'FREEFORM',
      offererStakeCents: '50000',
      acceptorStakeCents: '20000',
      potCents: '70000',
      directed: false,
    });
  });

  it('records a directed challenge against the named opponent', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const opponent = await makeCreditedMembership(100_000n, offerer.seasonId);

    const result = await offerWager(
      freeform(offerer.user.id, { opponentMembershipId: opponent.membership.id }),
    );
    if (!result.ok) throw new Error('expected the offer to succeed');

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, result.wagerId));
    expect(wager.opponentMembershipId).toBe(opponent.membership.id);

    const [card] = await db.select().from(feedEvents).where(eq(feedEvents.type, 'P2P_OFFERED'));
    expect(card.payload).toMatchObject({ directed: true });
  });

  it('freezes the line on a market-backed wager', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const game = await seedBettableGame();

    const result = await offerWager({
      actorUserId: offerer.user.id,
      kind: 'MARKET',
      selectionId: game.spread.home,
      offererStakeCents: 10_000n,
      acceptorStakeCents: 10_000n,
      expiresAt: SOON(),
      resolvesBy: LATER(),
    });
    if (!result.ok) throw new Error('expected the offer to succeed');

    const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, result.wagerId));
    expect(wager.kind).toBe('MARKET');
    expect(wager.selectionId).toBe(game.spread.home);
    expect(wager.lineAtOffer).toBe('-3.50');
    expect(wager.description).toBeNull();
  });

  it('refuses a stake the offerer cannot cover', async () => {
    const offerer = await makeCreditedMembership(10_000n);

    const result = await offerWager(freeform(offerer.user.id));

    expect(result).toEqual({
      ok: false,
      error: { code: 'INSUFFICIENT_CREDITS', availableCents: 10_000n },
    });
    expect(await db.select().from(p2pWagers)).toHaveLength(0);
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });

  it('refuses a non-positive stake on either side', async () => {
    const offerer = await makeCreditedMembership(100_000n);

    expect(await offerWager(freeform(offerer.user.id, { offererStakeCents: 0n }))).toEqual({
      ok: false,
      error: { code: 'INVALID_STAKE', side: 'OFFERER' },
    });
    expect(await offerWager(freeform(offerer.user.id, { acceptorStakeCents: -1n }))).toEqual({
      ok: false,
      error: { code: 'INVALID_STAKE', side: 'ACCEPTOR' },
    });
    expect(await db.select().from(p2pWagers)).toHaveLength(0);
  });

  it('refuses to challenge yourself', async () => {
    const offerer = await makeCreditedMembership(100_000n);

    const result = await offerWager(
      freeform(offerer.user.id, { opponentMembershipId: offerer.membership.id }),
    );

    expect(result).toEqual({ ok: false, error: { code: 'OPPONENT_IS_SELF' } });
  });

  it('refuses an opponent from another season', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    // Only one ACTIVE season may exist at a time (seasons_one_active_idx), so the stranger's
    // season here has to be a real, distinct, non-active one rather than another default.
    const { makeSeason } = await import('@/test/factories');
    const otherSeason = await makeSeason({ status: 'UPCOMING' });
    const stranger = await makeCreditedMembership(100_000n, otherSeason.id);

    const result = await offerWager(
      freeform(offerer.user.id, { opponentMembershipId: stranger.membership.id }),
    );

    expect(result).toEqual({ ok: false, error: { code: 'OPPONENT_NOT_IN_SEASON' } });
  });

  it('refuses a resolve-by that lands before the offer expires', async () => {
    const offerer = await makeCreditedMembership(100_000n);

    const result = await offerWager(
      freeform(offerer.user.id, {
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
        resolvesBy: new Date(Date.now() + 3_600_000),
      }),
    );

    expect(result).toEqual({ ok: false, error: { code: 'INVALID_WINDOW' } });
  });

  it('refuses an expiry already in the past', async () => {
    const offerer = await makeCreditedMembership(100_000n);

    const result = await offerWager(
      freeform(offerer.user.id, { expiresAt: new Date(Date.now() - 1_000) }),
    );

    expect(result).toEqual({ ok: false, error: { code: 'INVALID_WINDOW' } });
  });

  it('refuses a FREEFORM wager with a blank description', async () => {
    const offerer = await makeCreditedMembership(100_000n);

    const result = await offerWager(freeform(offerer.user.id, { description: '   ' }));

    expect(result).toEqual({ ok: false, error: { code: 'WRONG_KIND_FIELDS' } });
  });

  it('refuses a MARKET wager whose game has already started', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const game = await seedBettableGame({ startsAt: new Date(Date.now() - 3_600_000) });

    const result = await offerWager({
      actorUserId: offerer.user.id,
      kind: 'MARKET',
      selectionId: game.moneyline.home,
      offererStakeCents: 10_000n,
      acceptorStakeCents: 10_000n,
      expiresAt: SOON(),
      resolvesBy: LATER(),
    });

    expect(result).toEqual({ ok: false, error: { code: 'EVENT_ALREADY_STARTED' } });
  });

  it('refuses a MARKET wager on a suspended market', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const game = await seedBettableGame();
    const { markets, selections } = await import('@/db/schema');
    const [sel] = await db
      .select({ marketId: selections.marketId })
      .from(selections)
      .where(eq(selections.id, game.moneyline.home));
    await db.update(markets).set({ status: 'SUSPENDED' }).where(eq(markets.id, sel.marketId));

    const result = await offerWager({
      actorUserId: offerer.user.id,
      kind: 'MARKET',
      selectionId: game.moneyline.home,
      offererStakeCents: 10_000n,
      acceptorStakeCents: 10_000n,
      expiresAt: SOON(),
      resolvesBy: LATER(),
    });

    expect(result).toEqual({ ok: false, error: { code: 'MARKET_NOT_OPEN' } });
  });

  it('refuses an offer from someone with no membership in an active season', async () => {
    const { makeUser } = await import('@/test/factories');
    const stranger = await makeUser();

    const result = await offerWager(freeform(stranger.id));

    expect(result).toEqual({ ok: false, error: { code: 'NOT_A_MEMBER' } });
  });
});
