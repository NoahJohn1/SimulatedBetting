'use client';

import { useState, useTransition } from 'react';
import type { ResolveError } from '@/server/events/resolve';
import { resolveEventAction } from '../../actions';

export interface ResolveFormOutcome {
  selectionId: string;
  label: string;
}

export interface ResolveFormMarket {
  marketId: string;
  title: string;
  /** Already in `sort_order` — the query is the one place that ordering is decided. */
  outcomes: ResolveFormOutcome[];
}

export interface ResolveFormProps {
  eventId: string;
  /** `resolution.attempt` from `CustomEventDetail` — 0 for a first resolution. */
  attempt: number;
  markets: ResolveFormMarket[];
}

function errorMessage(error: ResolveError): string {
  switch (error.code) {
    case 'INCOMPLETE_RESOLUTION':
      return 'Pick a winner for every market.';
    case 'RE_RESOLUTION_IS_ADMIN_ONLY':
      return 'The creator has already resolved this — an admin must correct it.';
    case 'NOTE_REQUIRED':
      return 'This is a correction to an already-resolved event — add a note explaining what changed.';
    case 'NOT_AUTHORIZED':
      return 'Only the creator or an admin can resolve this event.';
    case 'ALREADY_VOIDED':
      return 'This event was voided and can no longer be resolved.';
    case 'EVENT_NOT_FOUND':
    case 'NOT_CUSTOM_EVENT':
      return 'This event could not be found.';
    case 'UNKNOWN_MARKET':
      return 'One of the selected markets is no longer part of this event.';
    case 'SELECTION_NOT_IN_MARKET':
      return 'One of the selected outcomes does not belong to its market.';
  }
}

export function ResolveForm({ eventId, attempt, markets }: ResolveFormProps) {
  const [pending, startTransition] = useTransition();
  const [winners, setWinners] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [error, setError] = useState<ResolveError | null>(null);

  // A re-resolution is a correction, and D15's audit trail requires the note. The server's
  // NOTE_REQUIRED is the real gate; this is only the hint.
  const noteRequired = attempt >= 1;
  const missingMarketIds =
    error?.code === 'INCOMPLETE_RESOLUTION' ? new Set(error.missingMarketIds) : null;
  const complete = markets.every((market) => winners[market.marketId]);

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await resolveEventAction({
        eventId,
        winners: markets
          .filter((market) => winners[market.marketId])
          .map((market) => ({
            marketId: market.marketId,
            winningSelectionId: winners[market.marketId],
          })),
        note,
      });
      // On success the action redirects server-side and this branch never runs.
      if (!result.ok) setError(result.error);
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
      {markets.map((market) => (
        <fieldset
          key={market.marketId}
          className={`flex flex-col gap-2 rounded-xl border p-3 ${
            missingMarketIds?.has(market.marketId)
              ? 'border-red-400 dark:border-red-600'
              : 'border-zinc-200 dark:border-zinc-800'
          }`}
        >
          <legend className="px-1 text-sm font-semibold">{market.title}</legend>
          {market.outcomes.map((outcome) => (
            <label key={outcome.selectionId} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={market.marketId}
                value={outcome.selectionId}
                checked={winners[market.marketId] === outcome.selectionId}
                onChange={() =>
                  setWinners((current) => ({ ...current, [market.marketId]: outcome.selectionId }))
                }
              />
              {outcome.label}
            </label>
          ))}
        </fieldset>
      ))}

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">
          Note{noteRequired ? ' (required — this is a correction)' : ' (optional)'}
        </span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          required={noteRequired}
          rows={3}
          className="rounded-xl border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>

      <p className="text-sm text-zinc-500">
        {complete
          ? 'Confirming will grade every pending bet on this event against the winners selected above and pay out credits accordingly.'
          : 'Pick a winner for every market to see what will be paid.'}
      </p>

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{errorMessage(error)}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-full bg-zinc-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {pending ? 'Resolving…' : 'Confirm resolution'}
      </button>
    </form>
  );
}
