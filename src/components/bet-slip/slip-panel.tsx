'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { placeBetAction } from '@/app/(app)/(column)/bets/actions';
import { Button } from '@/components/ui/button';
import { Money, Price } from '@/components/ui/money';
import { useToast } from '@/components/ui/toast';
import type { Currency } from '@/db/schema';
import { formatAmount } from '@/domain/money';
import { americanToRational, combine, payoutCents, rationalToAmerican } from '@/domain/odds';
import type { PlaceBetError } from '@/server/bets/types';
import type { RateLimited } from '@/server/limits/types';
import type { SlipLeg } from './slip-context';
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

/** `25` or `25.50` into cents; null for anything else, same rule the server re-checks. */
function parseStakeCents(stake: string): bigint | null {
  if (!/^\d+(\.\d{1,2})?$/.test(stake.trim())) return null;
  const [whole, fraction = ''] = stake.trim().split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

/**
 * A MONEYLINE leg's persisted `label` already ends with its own price — odds-cell.tsx's
 * `selectionLabel` returns just the price string when there's no line, so slip-context's
 * stored shape (which cannot change) bakes it into the label. This task adds `<Price>` next to
 * every leg row, so without this the row would show the price twice. Only strips a trailing
 * integer token that exactly equals this leg's own formatted price, so a spread/total line
 * (which is only ever appended for non-moneyline legs and can be a decimal like "+27.5", or an
 * integer that happens not to match the price) is left alone.
 */
function stripTrailingPrice(label: string, priceAmerican: number): string {
  const formatted = priceAmerican > 0 ? `+${priceAmerican}` : String(priceAmerican);
  const match = label.match(/\s([+-]\d+)$/);
  return match && match[1] === formatted ? label.slice(0, -match[0].length) : label;
}

/**
 * The toast's one-line description of what was placed. Mirrors
 * src/server/feed/describe-leg.ts's `describeBet`, but built from the slip's own leg shape —
 * a `FeedLegSnapshot` needs fields (team abbreviations, event titles) the client-side slip
 * never carries, so this reuses the slip's own display label instead of importing that
 * server-side formatter.
 */
function describeSlip(legs: SlipLeg[]): string {
  if (legs.length === 0) return 'a bet';
  return legs.length === 1 ? legs[0].label : `${legs.length}-leg parlay`;
}

/**
 * The slip's shared contents — the leg list, stake input, and Place button — used by both the
 * `<lg` collapsed bar's Sheet (bet-slip.tsx) and the `lg+` rail (slip-rail.tsx). Split out so
 * neither container carries its own copy of the placement logic.
 *
 * `onPlaced` fires after a successful placement (and after the slip is cleared) so the bar's
 * Sheet can close itself; the rail has nothing to close and passes nothing.
 */
export function SlipPanel({
  balanceCents,
  creditsBalanceCents,
  onPlaced,
}: {
  balanceCents: string;
  creditsBalanceCents: string;
  onPlaced?: () => void;
}) {
  const slip = useSlip();
  const router = useRouter();
  const { toast } = useToast();
  const [stake, setStake] = useState('10.00');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (slip.legs.length === 0) return null;

  const isParlay = slip.legs.length > 1;
  const currency = slip.currency;
  const available = BigInt(currency === 'CASH' ? balanceCents : creditsBalanceCents);

  // Live payout preview: bigint in, bigint out, rendered only through Money/Price — never
  // Number() a cent amount or an odds price (D17).
  const parsedStake = parseStakeCents(stake);
  const combinedRational = combine(slip.legs.map((leg) => americanToRational(leg.priceAmerican)));
  const combinedAmerican = rationalToAmerican(combinedRational);
  const payout = payoutCents(parsedStake ?? 0n, combinedRational);

  function submit() {
    setError(null);

    const cents = parseStakeCents(stake);
    if (cents === null) {
      setError('Enter a stake like 25 or 25.50.');
      return;
    }

    startTransition(async () => {
      const description = describeSlip(slip.legs);

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
        toast({ tone: 'positive', title: 'Bet placed', description });
        slip.clear();
        onPlaced?.();
        router.refresh();
      } else {
        toast({ tone: 'negative', title: message(result.error, currency) });
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">
          {isParlay ? `${slip.legs.length}-leg parlay` : '1 selection'}
        </span>
        <span className="text-xs text-ink-muted">{currency === 'CASH' ? 'Cash' : 'Credits'}</span>
      </div>

      {slip.notice ? (
        <p className="flex items-start justify-between gap-3 text-xs text-caution-on-surface">
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

      <ul className="flex flex-col gap-2">
        {slip.legs.map((leg) => (
          <li
            key={leg.selectionId}
            className="flex items-center justify-between gap-3 rounded-lg bg-surface-sunken px-3 py-2"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {stripTrailingPrice(leg.label, leg.priceAmerican)}{' '}
                <Price american={leg.priceAmerican} />
              </span>
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

      <p className="flex items-center justify-between text-xs text-ink-muted">
        <span>
          Combined price <Price american={combinedAmerican} />
        </span>
        <span>
          To return <Money cents={payout} currency={currency} />
        </span>
      </p>

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

      <div className="flex gap-2">
        <Button variant="secondary" onClick={slip.clear} className="flex-1">
          Clear
        </Button>
        <Button onClick={submit} disabled={pending} className="flex-[2]">
          {pending ? 'Placing…' : 'Place bet'}
        </Button>
      </div>
    </div>
  );
}
