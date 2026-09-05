'use client';

import { useState } from 'react';
import { REACTION_EMOJI } from '@/server/feed/reaction-emoji';
import type { SerializedFeedCard } from './actions';

/**
 * The six-emoji row used to dominate every card's height, permanently. Collapsed by default
 * to whichever emoji already have a reaction (a card nobody has reacted to shows nothing but
 * the trigger) plus one "Add reaction" button; tapping it reveals the full six so a new
 * reaction is still one tap away. Picking one collapses the row back — the card returns to
 * its compact height rather than staying expanded.
 *
 * `expanded` is local to this card: two cards in the same feed can have one open and one
 * closed. The reaction *data* — counts, whether the viewer reacted, the optimistic update on
 * tap — stays owned by the parent, which is the only thing that knows how to roll a failed
 * toggle back.
 */
export function ReactionPicker({
  card,
  onToggle,
}: {
  card: SerializedFeedCard;
  onToggle: (emoji: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  // Iterate the fixed six in order and keep the ones with a count, rather than filtering
  // `card.reactions` directly — that array's order is whatever the DB's GROUP BY happened to
  // return, or (after an optimistic toggle) insertion order, neither of which is the "six,
  // fixed, in this order everywhere" invariant `reaction-emoji.ts` documents. The expanded
  // picker below already gets this for free by mapping REACTION_EMOJI; the compact view has
  // to do it deliberately since it only shows a subset.
  const active = REACTION_EMOJI.map((emoji) =>
    card.reactions.find((r) => r.emoji === emoji),
  ).filter((r): r is SerializedFeedCard['reactions'][number] => r !== undefined && r.count > 0);

  if (!expanded) {
    return (
      <div className="flex flex-wrap items-center gap-1">
        {active.map((r) => (
          <button
            key={r.emoji}
            type="button"
            onClick={() => onToggle(r.emoji)}
            aria-pressed={r.mine}
            className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
              r.mine ? 'border-accent bg-surface-muted' : 'border-line hover:bg-surface-sunken'
            }`}
          >
            {r.emoji}
            <span className="ml-1 tabular-nums">{r.count}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="rounded-full border border-line px-2 py-0.5 text-xs text-ink-muted hover:bg-surface-sunken"
        >
          Add reaction
        </button>
      </div>
    );
  }

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
            onClick={() => {
              onToggle(emoji);
              setExpanded(false);
            }}
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
