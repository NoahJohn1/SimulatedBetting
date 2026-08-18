'use client';

import { useState, useTransition } from 'react';
import type { DisputeError } from '@/server/events/dispute';
import { disputeEventAction } from '../actions';

// Mirrors `MAX_DISPUTE_REASON_LENGTH` in `@/server/events/dispute` — kept as a local literal
// (not imported) because that module pulls in the database client, which a client component
// may not bundle. The server's own check is the real gate; this only bounds the textarea.
const MAX_DISPUTE_REASON_LENGTH = 500;

export interface DisputeFormProps {
  eventId: string;
  /** Whether the viewer's own (still-open) dispute already appears in `openDisputes`. */
  alreadyDisputed: boolean;
  existingReason: string | null;
}

function errorMessage(error: DisputeError): string {
  switch (error.code) {
    case 'REASON_REQUIRED':
      return `Give a reason, up to ${MAX_DISPUTE_REASON_LENGTH} characters.`;
    case 'NOT_RESOLVED':
      return 'This event is no longer resolved, so it cannot be disputed.';
    case 'WRONG_SEASON':
      return 'This event is not in your season.';
    case 'EVENT_NOT_FOUND':
      return 'This event could not be found.';
  }
}

export function DisputeForm({ eventId, alreadyDisputed, existingReason }: DisputeFormProps) {
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<DisputeError | null>(null);
  // Local state, not a re-fetch: once submitted (or already on the page load), the reason
  // replaces the form rather than the form staying up alongside it.
  const [submittedReason, setSubmittedReason] = useState<string | null>(
    alreadyDisputed ? existingReason : null,
  );

  if (submittedReason !== null) {
    return (
      <section className="flex flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Your dispute
        </h2>
        <p className="text-zinc-600 dark:text-zinc-300">“{submittedReason}”</p>
      </section>
    );
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const trimmed = reason.trim();
      const result = await disputeEventAction({ eventId, reason: trimmed });
      if (result.ok) setSubmittedReason(trimmed);
      else setError(result.error);
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950"
    >
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Dispute this resolution</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={MAX_DISPUTE_REASON_LENGTH}
          rows={3}
          placeholder="What's wrong with the resolution?"
          className="rounded-xl border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <span className="text-xs text-zinc-500">
          {reason.length}/{MAX_DISPUTE_REASON_LENGTH}
        </span>
      </label>

      {error ? <p className="text-xs text-red-600 dark:text-red-400">{errorMessage(error)}</p> : null}

      <button
        type="submit"
        disabled={pending || reason.trim().length === 0}
        className="self-start rounded-full border border-zinc-300 px-3 py-2 text-sm font-medium disabled:opacity-40 dark:border-zinc-700"
      >
        {pending ? 'Submitting…' : 'Submit dispute'}
      </button>
    </form>
  );
}
