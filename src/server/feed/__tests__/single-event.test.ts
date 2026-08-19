import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { feedEvents, seasonMemberships } from '@/db/schema';
import { getFeedEvent } from '@/server/feed/query';
import { resetDb } from '@/test/db';
import { makeSeason, makeUser } from '@/test/factories';

async function seed() {
  const season = await makeSeason({ status: 'ACTIVE' });
  const user = await makeUser();
  const [membership] = await db
    .insert(seasonMemberships)
    .values({ userId: user.id, seasonId: season.id, balanceCents: 1_000_000n })
    .returning();
  const [event] = await db
    .insert(feedEvents)
    .values({
      seasonId: season.id,
      type: 'BET_PLACED',
      subjectMembershipId: membership.id,
      payload: { betType: 'SINGLE' },
      dedupeKey: 'single-event',
      occurredAt: new Date(),
    })
    .returning();
  return { season, user, membership, event };
}

describe('getFeedEvent', () => {
  beforeEach(resetDb);

  it('returns the card for an event in the viewer’s season', async () => {
    const { season, user, membership, event } = await seed();

    const card = await getFeedEvent({
      eventId: event.id,
      seasonId: season.id,
      viewerUserId: user.id,
      viewerMembershipId: membership.id,
    });

    expect(card?.id).toBe(event.id);
    expect(card?.subject?.displayName).toBe(user.displayName);
  });

  it('returns null for another season’s event, indistinguishable from missing', async () => {
    const { user, membership, event } = await seed();
    const otherSeason = await makeSeason();

    const card = await getFeedEvent({
      eventId: event.id,
      seasonId: otherSeason.id,
      viewerUserId: user.id,
      viewerMembershipId: membership.id,
    });

    expect(card).toBeNull();
  });

  it('ignores the viewer’s mutes — a card reached by link still opens', async () => {
    const { season, user, membership, event } = await seed();
    const { setMutedTypes } = await import('@/server/feed/preferences');
    await setMutedTypes(user.id, ['BET_PLACED']);

    const card = await getFeedEvent({
      eventId: event.id,
      seasonId: season.id,
      viewerUserId: user.id,
      viewerMembershipId: membership.id,
    });

    expect(card?.id).toBe(event.id);
  });
});
