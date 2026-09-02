'use client';

import { useState, useTransition } from 'react';
import { Callout } from '@/components/ui/callout';
import type { VoidError } from '@/server/events/resolve';
import { voidEventAction } from './actions';

function errorMessage(error: VoidError): string {
  switch (error.code) {
    case 'NOTE_REQUIRED':
      return 'A void moves money — say why.';
    case 'ALREADY_VOIDED':
      return 'This event was already voided.';
    case 'EVENT_NOT_FOUND':
      return 'This event could not be found.';
  }
}

/**
 * The void control on an overdue row. `required` on the textarea is only a client-side hint —
 * `voidEventAction` re-checks NOTE_REQUIRED server-side, which is the real gate.
 */
export function VoidForm({ eventId }: { eventId: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<VoidError | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start rounded-full border border-negative-line px-3 py-2 text-xs font-medium text-negative-on-surface"
      >
        Void
      </button>
    );
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await voidEventAction({ eventId, note });
      // On success the action redirects server-side and this branch never runs.
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <Callout role={null}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-col gap-2"
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium">
            Void this event and refund every bet — a note is required
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            required
            rows={2}
            placeholder="Why is this event being voided?"
            className="rounded-xl border border-negative-line bg-surface-sunken px-3 py-2 text-sm"
          />
        </label>

        {error ? <p className="text-xs">{errorMessage(error)}</p> : null}

        <span className="flex gap-2">
          <button
            type="submit"
            disabled={pending || note.trim().length === 0}
            className="rounded-full bg-negative-surface px-3 py-2 text-xs font-semibold text-negative-on-surface disabled:opacity-40"
          >
            {pending ? 'Voiding…' : 'Confirm void'}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-full border border-line-strong px-3 py-2 text-xs font-medium"
          >
            Cancel
          </button>
        </span>
      </form>
    </Callout>
  );
}
