'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ArbitrateError } from '@/server/p2p/types';
import type { RateLimited } from '@/server/limits/types';
import { arbitrateWagerAction } from './actions';

function errorMessage(error: ArbitrateError | RateLimited): string {
  switch (error.code) {
    case 'RATE_LIMITED':
      return `You're doing that too quickly. Try again in ${error.retryAfterSeconds} seconds.`;
    case 'NOTE_REQUIRED':
      return 'An arbitration moves money — say why.';
    case 'WAGER_NOT_FOUND':
      return 'This wager could not be found.';
    case 'NOT_ARBITRABLE':
      return `This wager is ${error.status.toLowerCase()} and cannot be ruled on.`;
  }
}

/**
 * The ruling control on a queue row. `required` on the input is only a client-side hint —
 * `arbitrateWagerAction` re-checks NOTE_REQUIRED server-side, which is the real gate.
 */
export function ArbitrationForm({
  wagerId,
  offererDisplayName,
  acceptorDisplayName,
}: {
  wagerId: string;
  offererDisplayName: string;
  acceptorDisplayName: string;
}) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [error, setError] = useState<ArbitrateError | RateLimited | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(verdict: 'OFFERER' | 'ACCEPTOR' | 'VOID') {
    setError(null);
    startTransition(async () => {
      const result = await arbitrateWagerAction(wagerId, verdict, note);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Why (required, and it goes on the record)
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          required
          className="rounded-lg border border-line-strong bg-surface-sunken p-2"
        />
      </label>

      {error ? <p className="text-xs text-negative-on-surface">{errorMessage(error)}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || note.trim().length === 0}
          onClick={() => submit('OFFERER')}
          className="rounded-lg border border-line-strong px-3 py-2 text-sm disabled:opacity-40"
        >
          {offererDisplayName} wins
        </button>
        <button
          type="button"
          disabled={pending || note.trim().length === 0}
          onClick={() => submit('ACCEPTOR')}
          className="rounded-lg border border-line-strong px-3 py-2 text-sm disabled:opacity-40"
        >
          {acceptorDisplayName} wins
        </button>
        <button
          type="button"
          disabled={pending || note.trim().length === 0}
          onClick={() => submit('VOID')}
          className="rounded-lg border border-line-strong px-3 py-2 text-sm disabled:opacity-40"
        >
          Refund both
        </button>
      </div>
    </div>
  );
}
