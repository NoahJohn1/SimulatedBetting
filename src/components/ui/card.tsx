import type { ReactNode } from 'react';

/**
 * The bordered raised surface nearly every screen repeats. `emphasis` is the
 * "this row is you" / "this selection is picked" state — standings, the odds board, and the
 * wagers list all draw it the same way, with the accent border rather than a fill.
 */
export function Card({
  emphasis = false,
  className = '',
  children,
}: {
  emphasis?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-card border bg-surface-raised ${
        emphasis ? 'border-accent' : 'border-line'
      } ${className}`}
    >
      {children}
    </div>
  );
}
