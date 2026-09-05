'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
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

function message(error?: { code: string; retryAfterSeconds?: number }): string {
  if (!error) return 'Something went wrong.';
  if (error.code === 'RATE_LIMITED') {
    return `You're doing that too quickly. Try again in ${error.retryAfterSeconds} seconds.`;
  }
  return error.code;
}

export function WagerActions(props: WagerActionsProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  function run(
    fn: () => Promise<{ ok: boolean; error?: { code: string; retryAfterSeconds?: number } }>,
    label: { success: string; failure: string },
  ) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(message(result.error));
        toast({ tone: 'negative', title: label.failure, description: message(result.error) });
        return;
      }
      toast({ tone: 'positive', title: label.success });
      router.refresh();
    });
  }

  function runProposeCancel() {
    startTransition(async () => {
      const result = await proposeCancelAction(props.wagerId);
      if (!result.ok) {
        toast({
          tone: 'negative',
          title: 'Could not propose calling it off',
          description: message(result.error),
        });
        return;
      }
      toast({
        tone: 'positive',
        title: 'Proposed calling it off',
        description: 'Waiting on them to agree.',
      });
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
            onClick={() =>
              run(() => acceptWagerAction(props.wagerId), {
                success: 'Took the wager',
                failure: 'Could not take the wager',
              })
            }
          >
            Take it
          </button>
        )}
        {actions.canDecline && (
          <button
            type="button"
            disabled={pending}
            className={BUTTON}
            onClick={() =>
              run(() => declineWagerAction(props.wagerId), {
                success: 'Declined the wager',
                failure: 'Could not decline the wager',
              })
            }
          >
            Decline
          </button>
        )}
        {actions.canCancel && (
          <button
            type="button"
            disabled={pending}
            className={BUTTON}
            onClick={() =>
              run(() => cancelOfferAction(props.wagerId), {
                success: 'Withdrew the offer',
                failure: 'Could not withdraw the offer',
              })
            }
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
              onClick={() =>
                run(() => claimWinnerAction(props.wagerId, 'OFFERER'), {
                  success: `Claimed ${props.offererDisplayName} won`,
                  failure: 'Could not record your claim',
                })
              }
            >
              {props.offererDisplayName}
            </button>
            <button
              type="button"
              disabled={pending}
              className={props.yourClaim === 'ACCEPTOR' ? PRIMARY : BUTTON}
              onClick={() =>
                run(() => claimWinnerAction(props.wagerId, 'ACCEPTOR'), {
                  success: `Claimed ${props.acceptorDisplayName ?? 'the other side'} won`,
                  failure: 'Could not record your claim',
                })
              }
            >
              {props.acceptorDisplayName ?? 'The other side'}
            </button>
            <button
              type="button"
              disabled={pending}
              className={props.yourClaim === 'VOID' ? PRIMARY : BUTTON}
              onClick={() =>
                run(() => claimWinnerAction(props.wagerId, 'VOID'), {
                  success: 'Claimed a refund for both sides',
                  failure: 'Could not record your claim',
                })
              }
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
            onClick={() => setConfirmingCancel(true)}
          >
            {props.youProposedCancel ? 'Waiting on them to agree' : 'Propose calling it off'}
          </button>
          <p className="text-xs text-ink-muted">
            Both of you have to agree. Then you each get your own stake back.
          </p>
        </div>
      )}

      {error && <p className="text-sm text-negative">{error}</p>}

      <ConfirmDialog
        open={confirmingCancel}
        onClose={() => setConfirmingCancel(false)}
        onConfirm={runProposeCancel}
        title="Propose calling it off?"
        body="Both of you have to agree before either stake comes back."
        confirmLabel="Propose"
      />
    </div>
  );
}
