import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
import { requireApprovedMember } from '@/server/auth/session';
import { getSeasonFeed } from '@/server/feed/query';
import { FeedList } from './feed-list';

export const metadata: Metadata = { title: 'Feed' };

export default async function FeedPage() {
  const member = await requireApprovedMember();

  const page = await getSeasonFeed({
    seasonId: member.seasonId,
    viewerUserId: member.userId,
    viewerMembershipId: member.membershipId,
  });

  const serialized = {
    cards: page.cards.map((card) => ({ ...card, occurredAt: card.occurredAt.toISOString() })),
    nextCursor: page.nextCursor
      ? { occurredAt: page.nextCursor.occurredAt.toISOString(), id: page.nextCursor.id }
      : null,
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-end px-4 pt-3">
        <Link href="/me/feed-preferences" className="text-xs text-ink-muted hover:underline">
          Filters
        </Link>
      </div>

      {serialized.cards.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          body="Bets, settlements and milestones show up here as they happen."
        />
      ) : (
        <FeedList initial={serialized} />
      )}
    </div>
  );
}
