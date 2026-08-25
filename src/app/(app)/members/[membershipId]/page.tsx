import { notFound } from 'next/navigation';
import { StatusBadge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Money } from '@/components/ui/money';
import { requireApprovedMember } from '@/server/auth/session';
import { getSeasonFeed } from '@/server/feed/query';
import { getMemberProfile } from '@/server/feed/stats';
import { loadHeadToHead } from '@/server/p2p/query';
import { FeedCardView } from '../../feed/feed-card';

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-0.5 p-3">
      <span className="text-xs uppercase tracking-wide text-ink-muted">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{children}</span>
    </Card>
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
          <span className="text-xs text-ink-muted">Rank #{profile.rank}</span>
        </div>
        <div className="flex items-center gap-2">
          {profile.status === 'DISABLED' ? <StatusBadge status="DISABLED" /> : null}
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
        <section className="flex flex-col gap-2 rounded-lg border border-line p-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            You vs them
          </h2>
          {headToHead.settled === 0 && headToHead.voided === 0 ? (
            <p className="text-sm text-ink-muted">You have never wagered against each other.</p>
          ) : (
            <p className="text-sm">
              <span className="font-medium">
                {headToHead.aWon}–{headToHead.bWon}
              </span>
              {headToHead.voided > 0 && ` (${headToHead.voided} called off)`}, and you are{' '}
              <span className="font-medium">
                {headToHead.netCentsForA >= 0n ? 'up' : 'down'}{' '}
                <Money
                  cents={headToHead.netCentsForA < 0n ? -headToHead.netCentsForA : headToHead.netCentsForA}
                  currency="CREDITS"
                />
              </span>
              .
            </p>
          )}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Recent</h2>
        {history.cards.length === 0 ? (
          <p className="text-sm text-ink-muted">No activity yet.</p>
        ) : (
          history.cards.map((card) => (
            <FeedCardView key={card.id} card={{ ...card, occurredAt: card.occurredAt.toISOString() }} />
          ))
        )}
      </section>
    </div>
  );
}
