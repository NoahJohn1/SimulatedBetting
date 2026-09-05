import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireApprovedMember } from '@/server/auth/session';
import { getFeedEvent } from '@/server/feed/query';
import { listComments } from '@/server/feed/social';
import { feedCardHeadline, FeedCardView } from '../feed-card';
import { CommentThread, type ThreadComment } from './comment-thread';

const TITLE_MAX_LENGTH = 60;

export async function generateMetadata({
  params,
}: PageProps<'/feed/[eventId]'>): Promise<Metadata> {
  const { eventId } = await params;
  const member = await requireApprovedMember();

  const card = await getFeedEvent({
    eventId,
    seasonId: member.seasonId,
    viewerUserId: member.userId,
    viewerMembershipId: member.membershipId,
  });

  // Another season's event is indistinguishable from a missing one here too — no title to
  // leak, same as the page body below.
  if (!card) return {};

  const title = feedCardHeadline({
    ...card,
    occurredAt: card.occurredAt.toISOString(),
  }).slice(0, TITLE_MAX_LENGTH);

  return { title };
}

export default async function FeedEventPage({ params }: PageProps<'/feed/[eventId]'>) {
  const { eventId } = await params;
  const member = await requireApprovedMember();

  const card = await getFeedEvent({
    eventId,
    seasonId: member.seasonId,
    viewerUserId: member.userId,
    viewerMembershipId: member.membershipId,
  });

  // Another season's event is indistinguishable from a missing one, on purpose.
  if (!card) notFound();

  const comments = await listComments(eventId);

  const thread: ThreadComment[] = comments.map((comment) => ({
    id: comment.id,
    membershipId: comment.membershipId,
    displayName: comment.displayName,
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
    deleted: comment.deletedAt !== null,
    canDelete:
      comment.deletedAt === null &&
      (comment.membershipId === member.membershipId || member.role === 'ADMIN'),
  }));

  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="px-4">
        <Link href="/feed" className="text-xs text-ink-muted hover:underline">
          ← Feed
        </Link>
      </div>
      <div className="px-4">
        <FeedCardView card={{ ...card, occurredAt: card.occurredAt.toISOString() }} />
      </div>
      <CommentThread eventId={eventId} comments={thread} />
    </div>
  );
}
