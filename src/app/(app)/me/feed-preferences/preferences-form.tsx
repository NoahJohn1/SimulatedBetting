'use client';

import { useState, useTransition } from 'react';
import type { FeedEventType } from '@/db/schema';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
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
          <div
            key={option.type}
            className="rounded-xl border border-line bg-surface-raised p-3"
          >
            <FormField label={option.label} htmlFor={option.type} hint={option.description}>
              <input
                id={option.type}
                type="checkbox"
                checked={shown}
                onChange={() => toggle(option.type)}
              />
            </FormField>
          </div>
        );
      })}

      <div className="flex items-center justify-end gap-3 pt-2">
        {saved ? <span className="text-xs text-positive">Saved</span> : null}
        <Button type="submit" onClick={save} disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
