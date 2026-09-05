'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ACCENT_VALUES, type Accent } from '@/db/schema';
import { saveAccentAction, saveThemeAction, type Theme } from './actions';

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/**
 * The six swatches, derived from the schema's `ACCENT_VALUES` rather than a second hand-typed
 * list — the same single source `data-accent` values are lowercased from in the root layout,
 * so a hue can never name itself differently in three places.
 */
const ACCENTS: { value: Accent; label: string }[] = ACCENT_VALUES.map((value) => ({
  value,
  label: value.charAt(0) + value.slice(1).toLowerCase(),
}));

/**
 * The dark-mode toggle (Task 17). A three-state control rather than a boolean switch, because
 * "match the OS" is a real, and the default, third state — not an absence of a choice.
 *
 * Saving round-trips through the server: the cookie the root layout reads is set by
 * `saveThemeAction`, and `router.refresh()` is what makes the change visible in this tab
 * without a full reload, by re-running the server components (root layout included) against
 * the request the cookie write just changed.
 */
export function AppearanceForm({
  currentTheme,
  currentAccent,
}: {
  currentTheme: Theme;
  currentAccent: Accent;
}) {
  const router = useRouter();
  const [pendingTheme, startThemeTransition] = useTransition();
  const [pendingAccent, startAccentTransition] = useTransition();

  function chooseTheme(theme: Theme) {
    startThemeTransition(async () => {
      await saveThemeAction(theme);
      router.refresh();
    });
  }

  function chooseAccent(accentValue: Accent) {
    startAccentTransition(async () => {
      await saveAccentAction(accentValue);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-ink-muted">Theme</span>
        <div role="radiogroup" aria-label="Theme" className="flex gap-2">
          {THEMES.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={currentTheme === option.value}
              disabled={pendingTheme}
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

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-ink-muted">Accent color</span>
        <div role="radiogroup" aria-label="Accent color" className="flex gap-3">
          {ACCENTS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={currentAccent === option.value}
              aria-label={option.label}
              disabled={pendingAccent}
              onClick={() => chooseAccent(option.value)}
              // The six swatches must show all six hues at once, which the single live
              // `--accent` token cannot do — it only ever holds the current selection. This is
              // the one place outside globals.css that reads a Tier-1 `--acc-*` variable
              // directly, and only for a static colour preview; nothing here overrides what
              // `--accent` itself resolves to.
              style={{ backgroundColor: `var(--acc-${option.value.toLowerCase()})` }}
              className={`h-8 w-8 rounded-full border-2 transition-colors ${
                currentAccent === option.value ? 'border-accent' : 'border-line'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
