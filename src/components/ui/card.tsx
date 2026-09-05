import type { ReactNode } from 'react';

/**
 * The bordered raised surface nearly every screen repeats. `emphasis` is the
 * "this row is you" / "this selection is picked" state — standings, the odds board, and the
 * wagers list all draw it the same way, with the accent border rather than a fill.
 *
 * `as` is the escape hatch for a call site that needs a different tag for semantics or
 * validity — an `<article>` for a self-contained feed card, a `<li>` for a card that is one
 * item of a list — without giving up the shared border/surface styling. It changes nothing
 * visually; `div` stays the default for every existing call site.
 */
export function Card({
  as = 'div',
  emphasis = false,
  className = '',
  children,
}: {
  as?: 'div' | 'article' | 'section' | 'li';
  emphasis?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const Tag = as;
  return (
    <Tag
      className={`rounded-card border bg-surface-raised ${
        emphasis ? 'border-accent' : 'border-line'
      } ${className}`}
    >
      {children}
    </Tag>
  );
}
