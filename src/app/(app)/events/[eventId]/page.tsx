import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StatusBadge } from '@/components/ui/badge';
import { buttonClasses } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Money } from '@/components/ui/money';
import { requireApprovedMember } from '@/server/auth/session';
import { getCustomEventDetail } from '@/server/events/query';
import { DisputeForm } from './dispute-form';
import { MarketCard, type MarketCardPosition } from './market-card';

function when(date: Date): string {
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });
}

export default async function CustomEventPage({ params }: PageProps<'/events/[eventId]'>) {
  const { eventId } = await params;
  const member = await requireApprovedMember();

  // The season check lives inside the query, which returns null for another season's event
  // exactly as it does for one that never existed.
  const detail = await getCustomEventDetail(eventId, member.membershipId);
  if (!detail) notFound();

  const now = new Date();
  const bettable = detail.status === 'OPEN' && detail.startsAt > now;
  const canManage = detail.status === 'OPEN' && (detail.viewerIsCreator || member.role === 'ADMIN');

  // Every credit staked anywhere on the event, which is exactly what editing requires to be
  // zero. The server re-checks it inside the transaction; this only decides what to show.
  const stakedCents = detail.markets.reduce(
    (total, market) =>
      total + market.outcomes.reduce((sum, outcome) => sum + outcome.stakedCreditsCents, 0n),
    0n,
  );
  const canEdit = detail.status === 'OPEN' && detail.viewerIsCreator && stakedCents === 0n;

  // Only an open (unresolved) dispute counts here — a dispute that was answered by a
  // correction no longer blocks the viewer from being shown the form again.
  const viewerDispute = detail.openDisputes.find(
    (dispute) => dispute.membershipId === member.membershipId,
  );

  const positionsByMarket = new Map<string, MarketCardPosition[]>();
  for (const position of detail.creatorPositions) {
    positionsByMarket.set(position.marketId, [
      ...(positionsByMarket.get(position.marketId) ?? []),
      {
        selectionId: position.selectionId,
        stakeCents: position.stakeCents.toString(),
        status: null,
        holder: 'creator',
      },
    ]);
  }
  // A creator looking at their own event sees the disclosure line, not a duplicate of it —
  // the two lists are the same rows when the viewer is the creator.
  for (const position of detail.viewerIsCreator ? [] : detail.viewerPositions) {
    positionsByMarket.set(position.marketId, [
      ...(positionsByMarket.get(position.marketId) ?? []),
      {
        selectionId: position.selectionId,
        stakeCents: position.stakeCents.toString(),
        status: position.status,
        holder: 'you',
      },
    ]);
  }

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <header className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-lg font-semibold">{detail.title}</h1>
          <div className="flex shrink-0 items-center gap-2">
            {detail.overdue ? <StatusBadge status="Overdue" /> : null}
            <StatusBadge status={detail.status} />
          </div>
        </div>

        {detail.description ? (
          <p className="whitespace-pre-line text-sm text-ink-secondary">{detail.description}</p>
        ) : null}

        <p className="text-sm text-ink-muted">Created by {detail.creator.displayName}</p>
        <p className="text-sm text-ink-muted">
          Closes {when(detail.startsAt)} ET · Resolves by {when(detail.resolvesBy)} ET
        </p>
        <p className="text-sm text-ink-muted">
          <Money cents={stakedCents} currency="CREDITS" /> staked in credits
        </p>
      </header>

      {detail.markets.map((market) => (
        <MarketCard
          key={market.marketId}
          eventId={detail.eventId}
          marketId={market.marketId}
          title={market.title}
          status={market.status}
          winningSelectionId={market.winningSelectionId}
          outcomes={market.outcomes.map((outcome) => ({
            selectionId: outcome.selectionId,
            label: outcome.label,
            priceAmerican: outcome.priceAmerican,
            stakedCreditsCents: outcome.stakedCreditsCents.toString(),
          }))}
          positions={positionsByMarket.get(market.marketId) ?? []}
          bettable={bettable}
          canManage={canManage}
          canEdit={canEdit}
        />
      ))}

      {detail.resolution.resolvedAt ? (
        <section className="flex flex-col gap-1 rounded-xl border border-line bg-surface-raised p-3 text-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Resolution
          </h2>
          <p className="text-ink-secondary">
            {detail.status === 'VOIDED' ? 'Voided' : 'Resolved'} by{' '}
            {detail.resolution.byDisplayName ?? 'a member'} on {when(detail.resolution.resolvedAt)}{' '}
            ET
            {detail.resolution.attempt > 1 ? ` · correction #${detail.resolution.attempt - 1}` : ''}
          </p>
          {detail.resolution.note ? <p className="text-ink-secondary">“{detail.resolution.note}”</p> : null}
        </section>
      ) : null}

      {detail.openDisputes.length > 0 ? (
        <Callout tone="caution">
          <h2 className="text-xs font-semibold uppercase tracking-wide">
            Open {detail.openDisputes.length === 1 ? 'dispute' : 'disputes'}
          </h2>
          {detail.openDisputes.map((dispute, i) => (
            <p key={i}>
              <span className="font-medium">{dispute.displayName}</span>: “{dispute.reason}”
            </p>
          ))}
        </Callout>
      ) : null}

      {canManage ? (
        <Link
          href={`/events/${detail.eventId}/resolve`}
          className={`self-start ${buttonClasses('primary')}`}
        >
          Resolve event
        </Link>
      ) : null}

      {detail.status === 'RESOLVED' ? (
        <DisputeForm
          eventId={detail.eventId}
          alreadyDisputed={viewerDispute !== undefined}
          existingReason={viewerDispute?.reason ?? null}
        />
      ) : null}
    </div>
  );
}
