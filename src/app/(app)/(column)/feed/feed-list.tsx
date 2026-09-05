'use client';

import { useState, useTransition } from 'react';
import { useToast } from '@/components/ui/toast';
import { FeedCardView } from './feed-card';
import { ReactionPicker } from './reaction-picker';
import { loadMoreFeedAction, toggleReactionAction, type SerializedFeedPage } from './actions';

export function FeedList({ initial }: { initial: SerializedFeedPage }) {
  const [cards, setCards] = useState(initial.cards);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

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
        toast({
          tone: 'negative',
          title:
            result.error === 'RATE_LIMITED'
              ? `You're reacting too quickly. Try again in ${result.retryAfterSeconds} seconds.`
              : 'That reaction did not stick',
        });
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 px-4 py-4">
      {cards.map((card) => (
        <FeedCardView
          key={card.id}
          card={card}
          reactionRow={<ReactionPicker card={card} onToggle={(emoji) => toggle(card.id, emoji)} />}
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
