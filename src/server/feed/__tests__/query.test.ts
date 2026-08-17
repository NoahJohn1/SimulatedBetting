import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { feedComments, feedEvents, feedReactions, seasonMemberships } from '@/db/schema';
import { getSeasonFeed } from '@/server/feed/query';
import { setMutedTypes } from '@/server/feed/preferences';
import { resetDb } from '@/test/db';
import { makeSeason, makeUser } from '@/test/factories';

async function seedMember(seasonId: string, balanceCents = 1_000_000n) {
  const user = await makeUser();
  const [membership] = await db
    .insert(seasonMemberships)
    .values({ userId: user.id, seasonId, balanceCents })
    .returning();
  return { user, membership };
}

async function seedEvent(
  seasonId: string,
  membershipId: string | null,
  overrides: { type?: 'BET_PLACED' | 'ALLOWANCE_PAID'; occurredAt?: Date; key?: string } = {},
) {
  const [event] = await db
    .insert(feedEvents)
    .values({
      seasonId,
      type: overrides.type ?? 'BET_PLACED',
      subjectMembershipId: membershipId,
      payload: {},
      dedupeKey: overrides.key ?? `k-${Math.random()}`,
      occurredAt: overrides.occurredAt ?? new Date(),
    })
    .returning();
  return event;
}

describe('getSeasonFeed', () => {
  beforeEach(resetDb);

  it('returns newest first with the subject joined live', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    const { user, membership } = await seedMember(season.id);

    await seedEvent(season.id, membership.id, { occurredAt: new Date('2026-09-01T12:00:00Z') });
    await seedEvent(season.id, membership.id, { occurredAt: new Date('2026-09-02T12:00:00Z') });

    const page = await getSeasonFeed({
      seasonId: season.id,
      viewerUserId: user.id,
      viewerMembershipId: membership.id,
    });

    expect(page.cards).toHaveLength(2);
    expect(page.cards[0].occurredAt).toEqual(new Date('2026-09-02T12:00:00Z'));
    expect(page.cards[0].subject?.displayName).toBe(user.displayName);
    expect(page.nextCursor).toBeNull();
  });

  it('never leaks another season', async () => {
    const mine = await makeSeason({ status: 'ACTIVE' });
    const theirs = await makeSeason();
    const { user, membership } = await seedMember(mine.id);
    const other = await seedMember(theirs.id);

    await seedEvent(mine.id, membership.id);
    await seedEvent(theirs.id, other.membership.id);

    const page = await getSeasonFeed({
      seasonId: mine.id,
      viewerUserId: user.id,
      viewerMembershipId: membership.id,
    });

    expect(page.cards).toHaveLength(1);
  });

  it('pages through colliding timestamps without skipping or repeating', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    const { user, membership } = await seedMember(season.id);

    const sameInstant = new Date('2026-09-06T20:00:00Z');
    for (let i = 0; i < 60; i++) {
      await seedEvent(season.id, membership.id, { occurredAt: sameInstant, key: `same-${i}` });
    }

    const seen = new Set<string>();
    let cursor = undefined as Awaited<ReturnType<typeof getSeasonFeed>>['nextCursor'] | undefined;
    let pages = 0;

    do {
      const page = await getSeasonFeed({
        seasonId: season.id,
        viewerUserId: user.id,
        viewerMembershipId: membership.id,
        cursor: cursor ?? undefined,
        limit: 25,
      });
      for (const card of page.cards) {
        expect(seen.has(card.id)).toBe(false);
        seen.add(card.id);
      }
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);

    expect(seen.size).toBe(60);
    expect(pages).toBe(3);
  });

  it('filters muted types per viewer without deleting anything', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    const { user, membership } = await seedMember(season.id);
    const other = await seedMember(season.id);

    await seedEvent(season.id, membership.id, { type: 'BET_PLACED' });
    await seedEvent(season.id, null, { type: 'ALLOWANCE_PAID' });

    await setMutedTypes(user.id, ['ALLOWANCE_PAID']);

    const mine = await getSeasonFeed({
      seasonId: season.id,
      viewerUserId: user.id,
      viewerMembershipId: membership.id,
    });
    expect(mine.cards.map((c) => c.type)).toEqual(['BET_PLACED']);

    const theirs = await getSeasonFeed({
      seasonId: season.id,
      viewerUserId: other.user.id,
      viewerMembershipId: other.membership.id,
    });
    expect(theirs.cards).toHaveLength(2);

    await setMutedTypes(user.id, []);
    const unmuted = await getSeasonFeed({
      seasonId: season.id,
      viewerUserId: user.id,
      viewerMembershipId: membership.id,
    });
    expect(unmuted.cards).toHaveLength(2);
  });

  it('aggregates reactions with a mine flag and counts only live comments', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    const { user, membership } = await seedMember(season.id);
    const other = await seedMember(season.id);
    const event = await seedEvent(season.id, membership.id);

    await db.insert(feedReactions).values([
      { eventId: event.id, membershipId: membership.id, emoji: '🔥' },
      { eventId: event.id, membershipId: other.membership.id, emoji: '🔥' },
      { eventId: event.id, membershipId: other.membership.id, emoji: '💀' },
    ]);

    await db.insert(feedComments).values([
      { eventId: event.id, membershipId: other.membership.id, body: 'bold' },
      { eventId: event.id, membershipId: other.membership.id, body: 'gone', deletedAt: new Date() },
    ]);

    const page = await getSeasonFeed({
      seasonId: season.id,
      viewerUserId: user.id,
      viewerMembershipId: membership.id,
    });

    const card = page.cards[0];
    expect(card.commentCount).toBe(1);

    const fire = card.reactions.find((r) => r.emoji === '🔥');
    expect(fire).toEqual({ emoji: '🔥', count: 2, mine: true });

    const skull = card.reactions.find((r) => r.emoji === '💀');
    expect(skull).toEqual({ emoji: '💀', count: 1, mine: false });
  });

  it('restricts to one member when a subject is given', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    const { user, membership } = await seedMember(season.id);
    const other = await seedMember(season.id);

    await seedEvent(season.id, membership.id);
    await seedEvent(season.id, other.membership.id);

    const page = await getSeasonFeed({
      seasonId: season.id,
      viewerUserId: user.id,
      viewerMembershipId: membership.id,
      subjectMembershipId: other.membership.id,
    });

    expect(page.cards).toHaveLength(1);
    expect(page.cards[0].subject?.membershipId).toBe(other.membership.id);
  });

  it('caps the page size at 50 however large a limit is asked for', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    const { user, membership } = await seedMember(season.id);
    for (let i = 0; i < 55; i++) {
      await seedEvent(season.id, membership.id, { key: `cap-${i}` });
    }

    const page = await getSeasonFeed({
      seasonId: season.id,
      viewerUserId: user.id,
      viewerMembershipId: membership.id,
      limit: 500,
    });

    expect(page.cards).toHaveLength(50);
  });
});
