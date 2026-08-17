import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedComments, feedEvents, feedReactions, seasonMemberships } from '@/db/schema';
import {
  addComment,
  deleteComment,
  FeedError,
  listComments,
  toggleReaction,
} from '@/server/feed/social';
import { resetDb } from '@/test/db';
import { makeSeason, makeUser } from '@/test/factories';

async function seedMember(seasonId: string) {
  const user = await makeUser();
  const [membership] = await db
    .insert(seasonMemberships)
    .values({ userId: user.id, seasonId, balanceCents: 1_000_000n })
    .returning();
  return { user, membership };
}

async function seedEvent(seasonId: string, membershipId: string) {
  const [event] = await db
    .insert(feedEvents)
    .values({
      seasonId,
      type: 'BET_PLACED',
      subjectMembershipId: membershipId,
      payload: {},
      dedupeKey: `k-${Math.random()}`,
      occurredAt: new Date(),
    })
    .returning();
  return event;
}

describe('toggleReaction', () => {
  beforeEach(resetDb);

  it('adds then removes the same emoji', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    const { membership } = await seedMember(season.id);
    const event = await seedEvent(season.id, membership.id);
    const input = { eventId: event.id, membershipId: membership.id, seasonId: season.id, emoji: '🔥' };

    expect(await toggleReaction(input)).toEqual({ active: true });
    expect(await db.select().from(feedReactions)).toHaveLength(1);

    expect(await toggleReaction(input)).toEqual({ active: false });
    expect(await db.select().from(feedReactions)).toHaveLength(0);
  });

  it('allows two different emoji from the same member', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    const { membership } = await seedMember(season.id);
    const event = await seedEvent(season.id, membership.id);

    await toggleReaction({ eventId: event.id, membershipId: membership.id, seasonId: season.id, emoji: '🔥' });
    await toggleReaction({ eventId: event.id, membershipId: membership.id, seasonId: season.id, emoji: '💀' });

    expect(await db.select().from(feedReactions)).toHaveLength(2);
  });

  it('rejects an emoji outside the allowed set', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    const { membership } = await seedMember(season.id);
    const event = await seedEvent(season.id, membership.id);

    await expect(
      toggleReaction({ eventId: event.id, membershipId: membership.id, seasonId: season.id, emoji: '🍕' }),
    ).rejects.toThrow(FeedError);
    expect(await db.select().from(feedReactions)).toHaveLength(0);
  });

  it('rejects reacting to another season’s event', async () => {
    const mine = await makeSeason({ status: 'ACTIVE' });
    const theirs = await makeSeason();
    const me = await seedMember(mine.id);
    const them = await seedMember(theirs.id);
    const event = await seedEvent(theirs.id, them.membership.id);

    await expect(
      toggleReaction({ eventId: event.id, membershipId: me.membership.id, seasonId: mine.id, emoji: '🔥' }),
    ).rejects.toThrow(/WRONG_SEASON/);
  });
});

describe('addComment', () => {
  beforeEach(resetDb);

  it('stores a trimmed body', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    const { membership } = await seedMember(season.id);
    const event = await seedEvent(season.id, membership.id);

    const { commentId } = await addComment({
      eventId: event.id,
      membershipId: membership.id,
      seasonId: season.id,
      body: '   lock of the year   ',
    });

    const [row] = await db.select().from(feedComments).where(eq(feedComments.id, commentId));
    expect(row.body).toBe('lock of the year');
  });

  it('rejects an empty or whitespace-only body', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    const { membership } = await seedMember(season.id);
    const event = await seedEvent(season.id, membership.id);

    await expect(
      addComment({ eventId: event.id, membershipId: membership.id, seasonId: season.id, body: '   ' }),
    ).rejects.toThrow(/COMMENT_EMPTY/);
  });

  it('rejects a body over 500 characters', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    const { membership } = await seedMember(season.id);
    const event = await seedEvent(season.id, membership.id);

    await expect(
      addComment({
        eventId: event.id,
        membershipId: membership.id,
        seasonId: season.id,
        body: 'x'.repeat(501),
      }),
    ).rejects.toThrow(/COMMENT_TOO_LONG/);
  });
});

