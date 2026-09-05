'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import type { DisputeError } from '@/server/events/dispute';
import type { RateLimited } from '@/server/limits/types';
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

function errorMessage(error: DisputeError | RateLimited): string {
  switch (error.code) {
    case 'RATE_LIMITED':
      return `You're doing that too quickly. Try again in ${error.retryAfterSeconds} seconds.`;
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
  const [error, setError] = useState<DisputeError | RateLimited | null>(null);
  // Local state, not a re-fetch: once submitted (or already on the page load), the reason
  // replaces the form rather than the form staying up alongside it.
  const [submittedReason, setSubmittedReason] = useState<string | null>(
    alreadyDisputed ? existingReason : null,
  );

  if (submittedReason !== null) {
    return (
      <section className="flex flex-col gap-1 rounded-xl border border-line bg-surface-raised p-3 text-sm">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Your dispute
        </h2>
        <p className="text-ink-secondary">“{submittedReason}”</p>
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
      className="flex flex-col gap-2 rounded-xl border border-line bg-surface-raised p-3"
    >
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Dispute this resolution</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={MAX_DISPUTE_REASON_LENGTH}
          rows={3}
          placeholder="What's wrong with the resolution?"
          className="rounded-xl border border-line-strong bg-surface-sunken px-3 py-2 text-sm"
        />
        <span className="text-xs text-ink-muted">
          {reason.length}/{MAX_DISPUTE_REASON_LENGTH}
        </span>
      </label>

      {error ? <p className="text-xs text-negative">{errorMessage(error)}</p> : null}

      <Button
        type="submit"
        variant="secondary"
        disabled={pending || reason.trim().length === 0}
        className="self-start"
      >
        {pending ? 'Submitting…' : 'Submit dispute'}
      </Button>
    </form>
  );
}
