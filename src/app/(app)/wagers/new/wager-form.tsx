'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { FormField } from '@/components/ui/form-field';
import { dollarsToCents, formatAmount } from '@/domain/money';
import type { OfferWagerError } from '@/server/p2p/types';
import { offerWagerAction } from '../actions';

export interface MemberOption {
  membershipId: string;
  displayName: string;
}

/**
 * Dollars/credits in, cents out — matches `bet-slip.tsx`'s stake parsing (D31): the digits a
 * member types are a credits amount, not raw cents, so `25` must become `2500`.
 */
function toCents(input: string): string {
  const trimmed = input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return '';
  try {
    return dollarsToCents(trimmed).toString();
  } catch {
    return '';
  }
}

function describe(error: OfferWagerError): string {
  switch (error.code) {
    case 'NOT_A_MEMBER':
      return 'You are not a member of the active season.';
    case 'INSUFFICIENT_CREDITS':
      return `You only have ${formatAmount(error.availableCents, 'CREDITS')}.`;
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

const fieldClass = 'rounded-lg border border-line-strong bg-surface-sunken p-2 text-sm';

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
      setError('Enter a stake like 25 or 25.50.');
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
              kind === k ? 'bg-accent text-accent-ink' : 'bg-surface-muted text-ink-secondary'
            }`}
          >
            {k === 'FREEFORM' ? 'Anything' : 'A game or event'}
          </button>
        ))}
      </div>

      {kind === 'FREEFORM' ? (
        <FormField label="What is the bet?" htmlFor="wager-description">
          <textarea
            id="wager-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className={fieldClass}
            placeholder="Jake cannot name ten starting quarterbacks"
          />
        </FormField>
      ) : (
        <FormField label="Selection id" htmlFor="wager-selection">
          <input
            id="wager-selection"
            value={selectionId}
            onChange={(e) => setSelectionId(e.target.value)}
            className={`${fieldClass} font-mono text-xs`}
            placeholder="the selection you are taking"
          />
        </FormField>
      )}

      <FormField label="Who?" htmlFor="wager-opponent">
        <select
          id="wager-opponent"
          value={opponent}
          onChange={(e) => setOpponent(e.target.value)}
          className={fieldClass}
        >
          <option value="">Open to the season</option>
          {members.map((m) => (
            <option key={m.membershipId} value={m.membershipId}>
              {m.displayName}
            </option>
          ))}
        </select>
      </FormField>

      <div className="grid grid-cols-2 gap-2">
        <FormField label="You put up" htmlFor="wager-offerer-stake">
          <input
            id="wager-offerer-stake"
            value={offererStake}
            onChange={(e) => setOffererStake(e.target.value)}
            inputMode="decimal"
            className={fieldClass}
            placeholder="credits"
          />
        </FormField>
        <FormField label="They put up" htmlFor="wager-acceptor-stake">
          <input
            id="wager-acceptor-stake"
            value={acceptorStake}
            onChange={(e) => setAcceptorStake(e.target.value)}
            inputMode="decimal"
            className={fieldClass}
            placeholder="credits"
          />
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <FormField label="Offer expires" htmlFor="wager-expires">
          <input
            id="wager-expires"
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className={fieldClass}
          />
        </FormField>
        <FormField label="Settled by" htmlFor="wager-resolves">
          <input
            id="wager-resolves"
            type="datetime-local"
            value={resolvesBy}
            onChange={(e) => setResolvesBy(e.target.value)}
            className={fieldClass}
          />
        </FormField>
      </div>

      <p className="text-xs text-ink-muted">
        Your stake is held the moment you post this. Withdraw it any time before someone accepts
        and it comes straight back.
      </p>

      {error ? <Callout tone="negative">{error}</Callout> : null}

      <Button type="submit" disabled={pending}>
        {pending ? 'Posting…' : 'Post the offer'}
      </Button>
    </form>
  );
}
