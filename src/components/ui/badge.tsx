import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'positive' | 'negative' | 'caution';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-muted text-ink-secondary',
  positive: 'bg-positive-surface text-positive-on-surface',
  negative: 'bg-negative-surface text-negative-on-surface',
  caution: 'bg-caution-surface text-caution-on-surface',
};

/**
 * The bet/wager/event status vocabulary, mapped to tones once. Exported because callers that
 * render a status alongside other content need the tone without rendering a Badge.
 */
export function statusTone(status: string): BadgeTone {
  switch (status) {
    case 'WON':
      return 'positive';
    case 'LOST':
      return 'negative';
    case 'PUSHED':
    case 'VOIDED':
      return 'caution';
    default:
      return 'neutral';
  }
}

export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={`rounded-pill px-2 py-0.5 text-xs font-medium ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * The pre-7b call signature, kept so the sweep does not have to touch every status call site
 * in the same commit that changes the component. Callers migrate to <Badge tone={…}> as their
 * screen is swept.
 */
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone(status)}>{status}</Badge>;
}
