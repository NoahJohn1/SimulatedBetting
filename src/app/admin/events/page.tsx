import Link from 'next/link';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { betLegs, markets, selections } from '@/db/schema';
import { Callout } from '@/components/ui/callout';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Money } from '@/components/ui/money';
import { requireAdmin } from '@/server/auth/session';
import { listAdminEventQueue } from '@/server/events/query';
import { VoidForm } from './void-form';

function formatLate(resolvesBy: Date, now: Date): string {
  const hours = Math.max(0, Math.floor((now.getTime() - resolvesBy.getTime()) / 3_600_000));
  return hours < 24 ? `${hours}h late` : `${Math.floor(hours / 24)}d late`;
}

/**
 * The void/dispute admin queue — overdue events stuck OPEN past their resolvesBy time, and
 * resolved events with at least one still-unanswered dispute.
 *
 * requireAdmin runs server-side before anything renders, exactly like `/admin` — the tab
 * being hidden from non-admins elsewhere is a courtesy, never the control. Reaching this URL
 * directly as a non-admin redirects before a single row is queried.
 */
export default async function AdminEventsPage() {
  const member = await requireAdmin();
  const now = new Date();
  const queue = await listAdminEventQueue(member.seasonId, now);

  // Open-bet counts are a small, targeted lookup for the overdue rows only — not part of
  // listAdminEventQueue's return shape, since the board rows it produces are shared with
  // listSeasonEvents' EventBoardRow and this admin-only figure doesn't belong on that type.
  const overdueIds = queue.overdue.map((row) => row.eventId);
  const openBetCounts = overdueIds.length
    ? await db
        .select({
          eventId: markets.eventId,
          count: sql<string>`COUNT(DISTINCT ${betLegs.betId})`,
        })
        .from(betLegs)
        .innerJoin(selections, eq(selections.id, betLegs.selectionId))
        .innerJoin(markets, eq(markets.id, selections.marketId))
        .where(and(inArray(markets.eventId, overdueIds), eq(betLegs.status, 'PENDING')))
        .groupBy(markets.eventId)
    : [];
  const openBetCountByEventId = new Map(
    openBetCounts.map((row) => [row.eventId, Number(row.count)]),
  );

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Event queue</h1>
        <Link href="/admin" className="text-sm text-ink-muted underline">
          Back to admin
        </Link>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Overdue</h2>

        {queue.overdue.length === 0 ? (
          <EmptyState title="Nothing is overdue" />
        ) : (
          queue.overdue.map((row) => {
            const openBets = openBetCountByEventId.get(row.eventId) ?? 0;
            return (
              <Card key={row.eventId} className="flex flex-col gap-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    href={`/events/${row.eventId}`}
                    className="text-sm font-semibold hover:underline"
                  >
                    {row.title}
                  </Link>
                  <span className="text-xs font-medium text-negative-on-surface">
                    {formatLate(row.resolvesBy, now)}
                  </span>
                </div>
                <div className="text-sm text-ink-muted">
                  Created by {row.creatorDisplayName} · {openBets} open bet{openBets === 1 ? '' : 's'}{' '}
                  · Staked <Money cents={row.stakedCreditsCents} currency="CREDITS" />
                </div>
                <VoidForm eventId={row.eventId} />
              </Card>
            );
          })
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Disputed</h2>

        {queue.disputed.length === 0 ? (
          <EmptyState title="No open disputes" />
        ) : (
          queue.disputed.map((row) => (
            <Link key={row.eventId} href={`/events/${row.eventId}/resolve`} className="block">
              <Callout tone="caution">
                <span className="text-sm font-semibold">{row.title}</span>
                <span className="text-sm">Created by {row.creatorDisplayName}</span>
                <ul className="flex flex-col gap-1">
                  {row.disputes.map((dispute, i) => (
                    <li key={i} className="text-sm">
                      <span className="font-medium">{dispute.displayName}:</span> “{dispute.reason}”
                    </li>
                  ))}
                </ul>
              </Callout>
            </Link>
          ))
        )}
      </section>
    </div>
  );
}
