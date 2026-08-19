'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { OfferWagerError } from '@/server/p2p/types';
import { offerWagerAction } from '../actions';

export interface MemberOption {
  membershipId: string;
  displayName: string;
}

/** Cents in, cents out — the form speaks the same integer language the ledger does. */
function toCents(input: string): string {
  const trimmed = input.trim();
  if (!/^\d+$/.test(trimmed)) return '';
  return trimmed;
}

function describe(error: OfferWagerError): string {
  switch (error.code) {
    case 'NOT_A_MEMBER':
      return 'You are not a member of the active season.';
    case 'INSUFFICIENT_CREDITS':
      return `You only have ${error.availableCents.toString()} credits.`;
    case 'INVALID_STAKE':
      return 'Both stakes must be more than zero.';
    case 'INVALID_WINDOW':
      return 'The offer must expire in the future, before the event, and before the settle-by date.';
    case 'OPPONENT_IS_SELF':
      return 'You cannot challenge yourself.';
    case 'OPPONENT_NOT_IN_SEASON':
      return 'That member is not in this season.';
    case 'WRONG_KIND_FIELDS':
      return 'Fill in the description, or the selection — whichever this wager is.';
    case 'SELECTION_NOT_FOUND':
      return 'No selection with that id.';
    case 'MARKET_NOT_OPEN':
      return 'That market is not taking action right now.';
    case 'EVENT_ALREADY_STARTED':
      return 'That event has already started.';
    default:
      return 'Could not post the offer.';
  }
}

const fieldClass =
  'rounded-lg border border-zinc-300 p-2 text-sm dark:border-zinc-700 dark:bg-zinc-900';

export function WagerForm({ members }: { members: MemberOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<'FREEFORM' | 'MARKET'>('FREEFORM');
  const [opponent, setOpponent] = useState('');
  const [offererStake, setOffererStake] = useState('');
  const [acceptorStake, setAcceptorStake] = useState('');
  const [description, setDescription] = useState('');
  const [selectionId, setSelectionId] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [resolvesBy, setResolvesBy] = useState('');

  function submit() {
    setError(null);

    const offererCents = toCents(offererStake);
    const acceptorCents = toCents(acceptorStake);
    if (!offererCents || !acceptorCents) {
      setError('Both stakes must be whole numbers of credits.');
      return;
    }
    if (!expiresAt || !resolvesBy) {
      setError('An offer needs an expiry and a resolve-by date.');
      return;
    }

    startTransition(async () => {
      const result = await offerWagerAction({
        kind,
        opponentMembershipId: opponent || null,
        offererStakeCents: offererCents,
        acceptorStakeCents: acceptorCents,
        selectionId: kind === 'MARKET' ? selectionId.trim() : undefined,
        description: kind === 'FREEFORM' ? description : undefined,
        expiresAt: new Date(expiresAt).toISOString(),
        resolvesBy: new Date(resolvesBy).toISOString(),
      });

      if (result.ok) {
        router.push(`/wagers/${result.wagerId}`);
        return;
      }
      setError(describe(result.error));
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-4"
    >
      <div className="flex gap-2">
        {(['FREEFORM', 'MARKET'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              kind === k
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
            }`}
          >
            {k === 'FREEFORM' ? 'Anything' : 'A game or event'}
          </button>
        ))}
      </div>

      {kind === 'FREEFORM' ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">What is the bet?</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className={fieldClass}
            placeholder="Jake cannot name ten starting quarterbacks"
          />
        </label>
      ) : (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Selection id</span>
          <input
            value={selectionId}
            onChange={(e) => setSelectionId(e.target.value)}
            className={`${fieldClass} font-mono text-xs`}
            placeholder="the selection you are taking"
          />
        </label>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Who?</span>
        <select value={opponent} onChange={(e) => setOpponent(e.target.value)} className={fieldClass}>
          <option value="">Open to the season</option>
          {members.map((m) => (
            <option key={m.membershipId} value={m.membershipId}>
              {m.displayName}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">You put up</span>
          <input
            value={offererStake}
            onChange={(e) => setOffererStake(e.target.value)}
            inputMode="numeric"
            className={fieldClass}
            placeholder="credits"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">They put up</span>
          <input
            value={acceptorStake}
            onChange={(e) => setAcceptorStake(e.target.value)}
            inputMode="numeric"
            className={fieldClass}
            placeholder="credits"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Offer expires</span>
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Settled by</span>
          <input
            type="datetime-local"
            value={resolvesBy}
            onChange={(e) => setResolvesBy(e.target.value)}
            className={fieldClass}
          />
        </label>
      </div>

      <p className="text-xs text-zinc-500">
        Your stake is held the moment you post this. Withdraw it any time before someone accepts
        and it comes straight back.
      </p>

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {pending ? 'Posting…' : 'Post the offer'}
      </button>
    </form>
  );
}
