'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveThemeAction, type Theme } from './actions';

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/**
 * The dark-mode toggle (Task 17). A three-state control rather than a boolean switch, because
 * "match the OS" is a real, and the default, third state — not an absence of a choice.
 *
 * Saving round-trips through the server: the cookie the root layout reads is set by
 * `saveThemeAction`, and `router.refresh()` is what makes the change visible in this tab
 * without a full reload, by re-running the server components (root layout included) against
 * the request the cookie write just changed.
 */
export function AppearanceForm({ currentTheme }: { currentTheme: Theme }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function chooseTheme(theme: Theme) {
    startTransition(async () => {
      await saveThemeAction(theme);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-ink-muted">Theme</span>
      <div role="radiogroup" aria-label="Theme" className="flex gap-2">
        {THEMES.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={currentTheme === option.value}
            disabled={pending}
            onClick={() => chooseTheme(option.value)}
            className={`rounded-pill px-3 py-1 text-xs font-medium transition-colors ${
              currentTheme === option.value
                ? 'bg-accent text-accent-ink'
                : 'bg-surface-muted text-ink-secondary hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
