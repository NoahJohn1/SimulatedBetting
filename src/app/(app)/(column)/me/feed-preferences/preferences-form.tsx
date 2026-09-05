'use client';

import { useState, useTransition } from 'react';
import type { FeedEventType } from '@/db/schema';
import { Button } from '@/components/ui/button';
import { saveFeedPreferencesAction } from '../../feed/actions';

export interface PreferenceOption {
  type: FeedEventType;
  label: string;
  description: string;
}

export function PreferencesForm({
  options,
  muted,
}: {
  options: PreferenceOption[];
  muted: FeedEventType[];
}) {
  const [mutedSet, setMutedSet] = useState(() => new Set(muted));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(type: FeedEventType) {
    setSaved(false);
    setMutedSet((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  function save() {
    setSaved(false);
    setError(null);
    startTransition(async () => {
      const result = await saveFeedPreferencesAction([...mutedSet]);
      // The result was previously discarded entirely, so a refusal — a rate limit is the one
      // that actually happens — showed "Saved" while nothing was written.
      if ('error' in result) {
        setError(
          result.error === 'RATE_LIMITED'
            ? `You're saving too quickly. Try again in ${result.retryAfterSeconds} seconds.`
            : 'Could not save. Try again.',
        );
        return;
      }
      setSaved(true);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {options.map((option) => {
        const shown = !mutedSet.has(option.type);
        return (
          <label
            key={option.type}
            className="flex items-start gap-3 rounded-xl border border-line bg-surface-raised p-3"
          >
            <input
              type="checkbox"
              checked={shown}
              onChange={() => toggle(option.type)}
              className="mt-0.5"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{option.label}</span>
              <span className="text-xs text-ink-muted">{option.description}</span>
            </span>
          </label>
        );
      })}

      <div className="flex items-center justify-end gap-3 pt-2">
        {error ? <span className="text-xs text-negative">{error}</span> : null}
        {saved ? <span className="text-xs text-positive">Saved</span> : null}
        <Button onClick={save} disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
