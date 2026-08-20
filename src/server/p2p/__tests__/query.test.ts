import { beforeEach, describe, expect, it } from 'vitest';
import { acceptWager } from '@/server/p2p/accept';
import { claimWinner } from '@/server/p2p/claim';
import { offerWager } from '@/server/p2p/offer';
import {
  loadArbitrationQueue,
  loadHeadToHead,
  loadWagerBoard,
  loadWagerDetail,
} from '@/server/p2p/query';
import { resetDb } from '@/test/db';
import { makeCreditedMembership } from '@/test/factories';

async function offerOnly(actorUserId: string, over: Record<string, unknown> = {}) {
  const result = await offerWager({
    actorUserId,
    kind: 'FREEFORM',
    offererStakeCents: 50_000n,
    acceptorStakeCents: 20_000n,
    description: 'a test wager',
    expiresAt: new Date(Date.now() + 3_600_000),
    resolvesBy: new Date(Date.now() + 7 * 86_400_000),
    ...over,
  });
  if (!result.ok) throw new Error(`offer failed: ${JSON.stringify(result)}`);
  return result.wagerId;
}

describe('loadWagerBoard', () => {
  beforeEach(resetDb);

  it('separates open offers from your own', async () => {
    const a = await makeCreditedMembership(100_000n);
    const b = await makeCreditedMembership(100_000n, a.seasonId);
    await offerOnly(a.user.id);

    const forB = await loadWagerBoard(b.membership.id, a.seasonId);
    expect(forB.openOffers).toHaveLength(1);
    expect(forB.yourOffers).toHaveLength(0);

    const forA = await loadWagerBoard(a.membership.id, a.seasonId);
    // Your own open offer is yours to withdraw, not yours to accept.
    expect(forA.openOffers).toHaveLength(0);
    expect(forA.yourOffers).toHaveLength(1);
  });

  it("puts a directed offer in the recipient's inbox and nobody else's", async () => {
    const a = await makeCreditedMembership(100_000n);
    const b = await makeCreditedMembership(100_000n, a.seasonId);
    const c = await makeCreditedMembership(100_000n, a.seasonId);
    await offerOnly(a.user.id, { opponentMembershipId: b.membership.id });

    const forB = await loadWagerBoard(b.membership.id, a.seasonId);
    expect(forB.offersToYou).toHaveLength(1);
    expect(forB.openOffers).toHaveLength(0);

    const forC = await loadWagerBoard(c.membership.id, a.seasonId);
    expect(forC.offersToYou).toHaveLength(0);
    expect(forC.openOffers).toHaveLength(0);
  });

  it('lists a live wager for both parties and flags whose claim is missing', async () => {
    const a = await makeCreditedMembership(100_000n);
    const b = await makeCreditedMembership(100_000n, a.seasonId);
    const wagerId = await offerOnly(a.user.id);
    await acceptWager({ wagerId, actorUserId: b.user.id });

    const forA = await loadWagerBoard(a.membership.id, a.seasonId);
    expect(forA.liveWagers).toHaveLength(1);
    expect(forA.awaitingYourClaim).toHaveLength(1);

    await claimWinner({ wagerId, actorUserId: a.user.id, verdict: 'OFFERER' });

    const afterA = await loadWagerBoard(a.membership.id, a.seasonId);
    expect(afterA.awaitingYourClaim).toHaveLength(0);

    const forB = await loadWagerBoard(b.membership.id, a.seasonId);
    expect(forB.awaitingYourClaim).toHaveLength(1);
  });

  it('drops a settled wager out of the live list', async () => {
    const a = await makeCreditedMembership(100_000n);
    const b = await makeCreditedMembership(100_000n, a.seasonId);
    const wagerId = await offerOnly(a.user.id);
    await acceptWager({ wagerId, actorUserId: b.user.id });
    await claimWinner({ wagerId, actorUserId: a.user.id, verdict: 'OFFERER' });
    await claimWinner({ wagerId, actorUserId: b.user.id, verdict: 'OFFERER' });

    const board = await loadWagerBoard(a.membership.id, a.seasonId);
    expect(board.liveWagers).toHaveLength(0);
    expect(board.settledWagers).toHaveLength(1);
  });
});

