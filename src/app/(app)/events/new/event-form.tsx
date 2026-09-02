'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { americanToRational } from '@/domain/odds';
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_MARKETS_PER_EVENT,
  MAX_OUTCOMES_PER_MARKET,
  MIN_OUTCOMES_PER_MARKET,
  type CreateEventError,
} from '@/server/events/types';
import { createEventAction } from '../actions';

interface OutcomeDraft {
  id: string;
  label: string;
  priceAmerican: string;
}

interface MarketDraft {
  id: string;
  title: string;
  outcomes: OutcomeDraft[];
}

let nextDraftId = 0;
/** Stable ids for React keys, independent of array position, so add/remove doesn't steal focus. */
function newId(): string {
  nextDraftId += 1;
  return `d${nextDraftId}`;
}

function newOutcome(): OutcomeDraft {
  return { id: newId(), label: '', priceAmerican: '' };
}

function newMarket(): MarketDraft {
  return { id: newId(), title: '', outcomes: [newOutcome(), newOutcome()] };
}

/**
 * Sum of implied probability across a market's outcomes, as a percentage.
 *
 * Informational only (D38) — an invalid/empty price is simply left out of the sum rather
 * than blocking the readout, since the server is the real gate on price validity.
 */
function bookPercent(outcomes: OutcomeDraft[]): number | null {
  let sum = 0;
  let any = false;
  for (const outcome of outcomes) {
    const price = Number(outcome.priceAmerican);
    if (!Number.isInteger(price)) continue;
    try {
      const { num, den } = americanToRational(price);
      sum += Number(den) / Number(num);
      any = true;
    } catch {
      // Not a parseable price yet — leave it out rather than treating it as 0%.
    }
  }
  return any ? sum * 100 : null;
}

/** Errors without a market/outcome index of their own — shown as a form-level message. */
function bannerMessage(error: CreateEventError): string | null {
  switch (error.code) {
    case 'NOT_A_MEMBER':
      return 'You are not a member of the active season.';
    case 'INVALID_TITLE':
      return 'Give the event a title.';
    case 'INVALID_DESCRIPTION':
      return `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`;
    case 'INVALID_SCHEDULE':
      return 'Close time must be in the future, and resolve-by must be on or after it.';
    case 'INVALID_MARKET_COUNT':
      return `Add between ${error.min} and ${error.max} markets.`;
    case 'INVALID_MARKET':
    case 'INVALID_PRICE':
      return null;
  }
}

function marketErrorMessage(reason: Extract<CreateEventError, { code: 'INVALID_MARKET' }>['reason']): string {
  switch (reason) {
    case 'TITLE':
      return 'This market needs a title.';
    case 'OUTCOME_COUNT':
      return `Needs between ${MIN_OUTCOMES_PER_MARKET} and ${MAX_OUTCOMES_PER_MARKET} outcomes.`;
    case 'DUPLICATE_LABEL':
      return 'Outcome labels must be unique.';
    case 'LABEL':
      return 'Every outcome needs a label.';
  }
}

const fieldClass =
  'rounded-card border border-line-strong bg-surface-sunken px-3 py-2 text-sm';
const fieldErrorClass =
  'rounded-card border border-negative-line bg-surface-sunken px-3 py-2 text-sm';

