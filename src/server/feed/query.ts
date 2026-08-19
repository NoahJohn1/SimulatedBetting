import { and, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  feedComments,
  feedEvents,
  feedReactions,
  seasonMemberships,
  users,
  type FeedEventType,
} from '@/db/schema';
import { getMutedTypes } from './preferences';
import type { FeedEventPayload } from './payload';

export interface FeedCursor {
  occurredAt: Date;
  id: string;
}

export interface FeedCardReaction {
  emoji: string;
  count: number;
  mine: boolean;
}

export interface FeedCard {
  id: string;
  type: FeedEventType;
  occurredAt: Date;
  /** Null only for season-wide events. Joined live, so a rename updates every old card. */
  subject: { membershipId: string; displayName: string; avatarUrl: string | null } | null;
  payload: FeedEventPayload;
  reactions: FeedCardReaction[];
  commentCount: number;
}

export interface GetSeasonFeedOptions {
  seasonId: string;
  viewerUserId: string;
  viewerMembershipId: string;
  /** Set to render one member's history on their profile. */
  subjectMembershipId?: string;
  cursor?: FeedCursor;
  limit?: number;
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 50;

/**
 * One page of a season's feed.
 *
 * Keyset-paginated on (occurred_at, id) rather than OFFSET: the feed grows at the head, and
 * with an offset an event arriving between page 1 and page 2 shifts everything down one and
 * the reader sees a duplicate.
 *
 * Three queries, never N+1 — the page, then reactions and comment counts for exactly the ids
 * on that page.
 */
export async function getSeasonFeed(
  opts: GetSeasonFeedOptions,
): Promise<{ cards: FeedCard[]; nextCursor: FeedCursor | null }> {
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const muted = await getMutedTypes(opts.viewerUserId);

  const conditions = [eq(feedEvents.seasonId, opts.seasonId)];

  if (opts.subjectMembershipId) {
    conditions.push(eq(feedEvents.subjectMembershipId, opts.subjectMembershipId));
  }
  if (muted.length > 0) {
    conditions.push(notInArray(feedEvents.type, muted));
  }
  if (opts.cursor) {
    // Row comparison, so a shared timestamp falls back to the id — the pair is unique.
    conditions.push(
      sql`(${feedEvents.occurredAt}, ${feedEvents.id}) < (${opts.cursor.occurredAt.toISOString()}::timestamptz, ${opts.cursor.id}::uuid)`,
    );
  }

  // limit + 1 is how nextCursor is decided without paying for a COUNT.
  const rows = await db
    .select({
      id: feedEvents.id,
      type: feedEvents.type,
      occurredAt: feedEvents.occurredAt,
      payload: feedEvents.payload,
      subjectMembershipId: feedEvents.subjectMembershipId,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
    })
    .from(feedEvents)
    .leftJoin(seasonMemberships, eq(feedEvents.subjectMembershipId, seasonMemberships.id))
    .leftJoin(users, eq(seasonMemberships.userId, users.id))
    .where(and(...conditions))
    .orderBy(desc(feedEvents.occurredAt), desc(feedEvents.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const ids = page.map((row) => row.id);

  const [reactionRows, commentRows] = await Promise.all([
    ids.length === 0
      ? []
      : db
          .select({
            eventId: feedReactions.eventId,
            emoji: feedReactions.emoji,
            count: sql<number>`count(*)::int`,
            mine: sql<boolean>`bool_or(${feedReactions.membershipId} = ${opts.viewerMembershipId}::uuid)`,
          })
          .from(feedReactions)
          .where(inArray(feedReactions.eventId, ids))
          .groupBy(feedReactions.eventId, feedReactions.emoji),
    ids.length === 0
      ? []
      : db
          .select({ eventId: feedComments.eventId, count: sql<number>`count(*)::int` })
          .from(feedComments)
          .where(and(inArray(feedComments.eventId, ids), isNull(feedComments.deletedAt)))
          .groupBy(feedComments.eventId),
  ]);

  const reactionsByEvent = new Map<string, FeedCardReaction[]>();
  for (const row of reactionRows) {
    const list = reactionsByEvent.get(row.eventId) ?? [];
    list.push({ emoji: row.emoji, count: row.count, mine: row.mine });
    reactionsByEvent.set(row.eventId, list);
  }

  const commentCountByEvent = new Map(commentRows.map((row) => [row.eventId, row.count]));

  const cards: FeedCard[] = page.map((row) => ({
    id: row.id,
    type: row.type,
    occurredAt: row.occurredAt,
    subject:
      row.subjectMembershipId && row.displayName
        ? {
            membershipId: row.subjectMembershipId,
            displayName: row.displayName,
            avatarUrl: row.avatarUrl,
          }
        : null,
    payload: row.payload as FeedEventPayload,
    reactions: reactionsByEvent.get(row.id) ?? [],
    commentCount: commentCountByEvent.get(row.id) ?? 0,
  }));

  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last ? { occurredAt: last.occurredAt, id: last.id } : null;

  return { cards, nextCursor };
}

/**
 * One card by id, scoped to the viewer's season.
 *
 * Returns null both when the event does not exist and when it belongs to another season, so
 * the detail page cannot be used to probe for valid ids. Mutes are deliberately NOT applied:
 * a muted type should stay out of the feed, but a card someone linked you to should still open.
 */
export async function getFeedEvent(opts: {
  eventId: string;
  seasonId: string;
  viewerUserId: string;
  viewerMembershipId: string;
}): Promise<FeedCard | null> {
  const [row] = await db
    .select({
      id: feedEvents.id,
      type: feedEvents.type,
      occurredAt: feedEvents.occurredAt,
      payload: feedEvents.payload,
      subjectMembershipId: feedEvents.subjectMembershipId,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
    })
    .from(feedEvents)
    .leftJoin(seasonMemberships, eq(feedEvents.subjectMembershipId, seasonMemberships.id))
    .leftJoin(users, eq(seasonMemberships.userId, users.id))
    .where(and(eq(feedEvents.id, opts.eventId), eq(feedEvents.seasonId, opts.seasonId)));

  if (!row) return null;

  const [reactionRows, commentRows] = await Promise.all([
    db
      .select({
        emoji: feedReactions.emoji,
        count: sql<number>`count(*)::int`,
        mine: sql<boolean>`bool_or(${feedReactions.membershipId} = ${opts.viewerMembershipId}::uuid)`,
      })
      .from(feedReactions)
      .where(eq(feedReactions.eventId, opts.eventId))
      .groupBy(feedReactions.emoji),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(feedComments)
      .where(and(eq(feedComments.eventId, opts.eventId), isNull(feedComments.deletedAt))),
  ]);

  return {
    id: row.id,
    type: row.type,
    occurredAt: row.occurredAt,
    subject:
      row.subjectMembershipId && row.displayName
        ? {
            membershipId: row.subjectMembershipId,
            displayName: row.displayName,
            avatarUrl: row.avatarUrl,
          }
        : null,
    payload: row.payload as FeedEventPayload,
    reactions: reactionRows.map((r) => ({ emoji: r.emoji, count: r.count, mine: r.mine })),
    commentCount: commentRows[0]?.count ?? 0,
  };
}
