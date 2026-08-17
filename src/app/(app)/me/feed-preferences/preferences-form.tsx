'use client';

import { useState, useTransition } from 'react';
import type { FeedEventType } from '@/db/schema';
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
    startTransition(async () => {
      await saveFeedPreferencesAction([...mutedSet]);
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
            className="flex items-start gap-3 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950"
          >
            <input
              type="checkbox"
              checked={shown}
              onChange={() => toggle(option.type)}
              className="mt-0.5"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{option.label}</span>
              <span className="text-xs text-zinc-500">{option.description}</span>
            </span>
          </label>
        );
      })}

      <div className="flex items-center justify-end gap-3 pt-2">
        {saved ? <span className="text-xs text-emerald-600">Saved</span> : null}
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
