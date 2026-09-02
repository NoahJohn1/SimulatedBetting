import { notFound } from 'next/navigation';
import { StatusBadge } from '@/components/ui/badge';
import { Money } from '@/components/ui/money';
import { requireApprovedMember } from '@/server/auth/session';
import { loadWagerDetail } from '@/server/p2p/query';
import { WagerActions } from './wager-actions';

export default async function WagerDetailPage({ params }: PageProps<'/wagers/[wagerId]'>) {
  const member = await requireApprovedMember();
  const { wagerId } = await params;

  const wager = await loadWagerDetail(wagerId, member.membershipId);
  if (!wager) notFound();

  const isOfferer = wager.offererMembershipId === member.membershipId;
  const yourClaim = isOfferer ? wager.offererClaim : wager.acceptorClaim;
  const youProposedCancel = isOfferer ? wager.offererCancelProposed : wager.acceptorCancelProposed;

  const winner =
    wager.verdict === 'OFFERER'
      ? wager.offererDisplayName
      : wager.verdict === 'ACCEPTOR'
        ? wager.acceptorDisplayName
        : null;

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <StatusBadge status={wager.status} />
          {wager.disputed && <StatusBadge status="Disputed" />}
          {wager.overdue && <StatusBadge status="Overdue" />}
        </div>
        <h1 className="text-lg font-semibold">{wager.subject}</h1>
      </div>

      <dl className="flex flex-col gap-2 rounded-lg border border-line p-3 text-sm">
        <div className="flex justify-between">
          <dt className="text-ink-muted">{wager.offererDisplayName} puts up</dt>
          <dd>
            <Money cents={wager.offererStakeCents} currency="CREDITS" />
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-muted">
            {wager.acceptorDisplayName ?? 'Whoever takes it'} puts up
          </dt>
          <dd>
            <Money cents={wager.acceptorStakeCents} currency="CREDITS" />
          </dd>
        </div>
        <div className="flex justify-between font-medium">
          <dt>Pot</dt>
          <dd>
            <Money cents={wager.potCents} currency="CREDITS" />
          </dd>
        </div>
        {wager.lineAtOffer && (
          <div className="flex justify-between">
            <dt className="text-ink-muted">Line when offered</dt>
            <dd>{wager.lineAtOffer}</dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt className="text-ink-muted">Settled by</dt>
          <dd>{wager.resolvesBy.toLocaleString()}</dd>
        </div>
      </dl>

      {winner && (
        <p className="text-sm">
          <span className="font-medium">{winner}</span> took the pot.
        </p>
      )}
      {wager.verdict === 'VOID' && <p className="text-sm">Called off — both stakes went back.</p>}
      {wager.resolutionNote && (
        <p className="rounded-lg bg-surface-muted p-3 text-sm">
          <span className="font-medium">Admin: </span>
          {wager.resolutionNote}
        </p>
      )}

      <WagerActions
        wagerId={wager.id}
        actions={wager.actions}
        offererDisplayName={wager.offererDisplayName}
        acceptorDisplayName={wager.acceptorDisplayName}
        yourClaim={yourClaim}
        youProposedCancel={youProposedCancel}
      />
    </div>
  );
}
