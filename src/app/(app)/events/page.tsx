import type { Metadata } from 'next';
import Link from 'next/link';
import { StatusBadge } from '@/components/ui/badge';
import { buttonClasses } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Money } from '@/components/ui/money';
import { requireApprovedMember } from '@/server/auth/session';
import { listSeasonEvents, type EventBoardRow, type EventSection } from '@/server/events/query';

const SECTION_TITLES: Record<EventSection, string> = {
  OPEN: 'Open',
  AWAITING: 'Awaiting resolution',
  SETTLED: 'Recently settled',
};

export const metadata: Metadata = { title: 'Events' };

export default async function EventsPage() {
  const member = await requireApprovedMember();
  const rows = await listSeasonEvents(member.seasonId);

  const bySection = new Map<EventSection, EventBoardRow[]>();
  for (const row of rows) {
    bySection.set(row.section, [...(bySection.get(row.section) ?? []), row]);
  }

  return (
    <div className="flex flex-col gap-6 px-4 py-4">
      <Link href="/events/new" className={buttonClasses('primary')}>
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
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">{title}</h2>
      {rows.map((row) => (
        <Link
          key={row.eventId}
          href={`/events/${row.eventId}`}
          className="flex flex-col gap-2 rounded-xl border border-line bg-surface-raised p-3 hover:border-line-hover"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">{row.title}</span>
            {row.overdue ? <StatusBadge status="Overdue" /> : null}
          </div>

          <div className="text-sm text-ink-muted">
            Created by {row.creatorDisplayName} · Closes{' '}
            {row.startsAt.toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              timeZone: 'America/New_York',
            })}
          </div>

          <div className="flex items-center justify-between border-t border-line-subtle pt-2 text-sm">
            <span className="text-ink-muted">
              {row.marketCount} market{row.marketCount === 1 ? '' : 's'}
            </span>
            <span className="text-ink-muted">
              Staked <Money cents={row.stakedCreditsCents} currency="CREDITS" />
            </span>
          </div>
        </Link>
      ))}
    </section>
  );
}
