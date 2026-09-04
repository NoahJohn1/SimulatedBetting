'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { activateSeasonAction } from './actions';

/**
 * The second, deliberate act (D61). The refusal names the season in the way rather than saying
 * "conflict", because the next question is always "which one".
 */
export function ActivateForm({ seasonId }: { seasonId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function activate() {
    setError(null);
    startTransition(async () => {
      const result = await activateSeasonAction(seasonId);
      if (result.ok) return;
      setError(
        result.code === 'ALREADY_ACTIVE'
          ? `“${result.blockingSeasonName}” is still active. End it before starting this one.`
          : 'That season could not be found.',
      );
    });
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <Button variant="secondary" size="sm" onClick={activate} disabled={pending}>
        {pending ? 'Activating…' : 'Activate'}
      </Button>
      {error ? <span className="text-xs text-negative">{error}</span> : null}
    </span>
  );
}
