import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedComments, feedEvents, feedReactions, seasonMemberships, users } from '@/db/schema';

/**
 * Six, fixed, in this order everywhere.
 *
 * An open emoji field means an unbounded GROUP BY per card, a legend nobody can read, and a
 * picker on a phone. Six covers celebration, mockery and respect, which is the entire
 * emotional range of a betting group chat.
 */
export const REACTION_EMOJI = ['🔥', '😂', '💀', '🤝', '🎯', '🤡'] as const;

export const MAX_COMMENT_LENGTH = 500;

export type FeedErrorCode =
  | 'EMOJI_NOT_ALLOWED'
  | 'EVENT_NOT_FOUND'
  | 'WRONG_SEASON'
  | 'COMMENT_EMPTY'
  | 'COMMENT_TOO_LONG'
  | 'COMMENT_NOT_FOUND'
  | 'NOT_ALLOWED';

export class FeedError extends Error {
  constructor(readonly code: FeedErrorCode) {
    super(code);
    this.name = 'FeedError';
  }
}

export function isAllowedEmoji(emoji: string): boolean {
  return (REACTION_EMOJI as readonly string[]).includes(emoji);
}

/** Every interaction confirms the event is in the actor's own season before touching it. */
async function requireEventInSeason(eventId: string, seasonId: string): Promise<void> {
  const [event] = await db
    .select({ seasonId: feedEvents.seasonId })
    .from(feedEvents)
    .where(eq(feedEvents.id, eventId));

  if (!event) throw new FeedError('EVENT_NOT_FOUND');
  if (event.seasonId !== seasonId) throw new FeedError('WRONG_SEASON');
}

export async function toggleReaction(input: {
  eventId: string;
  membershipId: string;
  seasonId: string;
  emoji: string;
}): Promise<{ active: boolean }> {
  if (!isAllowedEmoji(input.emoji)) throw new FeedError('EMOJI_NOT_ALLOWED');
  await requireEventInSeason(input.eventId, input.seasonId);

  const match = and(
    eq(feedReactions.eventId, input.eventId),
    eq(feedReactions.membershipId, input.membershipId),
    eq(feedReactions.emoji, input.emoji),
  );

  const [existing] = await db.select({ id: feedReactions.id }).from(feedReactions).where(match);

  if (existing) {
    // Hard delete — a reaction is not an audit record (D28).
    await db.delete(feedReactions).where(eq(feedReactions.id, existing.id));
    return { active: false };
  }

  await db
    .insert(feedReactions)
    .values({ eventId: input.eventId, membershipId: input.membershipId, emoji: input.emoji })
    .onConflictDoNothing();

  return { active: true };
}

export async function addComment(input: {
  eventId: string;
  membershipId: string;
  seasonId: string;
  body: string;
}): Promise<{ commentId: string }> {
  const body = input.body.trim();
  if (body.length === 0) throw new FeedError('COMMENT_EMPTY');
  if (body.length > MAX_COMMENT_LENGTH) throw new FeedError('COMMENT_TOO_LONG');

  await requireEventInSeason(input.eventId, input.seasonId);

  const [comment] = await db
    .insert(feedComments)
    .values({ eventId: input.eventId, membershipId: input.membershipId, body })
    .returning({ id: feedComments.id });

  return { commentId: comment.id };
}

/**
 * Soft delete: the row stays, the thread keeps its shape, and `deletedByUserId` records
 * whether the author or an admin removed it (D28).
 */
export async function deleteComment(input: {
  commentId: string;
  actorUserId: string;
  actorMembershipId: string;
  isAdmin: boolean;
}): Promise<{ deleted: boolean }> {
  const [comment] = await db
    .select({ membershipId: feedComments.membershipId, deletedAt: feedComments.deletedAt })
    .from(feedComments)
    .where(eq(feedComments.id, input.commentId));

  if (!comment) throw new FeedError('COMMENT_NOT_FOUND');

  const isAuthor = comment.membershipId === input.actorMembershipId;
  if (!isAuthor && !input.isAdmin) throw new FeedError('NOT_ALLOWED');

  // A double-tap on a slow connection is not an error condition.
  if (comment.deletedAt !== null) return { deleted: false };

  await db
    .update(feedComments)
    .set({ deletedAt: new Date(), deletedByUserId: input.actorUserId })
    .where(and(eq(feedComments.id, input.commentId), isNull(feedComments.deletedAt)));

  return { deleted: true };
}

export interface CommentView {
  id: string;
  membershipId: string;
  displayName: string;
  avatarUrl: string | null;
  body: string;
  createdAt: Date;
  deletedAt: Date | null;
}

/** Deleted comments come back as tombstones so the thread reads in order. */
export async function listComments(eventId: string): Promise<CommentView[]> {
  return db
    .select({
      id: feedComments.id,
      membershipId: feedComments.membershipId,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      body: feedComments.body,
      createdAt: feedComments.createdAt,
      deletedAt: feedComments.deletedAt,
    })
    .from(feedComments)
    .innerJoin(seasonMemberships, eq(feedComments.membershipId, seasonMemberships.id))
    .innerJoin(users, eq(seasonMemberships.userId, users.id))
    .where(eq(feedComments.eventId, eventId))
    .orderBy(asc(feedComments.createdAt));
}
