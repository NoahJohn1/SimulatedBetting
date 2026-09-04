'use client';

import { useState, useTransition } from 'react';
import type { NotificationType } from '@/db/schema';
import { Button } from '@/components/ui/button';
import { saveNotificationPreferencesAction } from './actions';

export interface NotificationOption {
  type: NotificationType;
  label: string;
  description: string;
}

export function NotificationForm({
  options,
  muted,
  emailsEnabled,
}: {
  options: NotificationOption[];
  muted: NotificationType[];
  emailsEnabled: boolean;
}) {
  const [mutedSet, setMutedSet] = useState(() => new Set(muted));
  const [enabled, setEnabled] = useState(emailsEnabled);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function toggle(type: NotificationType) {
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
      await saveNotificationPreferencesAction({
        mutedTypes: [...mutedSet],
        emailsEnabled: enabled,
      });
      setSaved(true);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-start gap-3 rounded-xl border border-line-strong bg-surface-raised p-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={() => {
            setSaved(false);
            setEnabled((on) => !on);
          }}
          className="mt-0.5"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Send me email at all</span>
          <span className="text-xs text-ink-muted">
            Turn this off and nothing below sends, whatever it says.
          </span>
        </span>
      </label>

      {options.map((option) => {
        const on = !mutedSet.has(option.type);
        return (
          <label
            key={option.type}
            className="flex items-start gap-3 rounded-xl border border-line bg-surface-raised p-3"
          >
            <input
              type="checkbox"
              checked={on && enabled}
              // Disabled under a global off, because a row of live-looking toggles beneath one
              // is a lie about what will happen.
              disabled={!enabled}
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
        {saved ? <span className="text-xs text-positive">Saved</span> : null}
        <Button onClick={save} disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
