import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/db/client';
import { seasons } from '@/db/schema';
import { placeBet } from '@/server/bets/place';
import { disputeResolution } from '@/server/events/dispute';
import { getCustomEventDetail } from '@/server/events/query';
import { resolveCustomEvent } from '@/server/events/resolve';
import { postEntry } from '@/server/money/ledger';
import { resetDb } from '@/test/db';
import { makeCustomEvent } from '@/test/factories';
import { makeMembership } from '@/server/bets/__tests__/helpers';

async function grant(membershipId: string) {
  await db.transaction((tx) =>
    postEntry(tx, {
      membershipId,
      amountCents: 100_000n,
      type: 'SEASON_STARTING_GRANT',
      currency: 'CREDITS',
      idempotencyKey: `credits:${membershipId}`,
    }),
  );
}

async function seed() {
  const creator = await makeMembership(1_000_000n);
  const viewer = await makeMembership(1_000_000n, creator.seasonId);
  await grant(creator.membership.id);
  await grant(viewer.membership.id);

  const event = await makeCustomEvent({
    creatorMembershipId: creator.membership.id,
    seasonId: creator.seasonId,
  });

  return { creator, viewer, event };
}

describe('getCustomEventDetail', () => {
  beforeEach(resetDb);

  it('discloses the creator’s own position to a viewer who is not the creator', async () => {
    const { creator, viewer, event } = await seed();

    await placeBet({
      userId: creator.user.id,
      type: 'SINGLE',
      stakeCents: 5_000n,
      clientRequestId: randomUUID(),
      legs: [
        { selectionId: event.marketSelections[0].selectionIds[0], line: null, priceAmerican: 100 },
      ],
    });

    const detail = await getCustomEventDetail(event.eventId, viewer.membership.id);

    expect(detail).not.toBeNull();
    expect(detail!.viewerIsCreator).toBe(false);
    expect(detail!.creatorPositions).toEqual([
      {
        marketId: event.marketSelections[0].marketId,
        selectionId: event.marketSelections[0].selectionIds[0],
        stakeCents: 5_000n,
      },
    ]);
  });

  it('returns null to a member of another season', async () => {
    const { creator, event } = await seed();
    // Only one season may be ACTIVE at a time (seasons_one_active_idx). getCustomEventDetail
    // doesn't care about season status, so retire the event's season before minting the
    // outsider's — the same shape query.test.ts uses for its cross-season case.
    await db.update(seasons).set({ status: 'COMPLETED' }).where(eq(seasons.id, creator.seasonId));
    const outsider = await makeMembership();

    expect(await getCustomEventDetail(event.eventId, outsider.membership.id)).toBeNull();
  });

  it('reports the winning selection only after resolution', async () => {
    const { creator, viewer, event } = await seed();

    const before = await getCustomEventDetail(event.eventId, viewer.membership.id);
    expect(before!.markets.every((m) => m.winningSelectionId === null)).toBe(true);

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

    const after = await getCustomEventDetail(event.eventId, viewer.membership.id);
    expect(after!.status).toBe('RESOLVED');
    for (const m of event.marketSelections) {
      const market = after!.markets.find((x) => x.marketId === m.marketId)!;
      expect(market.winningSelectionId).toBe(m.selectionIds[0]);
    }
  });

  it('lists only unresolved disputes', async () => {
    const { creator, viewer, event } = await seed();

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

    await disputeResolution({
      eventId: event.eventId,
      membershipId: viewer.membership.id,
      reason: 'the bracket says otherwise',
    });

    const detail = await getCustomEventDetail(event.eventId, viewer.membership.id);
    expect(detail!.openDisputes).toHaveLength(1);
    expect(detail!.openDisputes[0].reason).toBe('the bracket says otherwise');
  });
});
