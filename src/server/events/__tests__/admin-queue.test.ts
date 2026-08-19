import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { seasons } from '@/db/schema';
import { disputeResolution } from '@/server/events/dispute';
import { listAdminEventQueue } from '@/server/events/query';
import { resolveCustomEvent } from '@/server/events/resolve';
import { resetDb } from '@/test/db';
import { makeCustomEvent } from '@/test/factories';
import { makeMembership, makeUser } from '@/server/bets/__tests__/helpers';

const LATE = {
  startsAt: new Date(Date.now() - 4 * 86_400_000),
  resolvesBy: new Date(Date.now() - 86_400_000),
};

describe('listAdminEventQueue', () => {
  beforeEach(resetDb);

  it('lists an open, past-due event under overdue only', async () => {
    const { membership, seasonId } = await makeMembership();
    const event = await makeCustomEvent({
      creatorMembershipId: membership.id,
      seasonId,
      ...LATE,
    });

    const queue = await listAdminEventQueue(seasonId);

    expect(queue.overdue.map((r) => r.eventId)).toEqual([event.eventId]);
    expect(queue.disputed).toEqual([]);
  });

  it('lists a disputed event with the disputer and their reason', async () => {
    const creator = await makeMembership();
    const bettor = await makeMembership(1_000_000n, creator.seasonId);
    const event = await makeCustomEvent({
      creatorMembershipId: creator.membership.id,
      seasonId: creator.seasonId,
    });

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
      membershipId: bettor.membership.id,
      reason: 'the bracket says otherwise',
    });

    const queue = await listAdminEventQueue(creator.seasonId);

    expect(queue.overdue).toEqual([]);
    expect(queue.disputed).toHaveLength(1);
    expect(queue.disputed[0].eventId).toBe(event.eventId);
    expect(queue.disputed[0].disputes).toEqual([
      { displayName: bettor.user.displayName, reason: 'the bracket says otherwise' },
    ]);
  });

  it('drops an event once its disputes are answered', async () => {
    const creator = await makeMembership();
    const bettor = await makeMembership(1_000_000n, creator.seasonId);
    const adminUser = await makeUser({ role: 'ADMIN' });
    const event = await makeCustomEvent({
      creatorMembershipId: creator.membership.id,
      seasonId: creator.seasonId,
    });

    const winners = (i: number) =>
      event.marketSelections.map((m) => ({
        marketId: m.marketId,
        winningSelectionId: m.selectionIds[i],
      }));

    await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: creator.user.id,
      actorMembershipId: creator.membership.id,
      isAdmin: false,
      winners: winners(0),
    });
    await disputeResolution({
      eventId: event.eventId,
      membershipId: bettor.membership.id,
      reason: 'wrong',
    });
    await resolveCustomEvent({
      eventId: event.eventId,
      actorUserId: adminUser.id,
      actorMembershipId: creator.membership.id,
      isAdmin: true,
      note: 'corrected after review',
      winners: winners(1),
    });

    const queue = await listAdminEventQueue(creator.seasonId);
    expect(queue.disputed).toEqual([]);
  });

  it('never shows another season’s events', async () => {
    const a = await makeMembership();
    // Only one season may be ACTIVE at a time (seasons_one_active_idx) — same workaround as
    // query.test.ts's identical cross-season case: retire `a`'s season before minting `b`'s.
    await db.update(seasons).set({ status: 'COMPLETED' }).where(eq(seasons.id, a.seasonId));
    const b = await makeMembership();
    await makeCustomEvent({ creatorMembershipId: a.membership.id, seasonId: a.seasonId, ...LATE });

    const queue = await listAdminEventQueue(b.seasonId);
    expect(queue).toEqual({ overdue: [], disputed: [] });
  });
});
