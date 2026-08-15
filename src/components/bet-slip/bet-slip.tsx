'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { placeBetAction } from '@/app/(app)/bets/actions';
import type { PlaceBetError } from '@/server/bets/types';
import { useSlip } from './slip-context';

/** Mirrors the domain formatter for the small amounts the slip quotes. */
function formatCentsString(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}$${whole}.${(abs % 100n).toString().padStart(2, '0')}`;
}

function message(error: PlaceBetError): string {
  switch (error.code) {
    case 'LINE_MOVED':
      return 'The line moved while the slip was open. Review the new price and try again.';
    case 'INSUFFICIENT_FUNDS':
      return `Not enough balance. You have ${formatCentsString(error.balanceCents)}.`;
    case 'STAKE_BELOW_MINIMUM':
      return `The minimum stake is ${formatCentsString(error.minimumCents)}.`;
    case 'DUPLICATE_GAME':
      return 'A parlay cannot have two legs from the same game.';
    case 'GAME_NOT_BETTABLE':
      return 'That game has already started or is no longer open.';
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

export function BetSlip() {
  const slip = useSlip();
  const router = useRouter();
  const [stake, setStake] = useState('10.00');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (slip.legs.length === 0) return null;

  const isParlay = slip.legs.length > 1;

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
        setPlaced(`Bet placed to return ${formatCentsString(result.bet.potentialPayoutCents)}`);
        slip.clear();
        router.refresh();
      } else {
        setError(message(result.error));
      }
    });
  }

  return (
    <div className="sticky bottom-0 z-20 border-t border-zinc-200 bg-white shadow-[0_-8px_24px_rgba(0,0,0,0.06)] dark:border-zinc-800 dark:bg-zinc-950">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3"
      >
        <span className="text-sm font-semibold">
          {isParlay ? `${slip.legs.length}-leg parlay` : '1 selection'}
        </span>
        <span className="text-xs text-zinc-500">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open ? (
        <div className="flex flex-col gap-3 px-4 pb-4">
          <ul className="flex flex-col gap-2">
            {slip.legs.map((leg) => (
              <li
                key={leg.selectionId}
                className="flex items-center justify-between gap-3 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-900"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{leg.label}</span>
                  <span className="text-xs text-zinc-500">{leg.marketLabel}</span>
                </span>
                <button
                  type="button"
                  onClick={() => slip.remove(leg.selectionId)}
                  className="shrink-0 text-xs text-zinc-400 hover:text-red-600"
                  aria-label={`Remove ${leg.label}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>

          <label className="flex items-center gap-3">
            <span className="text-sm text-zinc-500">Stake</span>
            <input
              inputMode="decimal"
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              className="w-28 rounded-lg border border-zinc-300 px-3 py-2 text-sm tabular-nums dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
          {placed ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{placed}</p> : null}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={slip.clear}
              className="h-11 flex-1 rounded-full border border-zinc-300 text-sm font-medium dark:border-zinc-700"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className="h-11 flex-[2] rounded-full bg-zinc-900 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
            >
              {pending ? 'Placing…' : 'Place bet'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