describe('deleteComment', () => {
  beforeEach(resetDb);

  it('lets the author soft-delete their own', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    const { user, membership } = await seedMember(season.id);
    const event = await seedEvent(season.id, membership.id);
    const { commentId } = await addComment({
      eventId: event.id,
      membershipId: membership.id,
      seasonId: season.id,
      body: 'mine',
    });

    const result = await deleteComment({
      commentId,
      actorUserId: user.id,
      actorMembershipId: membership.id,
      seasonId: season.id,
      isAdmin: false,
    });
    expect(result).toEqual({ deleted: true });

    const [row] = await db.select().from(feedComments).where(eq(feedComments.id, commentId));
    expect(row.deletedAt).not.toBeNull();
    expect(row.deletedByUserId).toBe(user.id);
    expect(row.body).toBe('mine'); // soft delete keeps the row
  });

  it('refuses a non-author who is not an admin', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    const author = await seedMember(season.id);
    const bystander = await seedMember(season.id);
    const event = await seedEvent(season.id, author.membership.id);
    const { commentId } = await addComment({
      eventId: event.id,
      membershipId: author.membership.id,
      seasonId: season.id,
      body: 'not yours',
    });

    await expect(
      deleteComment({
        commentId,
        actorUserId: bystander.user.id,
        actorMembershipId: bystander.membership.id,
        seasonId: season.id,
        isAdmin: false,
      }),
    ).rejects.toThrow(/NOT_ALLOWED/);
  });

  it('refuses an admin from a different season, even for their own comment’s id', async () => {
    const mine = await makeSeason({ status: 'ACTIVE' });
    const theirs = await makeSeason();
    const author = await seedMember(theirs.id);
    const admin = await seedMember(mine.id);
    const event = await seedEvent(theirs.id, author.membership.id);
    const { commentId } = await addComment({
      eventId: event.id,
      membershipId: author.membership.id,
      seasonId: theirs.id,
      body: 'from another season',
    });

    await expect(
      deleteComment({
        commentId,
        actorUserId: admin.user.id,
        actorMembershipId: admin.membership.id,
        seasonId: mine.id,
        isAdmin: true,
      }),
    ).rejects.toThrow(/WRONG_SEASON/);
  });

  it('lets an admin delete anyone’s and records who did it', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    const author = await seedMember(season.id);
    const admin = await seedMember(season.id);
    const event = await seedEvent(season.id, author.membership.id);
    const { commentId } = await addComment({
      eventId: event.id,
      membershipId: author.membership.id,
      seasonId: season.id,
      body: 'over the line',
    });

    await deleteComment({
      commentId,
      actorUserId: admin.user.id,
      actorMembershipId: admin.membership.id,
      seasonId: season.id,
      isAdmin: true,
    });

    const [row] = await db.select().from(feedComments).where(eq(feedComments.id, commentId));
    expect(row.deletedByUserId).toBe(admin.user.id);
  });

  it('reports a repeat delete as a no-op rather than erroring', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    const { user, membership } = await seedMember(season.id);
    const event = await seedEvent(season.id, membership.id);
    const { commentId } = await addComment({
      eventId: event.id,
      membershipId: membership.id,
      seasonId: season.id,
      body: 'twice',
    });

    const args = {
      commentId,
      actorUserId: user.id,
      actorMembershipId: membership.id,
      seasonId: season.id,
      isAdmin: false,
    };
    await deleteComment(args);
    expect(await deleteComment(args)).toEqual({ deleted: false });
  });
});

describe('listComments', () => {
  beforeEach(resetDb);

  it('returns comments oldest first, keeping deleted ones as tombstones', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    const { user, membership } = await seedMember(season.id);
    const event = await seedEvent(season.id, membership.id);

    const first = await addComment({
      eventId: event.id,
      membershipId: membership.id,
      seasonId: season.id,
      body: 'first',
    });
    await addComment({
      eventId: event.id,
      membershipId: membership.id,
      seasonId: season.id,
      body: 'second',
    });
    await deleteComment({
      commentId: first.commentId,
      actorUserId: user.id,
      actorMembershipId: membership.id,
      seasonId: season.id,
      isAdmin: false,
    });

    const comments = await listComments(event.id);
    expect(comments).toHaveLength(2);
    expect(comments[0].deletedAt).not.toBeNull();
    expect(comments[1].body).toBe('second');
    expect(comments[1].displayName).toBe(user.displayName);
  });
});
