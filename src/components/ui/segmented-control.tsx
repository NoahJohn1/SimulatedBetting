import Link from 'next/link';
import type { ComponentProps } from 'react';

export interface Segment {
  href: ComponentProps<typeof Link>['href'];
  label: string;
  active: boolean;
}

/**
 * Link-based, not stateful. Both call sites — Bets | Wagers and Cash | Credits — are server
 * rendered navigations that must stay navigations: they change what the server queries, and
 * making them client state would mean fetching both and hiding one.
 *
 * The active segment renders as a <span>, so it is not a link to the page you are on.
 * `/bets`'s currency filter previously rendered its active segment as a live link; that was
 * an oversight rather than a feature.
 */
export function SegmentedControl({ segments, label }: { segments: Segment[]; label: string }) {
  return (
    <nav aria-label={label} className="flex gap-2 px-1">
      {segments.map((segment) =>
        segment.active ? (
          <span
            key={segment.label}
            aria-current="page"
            className="rounded-pill bg-accent px-3 py-1 text-xs font-medium text-accent-ink"
          >
            {segment.label}
          </span>
        ) : (
          <Link
            key={segment.label}
            href={segment.href}
            className="rounded-pill bg-surface-muted px-3 py-1 text-xs font-medium text-ink-secondary transition-colors hover:text-ink"
          >
            {segment.label}
          </Link>
        ),
      )}
    </nav>
  );
}
