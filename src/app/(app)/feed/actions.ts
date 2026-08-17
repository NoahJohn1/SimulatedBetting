'use server';

import { revalidatePath } from 'next/cache';
import type { FeedEventType } from '@/db/schema';
import { requireApprovedMemberOrThrow } from '@/server/auth/session';
import { addComment, deleteComment, FeedError, toggleReaction } from '@/server/feed/social';
import { getSeasonFeed, type FeedCard } from '@/server/feed/query';
import { setMutedTypes } from '@/server/feed/preferences';

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
): Promise<{ active: boolean } | { error: string }> {
  const member = await requireApprovedMemberOrThrow();

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
): Promise<{ commentId: string } | { error: string }> {
  const member = await requireApprovedMemberOrThrow();

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
): Promise<{ deleted: boolean } | { error: string }> {
  const member = await requireApprovedMemberOrThrow();

  try {
    const result = await deleteComment({
      commentId,
      actorUserId: member.userId,
      actorMembershipId: member.membershipId,
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
): Promise<{ saved: true }> {
  const member = await requireApprovedMemberOrThrow();
  await setMutedTypes(member.userId, mutedTypes);
  revalidatePath('/feed');
  revalidatePath('/me/feed-preferences');
  return { saved: true };
}
