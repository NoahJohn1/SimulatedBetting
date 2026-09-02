'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  acceptWagerAction,
  cancelOfferAction,
  claimWinnerAction,
  declineWagerAction,
  proposeCancelAction,
} from '../actions';
import type { ViewerActions } from '@/server/p2p/query';

export interface WagerActionsProps {
  wagerId: string;
  actions: ViewerActions;
  offererDisplayName: string;
  acceptorDisplayName: string | null;
  /** What this viewer has already claimed, if anything. */
  yourClaim: 'OFFERER' | 'ACCEPTOR' | 'VOID' | null;
  youProposedCancel: boolean;
}

const BUTTON =
  'rounded-lg border border-line-strong px-3 py-2 text-sm font-medium disabled:opacity-50';
const PRIMARY =
  'rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink disabled:opacity-50';

export function WagerActions(props: WagerActionsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: { code: string } }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error?.code ?? 'Something went wrong.');
        return;
      }
      router.refresh();
    });
  }

  const { actions } = props;
  const nothing =
    !actions.canAccept &&
    !actions.canDecline &&
    !actions.canCancel &&
    !actions.canClaim &&
    !actions.canProposeCancel;

  if (nothing) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {actions.canAccept && (
          <button
            type="button"
            disabled={pending}
            className={PRIMARY}
            onClick={() => run(() => acceptWagerAction(props.wagerId))}
          >
            Take it
          </button>
        )}
        {actions.canDecline && (
          <button
            type="button"
            disabled={pending}
            className={BUTTON}
            onClick={() => run(() => declineWagerAction(props.wagerId))}
          >
            Decline
          </button>
        )}
        {actions.canCancel && (
          <button
            type="button"
            disabled={pending}
            className={BUTTON}
            onClick={() => run(() => cancelOfferAction(props.wagerId))}
          >
            Withdraw
          </button>
        )}
      </div>

      {actions.canClaim && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Who won?
          </span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              className={props.yourClaim === 'OFFERER' ? PRIMARY : BUTTON}
              onClick={() => run(() => claimWinnerAction(props.wagerId, 'OFFERER'))}
            >
              {props.offererDisplayName}
            </button>
            <button
              type="button"
              disabled={pending}
              className={props.yourClaim === 'ACCEPTOR' ? PRIMARY : BUTTON}
              onClick={() => run(() => claimWinnerAction(props.wagerId, 'ACCEPTOR'))}
            >
              {props.acceptorDisplayName ?? 'The other side'}
            </button>
            <button
              type="button"
              disabled={pending}
              className={props.yourClaim === 'VOID' ? PRIMARY : BUTTON}
              onClick={() => run(() => claimWinnerAction(props.wagerId, 'VOID'))}
            >
              Nobody — refund us
            </button>
          </div>
          <p className="text-xs text-ink-muted">
            It pays out as soon as you both say the same thing. If you disagree, an admin settles
            it.
          </p>
        </div>
      )}

      {actions.canProposeCancel && (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            disabled={pending || props.youProposedCancel}
            className={BUTTON}
            onClick={() => run(() => proposeCancelAction(props.wagerId))}
          >
            {props.youProposedCancel ? 'Waiting on them to agree' : 'Propose calling it off'}
          </button>
          <p className="text-xs text-ink-muted">
            Both of you have to agree. Then you each get your own stake back.
          </p>
        </div>
      )}

      {error && <p className="text-sm text-negative">{error}</p>}
    </div>
  );
}
