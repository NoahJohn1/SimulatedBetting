import type { ReactNode } from 'react';

export type CalloutTone = 'negative' | 'caution' | 'positive';

/**
 * Uses the `-surface-soft` tint rather than `-surface`, deliberately: a callout covers far
 * more area than a badge does, and the same tint that reads as a chip reads as a warning
 * light at full width.
 */
const TONES: Record<CalloutTone, string> = {
  negative: 'border-negative-line bg-negative-surface-soft text-negative-on-surface',
  caution: 'border-caution-line bg-caution-surface-soft text-caution-on-surface',
  positive: 'border-positive-line bg-positive-surface-soft text-positive-on-surface',
};

export function Callout({
  tone = 'negative',
  className = '',
  role,
  children,
}: {
  tone?: CalloutTone;
  className?: string;
  /** Override the tone-based default. Pass `null` for "no role" — e.g. when the callout
   *  wraps an interactive form rather than static alert text. */
  role?: 'alert' | null;
  children: ReactNode;
}) {
  return (
    <div
      // Screen readers should interrupt for a failure and not for a notice.
      role={role === null ? undefined : (role ?? (tone === 'negative' ? 'alert' : undefined))}
      className={`flex flex-col gap-2 rounded-card border p-3 text-sm ${TONES[tone]} ${className}`}
    >
      {children}
    </div>
  );
}
