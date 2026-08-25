'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useSlip } from '@/components/bet-slip/slip-context';
import { Badge } from '@/components/ui/badge';
import { formatAmount } from '@/domain/money';
import { editEventAction, suspendMarketAction } from '../actions';

/**
 * Money crosses into this client component as decimal strings and becomes bigint here — the
 * same shape the feed payloads use. Never `Number` (D17).
 */
export interface MarketCardOutcome {
  selectionId: string;
  label: string;
  priceAmerican: number;
  stakedCreditsCents: string;
}

export interface MarketCardPosition {
  selectionId: string;
  stakeCents: string;
  /** The leg's own status, for the viewer's positions. The creator's line has no need of it. */
  status: string | null;
  /** Who holds it. A creator's position is disclosed to everyone who can see the page (D32). */
  holder: 'creator' | 'you';
}

export interface MarketCardProps {
  eventId: string;
  marketId: string;
  title: string;
  status: 'OPEN' | 'SUSPENDED' | 'SETTLED';
  winningSelectionId: string | null;
  outcomes: MarketCardOutcome[];
  positions: MarketCardPosition[];
  /** The event is OPEN and its close time has not passed — placement would accept a leg. */
  bettable: boolean;
  /** The viewer may suspend or reopen this market: creator or admin, while the event is OPEN. */
  canManage: boolean;
  /** The viewer may reprice it: creator, while the event still has no bets at all. */
  canEdit: boolean;
}

function signed(price: number): string {
  return price > 0 ? `+${price}` : String(price);
}

function credits(cents: string): string {
  return formatAmount(BigInt(cents), 'CREDITS');
}