describe('loadWagerDetail', () => {
  beforeEach(resetDb);

  it('offers accept and decline to the invited opponent only', async () => {
    const a = await makeCreditedMembership(100_000n);
    const b = await makeCreditedMembership(100_000n, a.seasonId);
    const c = await makeCreditedMembership(100_000n, a.seasonId);
    const wagerId = await offerOnly(a.user.id, { opponentMembershipId: b.membership.id });

    const forB = await loadWagerDetail(wagerId, b.membership.id);
    expect(forB!.actions).toMatchObject({ canAccept: true, canDecline: true, canCancel: false });

    const forC = await loadWagerDetail(wagerId, c.membership.id);
    expect(forC!.actions).toMatchObject({ canAccept: false, canDecline: false });

    const forA = await loadWagerDetail(wagerId, a.membership.id);
    expect(forA!.actions).toMatchObject({ canAccept: false, canCancel: true });
  });

  it('offers accept to anyone else on an open offer', async () => {
    const a = await makeCreditedMembership(100_000n);
    const c = await makeCreditedMembership(100_000n, a.seasonId);
    const wagerId = await offerOnly(a.user.id);

    const forC = await loadWagerDetail(wagerId, c.membership.id);
    expect(forC!.actions).toMatchObject({ canAccept: true, canDecline: false });
  });

  it('offers claim and propose-cancel to both parties once accepted', async () => {
    const a = await makeCreditedMembership(100_000n);
    const b = await makeCreditedMembership(100_000n, a.seasonId);
    const c = await makeCreditedMembership(100_000n, a.seasonId);
    const wagerId = await offerOnly(a.user.id);
    await acceptWager({ wagerId, actorUserId: b.user.id });

    for (const party of [a, b]) {
      const detail = await loadWagerDetail(wagerId, party.membership.id);
      expect(detail!.actions).toMatchObject({ canClaim: true, canProposeCancel: true });
    }

    const forC = await loadWagerDetail(wagerId, c.membership.id);
    expect(forC!.actions).toMatchObject({ canClaim: false, canProposeCancel: false });
  });

  it('reports a dispute as derived state', async () => {
    const a = await makeCreditedMembership(100_000n);
    const b = await makeCreditedMembership(100_000n, a.seasonId);
    const wagerId = await offerOnly(a.user.id);
    await acceptWager({ wagerId, actorUserId: b.user.id });
    await claimWinner({ wagerId, actorUserId: a.user.id, verdict: 'OFFERER' });
    await claimWinner({ wagerId, actorUserId: b.user.id, verdict: 'ACCEPTOR' });

    const detail = await loadWagerDetail(wagerId, a.membership.id);
    expect(detail!.disputed).toBe(true);
    expect(detail!.status).toBe('ACCEPTED');
    // A dispute does not take away either party's ability to concede.
    expect(detail!.actions.canClaim).toBe(true);
  });

  it('returns null for a wager that does not exist', async () => {
    const a = await makeCreditedMembership(100_000n);
    expect(await loadWagerDetail('00000000-0000-4000-8000-000000000000', a.membership.id)).toBeNull();
  });
});

describe('loadHeadToHead', () => {
  beforeEach(resetDb);

  it('scores the record between two members', async () => {
    const a = await makeCreditedMembership(300_000n);
    const b = await makeCreditedMembership(300_000n, a.seasonId);

    for (const verdict of ['OFFERER', 'OFFERER', 'ACCEPTOR'] as const) {
      const wagerId = await offerOnly(a.user.id);
      await acceptWager({ wagerId, actorUserId: b.user.id });
      await claimWinner({ wagerId, actorUserId: a.user.id, verdict });
      await claimWinner({ wagerId, actorUserId: b.user.id, verdict });
    }

    const h2h = await loadHeadToHead(a.seasonId, a.membership.id, b.membership.id);
    // A won twice at +20,000 each and lost once at -50,000.
    expect(h2h).toEqual({ settled: 3, aWon: 2, bWon: 1, voided: 0, netCentsForA: -10_000n });

    const mirrored = await loadHeadToHead(a.seasonId, b.membership.id, a.membership.id);
    expect(mirrored.netCentsForA).toBe(10_000n);
  });

  it('is all zeroes between members who have never wagered', async () => {
    const a = await makeCreditedMembership(100_000n);
    const b = await makeCreditedMembership(100_000n, a.seasonId);

    expect(await loadHeadToHead(a.seasonId, a.membership.id, b.membership.id)).toEqual({
      settled: 0,
      aWon: 0,
      bWon: 0,
      voided: 0,
      netCentsForA: 0n,
    });
  });
});

describe('loadArbitrationQueue', () => {
  beforeEach(resetDb);

  it('lists disputed and overdue wagers, and nothing healthy', async () => {
    const a = await makeCreditedMembership(300_000n);
    const b = await makeCreditedMembership(300_000n, a.seasonId);

    // Disputed.
    const disputedId = await offerOnly(a.user.id);
    await acceptWager({ wagerId: disputedId, actorUserId: b.user.id });
    await claimWinner({ wagerId: disputedId, actorUserId: a.user.id, verdict: 'OFFERER' });
    await claimWinner({ wagerId: disputedId, actorUserId: b.user.id, verdict: 'ACCEPTOR' });

    // Overdue: accepted, resolve-by has passed, nobody has claimed.
    const overdueId = await offerOnly(a.user.id, {
      resolvesBy: new Date(Date.now() + 86_400_000),
    });
    await acceptWager({ wagerId: overdueId, actorUserId: b.user.id });

    // Healthy: accepted, in date, no claims.
    const healthyId = await offerOnly(a.user.id);
    await acceptWager({ wagerId: healthyId, actorUserId: b.user.id });

    const queue = await loadArbitrationQueue(a.seasonId, new Date(Date.now() + 2 * 86_400_000));
    const ids = queue.map((w) => w.id).sort();
    expect(ids).toEqual([disputedId, overdueId].sort());
    expect(ids).not.toContain(healthyId);
  });
});
