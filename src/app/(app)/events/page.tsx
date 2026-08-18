import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Money } from '@/components/ui/money';
import { requireApprovedMember } from '@/server/auth/session';
import { listSeasonEvents, type EventBoardRow, type EventSection } from '@/server/events/query';

const SECTION_TITLES: Record<EventSection, string> = {
  OPEN: 'Open',
  AWAITING: 'Awaiting resolution',
  SETTLED: 'Recently settled',
};

export default async function EventsPage() {
  const member = await requireApprovedMember();
  const rows = await listSeasonEvents(member.seasonId);

  const bySection = new Map<EventSection, EventBoardRow[]>();
  for (const row of rows) {
    bySection.set(row.section, [...(bySection.get(row.section) ?? []), row]);
  }

  return (
    <div className="flex flex-col gap-6 px-4 py-4">
      <Link
        href="/events/new"
        className="rounded-xl border border-zinc-900 bg-zinc-900 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-zinc-800 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        Create an event
      </Link>

      {rows.length === 0 ? (
        <EmptyState title="No events yet" body="Be the first to put an event on the board." />
      ) : (
        (['OPEN', 'AWAITING', 'SETTLED'] as const).map((section) => (
          <Section key={section} title={SECTION_TITLES[section]} rows={bySection.get(section) ?? []} />
        ))
      )}
    </div>
  );
}

function Section({ title, rows }: { title: string; rows: EventBoardRow[] }) {
  if (rows.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
      {rows.map((row) => (
        <Link
          key={row.eventId}
          href={`/events/${row.eventId}`}
          className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-3 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">{row.title}</span>
            {row.overdue ? <Badge status="Overdue" /> : null}
          </div>

          <div className="text-sm text-zinc-500">
            Created by {row.creatorDisplayName} · Closes{' '}
            {row.startsAt.toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              timeZone: 'America/New_York',
            })}
          </div>

          <div className="flex items-center justify-between border-t border-zinc-100 pt-2 text-sm dark:border-zinc-800">
            <span className="text-zinc-500">
              {row.marketCount} market{row.marketCount === 1 ? '' : 's'}
            </span>
            <span className="text-zinc-500">
              Staked <Money cents={row.stakedCreditsCents} />
            </span>
          </div>
        </Link>
      ))}
    </section>
  );
}
