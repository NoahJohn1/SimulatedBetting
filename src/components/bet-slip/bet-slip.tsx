'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { placeBetAction } from '@/app/(app)/bets/actions';
import { Button } from '@/components/ui/button';
import { Money } from '@/components/ui/money';
import type { Currency } from '@/db/schema';
import { formatAmount } from '@/domain/money';
import type { PlaceBetError } from '@/server/bets/types';
import type { RateLimited } from '@/server/limits/types';
import { useSlip } from './slip-context';

/**
 * Every amount the slip quotes is in the slip's own denomination — the stake, the balance it
 * is checked against, and the payout. A cash slip reads exactly as it always did.
 */
function message(error: PlaceBetError | RateLimited, currency: Currency): string {
  switch (error.code) {
    case 'RATE_LIMITED':
      return `You're placing bets too quickly. Try again in ${error.retryAfterSeconds} seconds.`;
    case 'LINE_MOVED':
      return 'The line moved while the slip was open. Review the new price and try again.';
    case 'INSUFFICIENT_FUNDS':
      return `Not enough balance. You have ${formatAmount(error.balanceCents, currency)}.`;
    case 'STAKE_BELOW_MINIMUM':
      return `The minimum stake is ${formatAmount(error.minimumCents, currency)}.`;
    case 'DUPLICATE_EVENT':
      return 'A parlay cannot have two legs from the same game or event.';
    case 'EVENT_NOT_BETTABLE':
      return 'That game or event has already started or is no longer open.';
    case 'MIXED_CURRENCY_PARLAY':
      return 'A parlay cannot mix game legs with custom-event legs.';
    case 'MARKET_CLOSED':
      return 'That market is suspended.';
    case 'INVALID_LEG_COUNT':
      return `A parlay needs between ${error.min} and ${error.max} legs.`;
    case 'NOT_APPROVED':
      return 'Your account is still waiting for approval.';
    case 'NO_ACTIVE_SEASON':
      return 'There is no season running.';
    case 'NOT_A_MEMBER':
      return 'You have not joined the season yet.';
    case 'DUPLICATE_REQUEST':
      return 'That bet was already placed.';
    default:
      return 'That bet could not be placed.';
  }
}

/**
 * Balances arrive as decimal strings and become bigints here, the same way every money value
 * that crosses into a client component does. Never `Number` (D17).
 */
export function BetSlip({
  balanceCents,
  creditsBalanceCents,
}: {
  balanceCents: string;
  creditsBalanceCents: string;
}) {
  const slip = useSlip();
  const router = useRouter();
  const [stake, setStake] = useState('10.00');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (slip.legs.length === 0) return null;

  const isParlay = slip.legs.length > 1;
  const currency = slip.currency;
  const available = BigInt(currency === 'CASH' ? balanceCents : creditsBalanceCents);

  function submit() {
    setError(null);
    setPlaced(null);

    const cents = (() => {
      if (!/^\d+(\.\d{1,2})?$/.test(stake.trim())) return null;
      const [whole, fraction = ''] = stake.trim().split('.');
      return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    })();

    if (cents === null) {
      setError('Enter a stake like 25 or 25.50.');
      return;
    }

    startTransition(async () => {
      const result = await placeBetAction({
        type: isParlay ? 'PARLAY' : 'SINGLE',
        stakeCents: cents.toString(),
        legs: slip.legs.map((leg) => ({
          selectionId: leg.selectionId,
          line: leg.line,
          priceAmerican: leg.priceAmerican,
        })),
        // A stable id per submission makes a double-tap a no-op rather than a second bet.
        clientRequestId: crypto.randomUUID(),
      });

      if (result.ok) {
        setPlaced(
          `Bet placed to return ${formatAmount(result.bet.potentialPayoutCents, currency)}`,
        );
        slip.clear();
        router.refresh();
      } else {
        setError(message(result.error, currency));
      }
    });
  }

  return (
    // bottom-[calc(41px+env(safe-area-inset-bottom))] clears the fixed TabBar (its rendered
    // height, plus the safe-area padding it reserves on notched devices) sitting below this
    // sibling — two independent `sticky bottom-0` elements both stick to the viewport's own
    // bottom edge and overlap rather than stack, since sticky doesn't reserve space for other
    // sticky siblings.
    <div className="sticky bottom-[calc(41px+env(safe-area-inset-bottom))] z-20 border-t border-line bg-surface-raised shadow-slip">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3"
      >
        <span className="text-sm font-semibold">
          {isParlay ? `${slip.legs.length}-leg parlay` : '1 selection'}
          <span className="ml-2 text-xs font-normal text-ink-muted">
            {currency === 'CASH' ? 'Cash' : 'Credits'}
          </span>
        </span>
        <span className="text-xs text-ink-muted">{open ? 'Hide' : 'Show'}</span>
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

      {open ? (
        <div className="flex flex-col gap-3 px-4 pb-4">
          <ul className="flex flex-col gap-2">
            {slip.legs.map((leg) => (
              <li
                key={leg.selectionId}
                className="flex items-center justify-between gap-3 rounded-lg bg-surface-sunken px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{leg.label}</span>
                  <span className="text-xs text-ink-muted">{leg.marketLabel}</span>
                </span>
                <button
                  type="button"
                  onClick={() => slip.remove(leg.selectionId)}
                  className="shrink-0 text-xs text-ink-muted hover:text-negative"
                  aria-label={`Remove ${leg.label}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>

          <label className="flex items-center gap-3">
            <span className="text-sm text-ink-muted">Stake</span>
            <span className="text-sm text-ink-muted">{currency === 'CASH' ? '$' : '©'}</span>
            <input
              inputMode="decimal"
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              className="w-28 rounded-lg border border-line-strong bg-surface-sunken px-3 py-2 text-sm tabular-nums"
            />
            <span className="ml-auto text-xs text-ink-muted">
              Balance <Money cents={available} currency={currency} />
            </span>
          </label>

          {error ? <p className="text-sm text-negative">{error}</p> : null}
          {placed ? <p className="text-sm text-positive">{placed}</p> : null}

          <div className="flex gap-2">
            <Button variant="secondary" onClick={slip.clear} className="flex-1">
              Clear
            </Button>
            <Button onClick={submit} disabled={pending} className="flex-[2]">
              {pending ? 'Placing…' : 'Place bet'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
