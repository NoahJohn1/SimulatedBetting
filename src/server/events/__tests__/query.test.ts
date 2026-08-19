import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/db/client';
import { customEvents, seasons } from '@/db/schema';
import { placeBet } from '@/server/bets/place';
import { listSeasonEvents } from '@/server/events/query';
import { postEntry } from '@/server/money/ledger';
import { resetDb } from '@/test/db';
import { makeCustomEvent } from '@/test/factories';
import { makeMembership } from '@/server/bets/__tests__/helpers';

describe('listSeasonEvents', () => {
  beforeEach(resetDb);

  it('sections events into open, awaiting resolution, and settled', async () => {
    const { membership, seasonId } = await makeMembership();

    const open = await makeCustomEvent({
      creatorMembershipId: membership.id,
      seasonId,
      startsAt: new Date(Date.now() + 86_400_000),
      resolvesBy: new Date(Date.now() + 7 * 86_400_000),
    });
    const awaiting = await makeCustomEvent({
      creatorMembershipId: membership.id,
      seasonId,
      startsAt: new Date(Date.now() - 86_400_000),
      resolvesBy: new Date(Date.now() + 86_400_000),
    });
    const settled = await makeCustomEvent({ creatorMembershipId: membership.id, seasonId });
    await db
      .update(customEvents)
      .set({ status: 'RESOLVED' })
      .where(eq(customEvents.eventId, settled.eventId));

    const rows = await listSeasonEvents(seasonId);
    const byId = new Map(rows.map((r) => [r.eventId, r]));

    expect(byId.get(open.eventId)!.section).toBe('OPEN');
    expect(byId.get(awaiting.eventId)!.section).toBe('AWAITING');
    expect(byId.get(settled.eventId)!.section).toBe('SETTLED');
  });

  it('marks an event past its resolve-by date as overdue', async () => {
    const { membership, seasonId } = await makeMembership();
    const late = await makeCustomEvent({
      creatorMembershipId: membership.id,
      seasonId,
      startsAt: new Date(Date.now() - 4 * 86_400_000),
      resolvesBy: new Date(Date.now() - 86_400_000),
    });

    const [row] = await listSeasonEvents(seasonId);
    expect(row.eventId).toBe(late.eventId);
    expect(row.overdue).toBe(true);
  });

  it('totals the credits staked on each event', async () => {
    const { membership, user, seasonId } = await makeMembership();
    await db.transaction((tx) =>
      postEntry(tx, {
        membershipId: membership.id,
        amountCents: 100_000n,
        type: 'SEASON_STARTING_GRANT',
        currency: 'CREDITS',
        idempotencyKey: `credits:${membership.id}`,
      }),
    );
    const event = await makeCustomEvent({ creatorMembershipId: membership.id, seasonId });

    await placeBet({
      userId: user.id,
      type: 'SINGLE',
      stakeCents: 7_500n,
      clientRequestId: randomUUID(),
      legs: [
        { selectionId: event.marketSelections[0].selectionIds[0], line: null, priceAmerican: 100 },
      ],
    });

    const [row] = await listSeasonEvents(seasonId);
    expect(row.stakedCreditsCents).toBe(7_500n);
    expect(row.marketCount).toBe(2);
  });

  it('never returns another season’s events', async () => {
    const a = await makeMembership();
    // Only one season may be ACTIVE at a time (seasons_one_active_idx). listSeasonEvents
    // doesn't care about season status, so retire `a`'s season before minting `b`'s.
    await db.update(seasons).set({ status: 'COMPLETED' }).where(eq(seasons.id, a.seasonId));
    const b = await makeMembership();
    await makeCustomEvent({ creatorMembershipId: a.membership.id, seasonId: a.seasonId });

    expect(await listSeasonEvents(b.seasonId)).toEqual([]);
  });
});
