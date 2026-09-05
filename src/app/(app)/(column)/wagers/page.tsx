import type { Metadata } from 'next';
import Link from 'next/link';
import { buttonClasses } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Money } from '@/components/ui/money';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { requireApprovedMember } from '@/server/auth/session';
import { loadWagerBoard, type WagerSummary } from '@/server/p2p/query';
import { sectionFor, type WagerSection } from './sections';

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
      <div className="text-xs text-ink-muted">
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

  // One section per wager (the walk found a wager double-listed — `board.liveWagers` and
  // `board.awaitingYourClaim` overlap by construction, since every claimable wager is also
  // accepted). `awaitingYourClaim` is left out of the pool below for exactly that reason: it
  // is a subset of `liveWagers`, and `sectionFor` recovers it from there.
  const pool = [
    ...board.openOffers,
    ...board.offersToYou,
    ...board.yourOffers,
    ...board.liveWagers,
    ...board.settledWagers,
  ];

  const bySection = new Map<WagerSection, WagerSummary[]>();
  for (const wager of pool) {
    const section = sectionFor(wager, member.membershipId);
    bySection.set(section, [...(bySection.get(section) ?? []), wager]);
  }

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          label="Bets or wagers"
          segments={[
            { href: '/bets', label: 'Bets', active: false },
            { href: '/wagers', label: 'Wagers', active: true },
          ]}
        />
      </div>

      <Link href="/wagers/new" className={buttonClasses('primary')}>
        Offer a wager
      </Link>

      {pool.length === 0 ? (
        <EmptyState title="No wagers yet" body="Offer one and see who takes the other side." />
      ) : (
        <>
          <Section title="Awaiting your call" wagers={bySection.get('AWAITING_YOUR_CALL') ?? []} />
          <Section title="Challenges to you" wagers={bySection.get('INVITES') ?? []} />
          <Section title="Open to the season" wagers={bySection.get('OPEN_TO_THE_SEASON') ?? []} />
          <Section title="Live" wagers={bySection.get('LIVE') ?? []} />
          <Section title="Finished" wagers={bySection.get('SETTLED') ?? []} />
        </>
      )}
    </div>
  );
}
