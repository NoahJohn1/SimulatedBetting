'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sheet } from '@/components/ui/sheet';
import { COLLAPSED_BAR_OFFSET } from './bar-offset';
import { SlipPanel } from './slip-panel';
import { useSlip } from './slip-context';

/** True when `pathname` is `/games` or a route nested beneath it — mirrors tab-bar.tsx's rule. */
function onGamesBoard(pathname: string): boolean {
  return pathname === '/games' || pathname.startsWith('/games/');
}

/**
 * The `<lg` collapsed bar and its Sheet. `/games` renders its own rail (slip-rail.tsx) for the
 * same selections at `lg+`, so this bar hides itself there (`lg:hidden`) rather than showing
 * two interactive copies of one slip; every other screen keeps the bar visible at `lg+`
 * (`lg:bottom-0`) since a member's selections have to stay visible everywhere else.
 */
export function BetSlip({
  balanceCents,
  creditsBalanceCents,
}: {
  balanceCents: string;
  creditsBalanceCents: string;
}) {
  const slip = useSlip();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  if (slip.legs.length === 0) return null;

  const isParlay = slip.legs.length > 1;
  const currency = slip.currency;
  const hiddenAtLg = onGamesBoard(pathname);

  return (
    // Two independent `sticky bottom-0` elements both stick to the viewport's own bottom edge
    // and overlap rather than stack, since sticky doesn't reserve space for other sticky
    // siblings — COLLAPSED_BAR_OFFSET (bar-offset.ts) clears TabBar's rendered height below.
    <div
      className={`sticky ${COLLAPSED_BAR_OFFSET} z-20 border-t border-line bg-surface-raised shadow-slip lg:bottom-0 ${hiddenAtLg ? 'lg:hidden' : ''}`}
    >
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between px-4 py-3"
      >
        <span className="text-sm font-semibold">
          {isParlay ? `${slip.legs.length}-leg parlay` : '1 selection'}
          <span className="ml-2 text-xs font-normal text-ink-muted">
            {currency === 'CASH' ? 'Cash' : 'Credits'}
          </span>
        </span>
        <span className="text-xs text-ink-muted">Show</span>
      </button>

      {/* Shown collapsed too: the tap that produced it happened somewhere else on the page. */}
      {slip.notice ? (
        <p className="flex items-start justify-between gap-3 px-4 pb-3 text-xs text-caution-on-surface">
          <span>{slip.notice}</span>
          <button
            type="button"
            onClick={slip.dismissNotice}
            className="shrink-0 text-ink-muted hover:text-ink-secondary"
          >
            Dismiss
          </button>
        </p>
      ) : null}

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        label={isParlay ? `${slip.legs.length}-leg parlay` : 'Bet slip'}
      >
        <SlipPanel
          balanceCents={balanceCents}
          creditsBalanceCents={creditsBalanceCents}
          onPlaced={() => setOpen(false)}
        />
      </Sheet>
    </div>
  );
}
