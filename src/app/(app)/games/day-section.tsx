import type { ReactNode } from 'react';
import { MARKET_LABEL, MARKET_ORDER } from './odds-cell';

/**
 * One day's worth of games, collapsible. Native <details>/<summary> rather than client state
 * (D77, global constraint: filters and disclosure are links/DOM, not client components) — the
 * page stays a server component and the browser gets the toggle for free.
 *
 * The SPREAD/MONEY/TOTAL column header renders once here, under the summary, instead of once
 * per card the way the old board did it — the header row's grid matches GameRow's exactly so
 * the columns line up regardless of which day sections are open.
 */
export function DaySection({
  heading,
  count,
  defaultOpen,
  children,
}: {
  heading: string;
  count: number;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="border-b border-line-subtle">
      <summary className="sticky top-12 z-10 flex cursor-pointer list-none items-center justify-between bg-surface px-1 py-2 text-xs font-semibold uppercase tracking-wide text-ink-muted [&::-webkit-details-marker]:hidden">
        <span>{heading}</span>
        <span>{count} games</span>
      </summary>

      <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,4rem)] gap-x-2 px-1 py-1 lg:grid-cols-[3.5rem_minmax(0,1fr)_repeat(3,4.5rem)]">
        <span className="hidden lg:block" />
        <span />
        {MARKET_ORDER.map((type) => (
          <span key={type} className="text-center text-xs font-medium uppercase text-ink-muted">
            {MARKET_LABEL[type]}
          </span>
        ))}
      </div>

      {children}
    </details>
  );
}
