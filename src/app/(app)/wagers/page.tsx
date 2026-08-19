import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
import { Money } from '@/components/ui/money';
import { requireApprovedMember } from '@/server/auth/session';
import { loadWagerBoard, type WagerSummary } from '@/server/p2p/query';

function WagerRow({ wager }: { wager: WagerSummary }) {
  const parties = wager.acceptorDisplayName
    ? `${wager.offererDisplayName} vs ${wager.acceptorDisplayName}`
    : `${wager.offererDisplayName} — open`;

  return (
    <Link
      href={`/wagers/${wager.id}`}
      className="flex flex-col gap-1 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{wager.subject}</span>
        <Money cents={wager.potCents} currency="CREDITS" />
      </div>
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <span>{parties}</span>
        {wager.disputed && <span className="font-medium text-amber-600">disputed</span>}
        {wager.overdue && <span className="font-medium text-amber-600">overdue</span>}
      </div>
      <div className="text-xs text-zinc-400">
        {wager.offererStakeCents.toString()} against {wager.acceptorStakeCents.toString()} credits
      </div>
    </Link>
  );
}

function Section({ title, wagers }: { title: string; wagers: WagerSummary[] }) {
  if (wagers.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
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
      <div className="flex gap-2 px-1">
        <Link
          href="/bets"
          className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
        >
          Bets
        </Link>
        <span className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
          Wagers
        </span>
      </div>

      <Link
        href="/wagers/new"
        className="rounded-lg bg-zinc-900 px-4 py-2 text-center text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
      >
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
