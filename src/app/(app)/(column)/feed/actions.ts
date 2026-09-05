'use server';

import { revalidatePath } from 'next/cache';
import type { FeedEventType } from '@/db/schema';
import { requireApprovedMemberOrThrow } from '@/server/auth/session';
import { addComment, deleteComment, FeedError, toggleReaction } from '@/server/feed/social';
import { getSeasonFeed, type FeedCard } from '@/server/feed/query';
import { setMutedTypes } from '@/server/feed/preferences';
import { consume } from '@/server/limits/consume';

/**
 * The feed actions have always returned a bare error *code* rather than a typed union. Keeping
 * `retryAfterSeconds` optional on one shared shape is what lets every existing
 * `return { error: err.code }` path stay exactly as it is while a caller can still read the
 * countdown — a second, separate `{ error; retryAfterSeconds }` union member would not narrow
 * under `'error' in result`, and `feed-list.tsx` needs it to.
 */
export type FeedActionError = { error: string; retryAfterSeconds?: number };

/**
 * `occurredAt` crosses the action boundary as an ISO string. Dates do survive the boundary,
 * but the cursor is round-tripped through the client and a string has exactly one
 * representation on both sides.
 */
export interface SerializedFeedCard extends Omit<FeedCard, 'occurredAt'> {
  occurredAt: string;
}

export interface SerializedFeedPage {
  cards: SerializedFeedCard[];
  nextCursor: { occurredAt: string; id: string } | null;
}

function serialize(page: Awaited<ReturnType<typeof getSeasonFeed>>): SerializedFeedPage {
  return {
    cards: page.cards.map((card) => ({ ...card, occurredAt: card.occurredAt.toISOString() })),
    nextCursor: page.nextCursor
      ? { occurredAt: page.nextCursor.occurredAt.toISOString(), id: page.nextCursor.id }
      : null,
  };
}

export async function loadMoreFeedAction(cursor: {
  occurredAt: string;
  id: string;
}): Promise<SerializedFeedPage> {
  const member = await requireApprovedMemberOrThrow();

  // The season comes from the session, never from the client — otherwise a crafted request
  // reads another league's feed.
  const page = await getSeasonFeed({
    seasonId: member.seasonId,
    viewerUserId: member.userId,
    viewerMembershipId: member.membershipId,
    cursor: { occurredAt: new Date(cursor.occurredAt), id: cursor.id },
  });

  return serialize(page);
}

export async function toggleReactionAction(
  eventId: string,
  emoji: string,
): Promise<{ active: boolean } | FeedActionError> {
  const member = await requireApprovedMemberOrThrow();

  const limited = await consume(member.userId, 'REACTION');
  if (limited) return { error: limited.code, retryAfterSeconds: limited.retryAfterSeconds };

  try {
    const result = await toggleReaction({
      eventId,
      membershipId: member.membershipId,
      seasonId: member.seasonId,
      emoji,
    });
    revalidatePath('/feed');
    revalidatePath(`/feed/${eventId}`);
    return result;
  } catch (err) {
    if (err instanceof FeedError) return { error: err.code };
    throw err;
  }
}

export async function addCommentAction(
  eventId: string,
  body: string,
): Promise<{ commentId: string } | FeedActionError> {
  const member = await requireApprovedMemberOrThrow();

  const limited = await consume(member.userId, 'COMMENT');
  if (limited) return { error: limited.code, retryAfterSeconds: limited.retryAfterSeconds };

  try {
    const result = await addComment({
      eventId,
      membershipId: member.membershipId,
      seasonId: member.seasonId,
      body,
    });
    revalidatePath('/feed');
    revalidatePath(`/feed/${eventId}`);
    return result;
  } catch (err) {
    if (err instanceof FeedError) return { error: err.code };
    throw err;
  }
}

export async function deleteCommentAction(
  commentId: string,
  eventId: string,
): Promise<{ deleted: boolean } | FeedActionError> {
  const member = await requireApprovedMemberOrThrow();

  const limited = await consume(member.userId, 'COMMENT');
  if (limited) return { error: limited.code, retryAfterSeconds: limited.retryAfterSeconds };

  try {
    const result = await deleteComment({
      commentId,
      actorUserId: member.userId,
      actorMembershipId: member.membershipId,
      seasonId: member.seasonId,
      isAdmin: member.role === 'ADMIN',
    });
    revalidatePath(`/feed/${eventId}`);
    revalidatePath('/feed');
    return result;
  } catch (err) {
    if (err instanceof FeedError) return { error: err.code };
    throw err;
  }
}

/**
 * Kept here rather than inline in the feed-preferences page so a client component can import
 * a real module-level server action rather than one passed down as a prop.
 */
export async function saveFeedPreferencesAction(
  mutedTypes: FeedEventType[],
): Promise<{ saved: true } | FeedActionError> {
  const member = await requireApprovedMemberOrThrow();

  const limited = await consume(member.userId, 'DEFAULT');
  if (limited) return { error: limited.code, retryAfterSeconds: limited.retryAfterSeconds };

  await setMutedTypes(member.userId, mutedTypes);
  revalidatePath('/feed');
  revalidatePath('/me/feed-preferences');
  return { saved: true };
}
