import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Money } from '@/components/ui/money';
import { requireApprovedMember } from '@/server/auth/session';
import { getSeasonFeed } from '@/server/feed/query';
import { getMemberProfile } from '@/server/feed/stats';
import { loadHeadToHead } from '@/server/p2p/query';
import { FeedCardView } from '../../feed/feed-card';

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <span className="text-xs uppercase tracking-wide text-zinc-500">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{children}</span>
    </div>
  );
}

export default async function MemberProfilePage({ params }: PageProps<'/members/[membershipId]'>) {
  const { membershipId } = await params;
  const member = await requireApprovedMember();

  const profile = await getMemberProfile({ membershipId, seasonId: member.seasonId });
  if (!profile) notFound();

  const history = await getSeasonFeed({
    seasonId: member.seasonId,
    viewerUserId: member.userId,
    viewerMembershipId: member.membershipId,
    subjectMembershipId: membershipId,
    limit: 20,
  });

  const isSelf = membershipId === member.membershipId;
  const headToHead = isSelf
    ? null
    : await loadHeadToHead(member.seasonId, member.membershipId, membershipId);

  const { stats } = profile;
  const roi = stats.roiBasisPoints === null ? '—' : `${(stats.roiBasisPoints / 100).toFixed(1)}%`;
  const streak =
    stats.currentStreak.kind === 'NONE' ? '—' : `${stats.currentStreak.kind}${stats.currentStreak.length}`;

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">{profile.displayName}</h1>
          <span className="text-xs text-zinc-500">Rank #{profile.rank}</span>
        </div>
        <div className="flex items-center gap-2">
          {profile.status === 'DISABLED' ? <Badge status="DISABLED" /> : null}
          <Money cents={profile.balanceCents} className="text-base font-semibold" />
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Record">
          {stats.won}-{stats.lost}
          {stats.pushed > 0 ? `-${stats.pushed}` : ''}
        </Stat>
        <Stat label="ROI">{roi}</Stat>
        <Stat label="Net">
          <Money cents={stats.netCents} />
        </Stat>
        <Stat label="Streak">{streak}</Stat>
        <Stat label="Biggest win">
          <Money cents={stats.biggestWinCents} />
        </Stat>
        <Stat label="Pending">
          {stats.pending} · <Money cents={stats.pendingStakeCents} />
        </Stat>
      </div>

      {headToHead && (
        <section className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            You vs them
          </h2>
          {headToHead.settled === 0 && headToHead.voided === 0 ? (
            <p className="text-sm text-zinc-500">You have never wagered against each other.</p>
          ) : (
            <p className="text-sm">
              <span className="font-medium">
                {headToHead.aWon}–{headToHead.bWon}
              </span>
              {headToHead.voided > 0 && ` (${headToHead.voided} called off)`}, and you are{' '}
              <span className="font-medium">
                {headToHead.netCentsForA >= 0n ? 'up' : 'down'}{' '}
                {(headToHead.netCentsForA < 0n
                  ? -headToHead.netCentsForA
                  : headToHead.netCentsForA
                ).toString()}
              </span>{' '}
              credits.
            </p>
          )}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Recent</h2>
        {history.cards.length === 0 ? (
          <p className="text-sm text-zinc-500">No activity yet.</p>
        ) : (
          history.cards.map((card) => (
            <FeedCardView key={card.id} card={{ ...card, occurredAt: card.occurredAt.toISOString() }} />
          ))
        )}
      </section>
    </div>
  );
}
