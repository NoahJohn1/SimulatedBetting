import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { customEvents, feedEvents } from '@/db/schema';
import { sweepOverdueEvents } from '@/server/events/overdue';
import { resetDb } from '@/test/db';
import { makeCustomEvent } from '@/test/factories';
import { makeMembership } from '@/server/bets/__tests__/helpers';

const PAST = new Date(Date.now() - 3 * 86_400_000);
const FUTURE = new Date(Date.now() + 3 * 86_400_000);

describe('sweepOverdueEvents', () => {
  beforeEach(resetDb);

  it('flags an open event past its resolve-by date', async () => {
    const { membership, seasonId } = await makeMembership();
    const event = await makeCustomEvent({
      creatorMembershipId: membership.id,
      seasonId,
      startsAt: new Date(Date.now() - 4 * 86_400_000),
      resolvesBy: PAST,
    });

    expect(await sweepOverdueEvents()).toEqual({ flagged: 1 });

    const [card] = await db
      .select()
      .from(feedEvents)
      .where(eq(feedEvents.type, 'CUSTOM_EVENT_OVERDUE'));
    expect(card.dedupeKey).toBe(`customevent:${event.eventId}:overdue`);
    expect(card.subjectMembershipId).toBe(membership.id);
    expect(card.payload).toMatchObject({ title: 'Test Cup', openBetCount: 0 });
  });

  it('flags nothing that is not yet due', async () => {
    const { membership, seasonId } = await makeMembership();
    await makeCustomEvent({ creatorMembershipId: membership.id, seasonId, resolvesBy: FUTURE });

    expect(await sweepOverdueEvents()).toEqual({ flagged: 0 });
    expect(await db.select().from(feedEvents)).toHaveLength(0);
  });

  it('flags nothing already resolved or voided', async () => {
    const { membership, seasonId } = await makeMembership();
    const event = await makeCustomEvent({
      creatorMembershipId: membership.id,
      seasonId,
      startsAt: new Date(Date.now() - 4 * 86_400_000),
      resolvesBy: PAST,
    });
    await db
      .update(customEvents)
      .set({ status: 'RESOLVED' })
      .where(eq(customEvents.eventId, event.eventId));

    expect(await sweepOverdueEvents()).toEqual({ flagged: 0 });
  });

  it('posts exactly one card however often it runs', async () => {
    const { membership, seasonId } = await makeMembership();
    await makeCustomEvent({
      creatorMembershipId: membership.id,
      seasonId,
      startsAt: new Date(Date.now() - 4 * 86_400_000),
      resolvesBy: PAST,
    });

    await sweepOverdueEvents();
    const second = await sweepOverdueEvents();
    await sweepOverdueEvents();

    // The sweep still *finds* it — nothing about the event changed — but the dedupe key
    // means only the first run posted a card.
    expect(second.flagged).toBe(1);
    expect(
      await db.select().from(feedEvents).where(eq(feedEvents.type, 'CUSTOM_EVENT_OVERDUE')),
    ).toHaveLength(1);
  });
});