function OutcomeButton({
  eventId,
  marketTitle,
  outcome,
}: {
  eventId: string;
  marketTitle: string;
  outcome: MarketCardOutcome;
}) {
  const slip = useSlip();
  const active = slip.has(outcome.selectionId);

  return (
    <button
      type="button"
      onClick={() =>
        slip.toggle({
          selectionId: outcome.selectionId,
          // The event id, not a game id: it is the dedup group key, and the server's own
          // key for the same rule is markets.event_id.
          gameId: eventId,
          // A custom outcome has no line — there is nothing to move (D10).
          line: null,
          priceAmerican: outcome.priceAmerican,
          label: outcome.label,
          marketLabel: marketTitle,
          currency: 'CREDITS',
        })
      }
      className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm transition-colors ${
        active
          ? 'border-accent bg-accent text-accent-ink'
          : 'border-line bg-surface-raised hover:border-line-hover'
      }`}
    >
      <span className="min-w-0 truncate font-medium">{outcome.label}</span>
      <span className="shrink-0 font-semibold tabular-nums">{signed(outcome.priceAmerican)}</span>
    </button>
  );
}

export function MarketCard(props: MarketCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(props.title);
  const [draftPrices, setDraftPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(props.outcomes.map((o) => [o.selectionId, String(o.priceAmerican)])),
  );

  // A suspended or settled market is read-only: the outcomes still show, so the reason
  // betting stopped is visible rather than mysterious.
  const tappable = props.bettable && props.status === 'OPEN';

  function setStatus(status: 'OPEN' | 'SUSPENDED') {
    setError(null);
    startTransition(async () => {
      const result = await suspendMarketAction({
        eventId: props.eventId,
        marketId: props.marketId,
        status,
      });
      if (result.ok) router.refresh();
      else setError(manageMessage(result.error.code));
    });
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await editEventAction({
        eventId: props.eventId,
        markets: [
          {
            marketId: props.marketId,
            title: draftTitle,
            outcomes: props.outcomes.map((o) => ({
              selectionId: o.selectionId,
              priceAmerican: Number(draftPrices[o.selectionId]),
            })),
          },
        ],
      });
      if (result.ok) {
        setEditing(false);
        router.refresh();
      } else {
        setError(manageMessage(result.error.code));
      }
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface-raised p-3">
      <div className="flex items-start justify-between gap-2">
        {editing ? (
          <input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-line-strong bg-surface-raised px-2 py-1 text-sm"
          />
        ) : (
          <h2 className="text-sm font-semibold">{props.title}</h2>
        )}
        {props.status === 'SUSPENDED' ? (
          <Badge tone="caution" className="shrink-0">
            Suspended
          </Badge>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        {props.outcomes.map((outcome) => {
          const won = props.winningSelectionId === outcome.selectionId;

          return (
            <div key={outcome.selectionId} className="flex flex-col gap-1">
              {editing ? (
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm">{outcome.label}</span>
                  <input
                    value={draftPrices[outcome.selectionId] ?? ''}
                    onChange={(e) =>
                      setDraftPrices((current) => ({
                        ...current,
                        [outcome.selectionId]: e.target.value,
                      }))
                    }
                    // "numeric" hides the minus key on iOS/Android; American odds need it.
                    inputMode="text"
                    className="w-24 rounded-lg border border-line-strong bg-surface-raised px-2 py-1 text-sm tabular-nums"
                  />
                </div>
              ) : tappable ? (
                <OutcomeButton
                  eventId={props.eventId}
                  marketTitle={props.title}
                  outcome={outcome}
                />
              ) : (
                <div
                  className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${
                    won ? 'border-positive-line bg-positive-surface-soft' : 'border-dashed border-line'
                  }`}
                >
                  <span className="min-w-0 truncate">
                    {outcome.label}
                    {won ? (
                      <span className="ml-2 text-xs font-semibold text-positive-on-surface">
                        Winner
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 tabular-nums">{signed(outcome.priceAmerican)}</span>
                </div>
              )}

              <div className="flex flex-col gap-0.5 px-1">
                <span className="text-xs text-ink-muted">
                  {credits(outcome.stakedCreditsCents)} staked
                </span>
                {props.positions
                  .filter((position) => position.selectionId === outcome.selectionId)
                  .map((position, i) => (
                    <span
                      key={`${position.holder}-${i}`}
                      className={`text-xs ${
                        position.holder === 'creator' ? 'text-caution-on-surface' : 'text-ink-secondary'
                      }`}
                    >
                      {position.holder === 'creator' ? 'creator' : 'you'} ·{' '}
                      {credits(position.stakeCents)}
                      {position.status && position.status !== 'PENDING'
                        ? ` · ${position.status}`
                        : ''}
                    </span>
                  ))}
              </div>
            </div>
          );
        })}
      </div>

      {error ? <p className="text-xs text-negative">{error}</p> : null}

      {props.canManage || props.canEdit ? (
        <div className="flex items-center gap-3 border-t border-line-subtle pt-2">
          {props.canManage && props.status !== 'SETTLED' ? (
            <button
              type="button"
              disabled={pending || editing}
              onClick={() => setStatus(props.status === 'OPEN' ? 'SUSPENDED' : 'OPEN')}
              className="text-xs font-medium text-ink-secondary hover:underline disabled:opacity-40"
            >
              {props.status === 'OPEN' ? 'Suspend' : 'Reopen'}
            </button>
          ) : null}

          {props.canEdit ? (
            editing ? (
              <>
                <button
                  type="button"
                  disabled={pending}
                  onClick={save}
                  className="text-xs font-medium text-ink hover:underline disabled:opacity-40"
                >
                  {pending ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setEditing(false);
                    setError(null);
                    setDraftTitle(props.title);
                    setDraftPrices(
                      Object.fromEntries(
                        props.outcomes.map((o) => [o.selectionId, String(o.priceAmerican)]),
                      ),
                    );
                  }}
                  className="text-xs text-ink-subtle hover:text-ink-secondary"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={() => setEditing(true)}
                className="text-xs font-medium text-ink-secondary hover:underline disabled:opacity-40"
              >
                Edit
              </button>
            )
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function manageMessage(code: string): string {
  switch (code) {
    case 'NOT_AUTHORIZED':
      return 'Only the creator or an admin can do that.';
    case 'EVENT_HAS_BETS':
      return 'Someone has already bet this event, so it can no longer be edited. Suspend it instead.';
    case 'EVENT_NOT_OPEN':
      return 'This event is closed, so its markets can no longer change.';
    case 'INVALID_PRICE':
      return 'Price must be -100 or lower, or 100 or higher.';
    default:
      return 'That change could not be saved.';
  }
}
