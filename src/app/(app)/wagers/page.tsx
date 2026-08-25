import type { Metadata } from 'next';
import Link from 'next/link';
import { buttonClasses } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Money } from '@/components/ui/money';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { requireApprovedMember } from '@/server/auth/session';
import { loadWagerBoard, type WagerSummary } from '@/server/p2p/query';

export const metadata: Metadata = { title: 'Wagers' };

function WagerRow({ wager }: { wager: WagerSummary }) {
  const parties = wager.acceptorDisplayName
    ? `${wager.offererDisplayName} vs ${wager.acceptorDisplayName}`
    : `${wager.offererDisplayName} — open`;

  return (
    <Link
      href={`/wagers/${wager.id}`}
      className="flex flex-col gap-1 rounded-lg border border-line p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{wager.subject}</span>
        <Money cents={wager.potCents} currency="CREDITS" />
      </div>
      <div className="flex items-center gap-2 text-xs text-ink-muted">
        <span>{parties}</span>
        {wager.disputed && <span className="font-medium text-caution">disputed</span>}
        {wager.overdue && <span className="font-medium text-caution">overdue</span>}
      </div>
      <div className="text-xs text-ink-subtle">
        <Money cents={wager.offererStakeCents} currency="CREDITS" /> against{' '}
        <Money cents={wager.acceptorStakeCents} currency="CREDITS" />
      </div>
    </Link>
  );
}

function Section({ title, wagers }: { title: string; wagers: WagerSummary[] }) {
  if (wagers.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">{title}</h2>
      {wagers.map((w) => (
        <WagerRow key={w.id} wager={w} />
      ))}
    </section>
  );
}

export default async function WagersPage() {
  const member = await requireApprovedMember();
  const board = await loadWagerBoard(member.membershipId, member.seasonId);

  const empty =
    board.openOffers.length === 0 &&
    board.offersToYou.length === 0 &&
    board.yourOffers.length === 0 &&
    board.liveWagers.length === 0 &&
    board.settledWagers.length === 0;

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <SegmentedControl
        label="Bets or wagers"
        segments={[
          { href: '/bets', label: 'Bets', active: false },
          { href: '/wagers', label: 'Wagers', active: true },
        ]}
      />

      <Link href="/wagers/new" className={buttonClasses('primary')}>
        Offer a wager
      </Link>

      {empty ? (
        <EmptyState title="No wagers yet" body="Offer one and see who takes the other side." />
      ) : (
        <>
          <Section title="Awaiting your call" wagers={board.awaitingYourClaim} />
          <Section title="Challenges to you" wagers={board.offersToYou} />
          <Section title="Open to the season" wagers={board.openOffers} />
          <Section title="Your open offers" wagers={board.yourOffers} />
          <Section title="Live" wagers={board.liveWagers} />
          <Section title="Finished" wagers={board.settledWagers} />
        </>
      )}
    </div>
  );
}
