'use client';

import { useState, useTransition } from 'react';
import { REACTION_EMOJI } from '@/server/feed/reaction-emoji';
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
              mine
                ? 'border-zinc-900 bg-zinc-100 dark:border-zinc-100 dark:bg-zinc-800'
                : 'border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900'
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

  function loadMore() {
    if (!cursor) return;
    startTransition(async () => {
      const next = await loadMoreFeedAction(cursor);
      setCards((current) => [...current, ...next.cards]);
      setCursor(next.nextCursor);
    });
  }

  function toggle(eventId: string, emoji: string) {
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
      await toggleReactionAction(eventId, emoji);
    });
  }

  return (
    <div className="flex flex-col gap-2 px-4 py-4">
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
          className="mt-2 rounded-xl border border-zinc-200 py-2 text-sm font-medium disabled:opacity-50 dark:border-zinc-800"
        >
          {pending ? 'Loading…' : 'Load more'}
        </button>
      ) : null}
    </div>
  );
}
