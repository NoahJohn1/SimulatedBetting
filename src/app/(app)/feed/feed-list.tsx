'use client';

import { useState, useTransition } from 'react';
import { REACTION_EMOJI } from '@/server/feed/reaction-emoji';
import { Callout } from '@/components/ui/callout';
import { FeedCardView } from './feed-card';
import { loadMoreFeedAction, toggleReactionAction, type SerializedFeedPage } from './actions';

function ReactionRow({
  card,
  onToggle,
}: {
  card: SerializedFeedPage['cards'][number];
  onToggle: (emoji: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {REACTION_EMOJI.map((emoji) => {
        const existing = card.reactions.find((r) => r.emoji === emoji);
        const count = existing?.count ?? 0;
        const mine = existing?.mine ?? false;

        return (
          <button
            key={emoji}
            type="button"
            onClick={() => onToggle(emoji)}
            aria-pressed={mine}
            className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
              mine ? 'border-accent bg-surface-muted' : 'border-line hover:bg-surface-sunken'
            }`}
          >
            {emoji}
            {count > 0 ? <span className="ml-1 tabular-nums">{count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function FeedList({ initial }: { initial: SerializedFeedPage }) {
  const [cards, setCards] = useState(initial.cards);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function loadMore() {
    if (!cursor) return;
    startTransition(async () => {
      const next = await loadMoreFeedAction(cursor);
      setCards((current) => [...current, ...next.cards]);
      setCursor(next.nextCursor);
    });
  }

  function toggle(eventId: string, emoji: string) {
    const previous = cards;

    // Optimistic: the reaction row is the one place in the app where a round trip would be
    // felt, and the worst case is a count that corrects itself on the next render.
    setCards((current) =>
      current.map((card) => {
        if (card.id !== eventId) return card;

        const existing = card.reactions.find((r) => r.emoji === emoji);
        const reactions = existing
          ? card.reactions
              .map((r) =>
                r.emoji === emoji
                  ? { ...r, count: r.mine ? r.count - 1 : r.count + 1, mine: !r.mine }
                  : r,
              )
              .filter((r) => r.count > 0)
          : [...card.reactions, { emoji, count: 1, mine: true }];

        return { ...card, reactions };
      }),
    );

    startTransition(async () => {
      const result = await toggleReactionAction(eventId, emoji);
      // The handler previously discarded this result, which meant any refusal — a rate limit,
      // a wrong season, a deleted event — left the optimistic update standing as a lie until
      // something else refreshed the feed. Rate limiting is the first of those that happens in
      // normal use, so the rollback lands with it.
      if (result && 'error' in result) {
        setCards(previous);
        setError(
          result.error === 'RATE_LIMITED'
            ? `You're reacting too quickly. Try again in ${result.retryAfterSeconds} seconds.`
            : 'That reaction did not stick.',
        );
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 px-4 py-4">
      {error ? (
        <Callout tone="caution" className="mx-4">
          {error}
        </Callout>
      ) : null}

      {cards.map((card) => (
        <FeedCardView
          key={card.id}
          card={card}
          reactionRow={<ReactionRow card={card} onToggle={(emoji) => toggle(card.id, emoji)} />}
        />
      ))}

      {cursor ? (
        <button
          type="button"
          onClick={loadMore}
          disabled={pending}
          className="mt-2 rounded-xl border border-line py-2 text-sm font-medium disabled:opacity-50"
        >
          {pending ? 'Loading…' : 'Load more'}
        </button>
      ) : null}
    </div>
  );
}
