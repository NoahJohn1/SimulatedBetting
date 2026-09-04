'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { joinSeasonAction } from './actions';

function message(error: string, retryAfterSeconds?: number): string {
  if (error === 'RATE_LIMITED') {
    return `That went through too quickly. Try again in ${retryAfterSeconds} seconds.`;
  }
  if (error === 'NO_SEASON') return 'That season is no longer running. Refresh and try again.';
  return 'Could not join the season. Try again.';
}

export function JoinForm({ seasonId }: { seasonId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await joinSeasonAction(seasonId);
      if (result.ok) router.push('/');
      else setError(message(result.error, result.retryAfterSeconds));
    });
  }

  return (
    <>
      <Button type="button" onClick={submit} disabled={pending}>
        {pending ? 'Joining…' : 'Join season'}
      </Button>
      {error ? <Callout tone="caution">{error}</Callout> : null}
    </>
  );
}