export function EventForm() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [resolvesBy, setResolvesBy] = useState('');
  const [markets, setMarkets] = useState<MarketDraft[]>([newMarket()]);
  const [error, setError] = useState<CreateEventError | null>(null);
  const [pending, startTransition] = useTransition();

  function updateMarket(id: string, patch: Partial<MarketDraft>) {
    setMarkets((current) => current.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  function updateOutcome(marketId: string, outcomeId: string, patch: Partial<OutcomeDraft>) {
    setMarkets((current) =>
      current.map((m) =>
        m.id !== marketId
          ? m
          : { ...m, outcomes: m.outcomes.map((o) => (o.id === outcomeId ? { ...o, ...patch } : o)) },
      ),
    );
  }

  function addMarket() {
    setMarkets((current) =>
      current.length >= MAX_MARKETS_PER_EVENT ? current : [...current, newMarket()],
    );
  }

  function removeMarket(id: string) {
    setMarkets((current) => (current.length <= 1 ? current : current.filter((m) => m.id !== id)));
  }

  function addOutcome(marketId: string) {
    setMarkets((current) =>
      current.map((m) =>
        m.id !== marketId || m.outcomes.length >= MAX_OUTCOMES_PER_MARKET
          ? m
          : { ...m, outcomes: [...m.outcomes, newOutcome()] },
      ),
    );
  }

  function removeOutcome(marketId: string, outcomeId: string) {
    setMarkets((current) =>
      current.map((m) =>
        m.id !== marketId || m.outcomes.length <= MIN_OUTCOMES_PER_MARKET
          ? m
          : { ...m, outcomes: m.outcomes.filter((o) => o.id !== outcomeId) },
      ),
    );
  }

  function submit() {
    setError(null);

    startTransition(async () => {
      const result = await createEventAction({
        title,
        description,
        startsAtIso: startsAt ? new Date(startsAt).toISOString() : '',
        resolvesByIso: resolvesBy ? new Date(resolvesBy).toISOString() : '',
        markets: markets.map((m) => ({
          title: m.title,
          outcomes: m.outcomes.map((o) => ({
            label: o.label,
            priceAmerican: Number(o.priceAmerican),
          })),
        })),
      });

      // On success the action redirects server-side and this branch never runs.
      if (!result.ok) setError(result.error);
    });
  }

  const banner = error ? bannerMessage(error) : null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-6"
    >
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Title</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={error?.code === 'INVALID_TITLE' ? fieldErrorClass : fieldClass}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Description</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className={error?.code === 'INVALID_DESCRIPTION' ? fieldErrorClass : fieldClass}
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Closes</span>
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            className={error?.code === 'INVALID_SCHEDULE' ? fieldErrorClass : fieldClass}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Resolves by</span>
          <input
            type="datetime-local"
            value={resolvesBy}
            onChange={(e) => setResolvesBy(e.target.value)}
            className={error?.code === 'INVALID_SCHEDULE' ? fieldErrorClass : fieldClass}
          />
        </label>
      </div>

      <div className="flex flex-col gap-4">
        {markets.map((market, marketIndex) => {
          const pct = bookPercent(market.outcomes);
          const marketError =
            error?.code === 'INVALID_MARKET' && error.marketIndex === marketIndex ? error : null;

          return (
            <div
              key={market.id}
              className={`flex flex-col gap-3 rounded-xl border p-3 ${
                marketError ? 'border-negative-line' : 'border-line'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Market {marketIndex + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removeMarket(market.id)}
                  disabled={markets.length <= 1}
                  className="text-xs text-ink-muted hover:text-negative disabled:opacity-30"
                >
                  Remove market
                </button>
              </div>

              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium">Question</span>
                <input
                  value={market.title}
                  onChange={(e) => updateMarket(market.id, { title: e.target.value })}
                  className={fieldClass}
                />
              </label>

              {marketError ? (
                <p className="text-xs text-negative">{marketErrorMessage(marketError.reason)}</p>
              ) : null}

              <div className="flex flex-col gap-2">
                {market.outcomes.map((outcome, outcomeIndex) => {
                  const priceError =
                    error?.code === 'INVALID_PRICE' &&
                    error.marketIndex === marketIndex &&
                    error.outcomeIndex === outcomeIndex;

                  return (
                    <div key={outcome.id} className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <input
                          value={outcome.label}
                          onChange={(e) =>
                            updateOutcome(market.id, outcome.id, { label: e.target.value })
                          }
                          placeholder="Outcome label"
                          className={`min-w-0 flex-1 ${fieldClass}`}
                        />
                        <input
                          value={outcome.priceAmerican}
                          onChange={(e) =>
                            updateOutcome(market.id, outcome.id, { priceAmerican: e.target.value })
                          }
                          // "numeric" hides the minus key on iOS/Android; American odds need it.
                          inputMode="text"
                          placeholder="-110"
                          className={`w-24 tabular-nums ${priceError ? fieldErrorClass : fieldClass}`}
                        />
                        <button
                          type="button"
                          onClick={() => removeOutcome(market.id, outcome.id)}
                          disabled={market.outcomes.length <= MIN_OUTCOMES_PER_MARKET}
                          className="shrink-0 text-xs text-ink-muted hover:text-negative disabled:opacity-30"
                          aria-label={`Remove outcome ${outcomeIndex + 1}`}
                        >
                          Remove
                        </button>
                      </div>
                      {priceError ? (
                        <p className="text-xs text-negative">
                          Price must be -100 or lower, or 100 or higher.
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => addOutcome(market.id)}
                  disabled={market.outcomes.length >= MAX_OUTCOMES_PER_MARKET}
                  className="text-xs font-medium text-ink-secondary hover:underline disabled:opacity-30"
                >
                  + Add outcome
                </button>
                <span className="text-xs text-ink-muted">
                  Book: {pct === null ? '—' : `${Math.round(pct)}%`}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={addMarket}
        disabled={markets.length >= MAX_MARKETS_PER_EVENT}
        className="self-start rounded-xl border border-line-strong px-3 py-2 text-sm font-medium disabled:opacity-30"
      >
        + Add market
      </button>

      {banner ? <Callout>{banner}</Callout> : null}

      <Button type="submit" disabled={pending}>
        {pending ? 'Creating…' : 'Create event'}
      </Button>
    </form>
  );
}
