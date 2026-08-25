import { notFound, redirect } from 'next/navigation';
import { requireApprovedMember } from '@/server/auth/session';
import { getCustomEventDetail } from '@/server/events/query';
import { ResolveForm } from './resolve-form';

export default async function ResolveEventPage({
  params,
}: PageProps<'/events/[eventId]/resolve'>) {
  const { eventId } = await params;
  const member = await requireApprovedMember();

  // The season check lives inside the query, which returns null for another season's event
  // exactly as it does for one that never existed.
  const detail = await getCustomEventDetail(eventId, member.membershipId);
  if (!detail) notFound();

  // Server-side, before anything renders: only the creator or an admin may resolve. The
  // service re-checks this itself inside its transaction — this is what keeps the wrong
  // viewer from ever seeing the form, not just from submitting it.
  if (!detail.viewerIsCreator && member.role !== 'ADMIN') {
    redirect(`/events/${eventId}`);
  }

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Resolve “{detail.title}”</h1>
        {detail.resolution.attempt > 0 ? (
          <p className="text-sm text-caution">
            This event was already resolved
            {detail.resolution.byDisplayName ? ` by ${detail.resolution.byDisplayName}` : ''}.
            Submitting here corrects it, and a note is required.
          </p>
        ) : null}
      </header>

      <ResolveForm
        eventId={detail.eventId}
        attempt={detail.resolution.attempt}
        markets={detail.markets.map((market) => ({
          marketId: market.marketId,
          title: market.title,
          outcomes: market.outcomes.map((outcome) => ({
            selectionId: outcome.selectionId,
            label: outcome.label,
          })),
        }))}
      />
    </div>
  );
}
