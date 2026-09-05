import { SlipPanel } from './slip-panel';

/**
 * The `lg+` bet slip: a sticky rail beside the board, rendering the same `SlipPanel` contents
 * as the `<lg` Sheet (bet-slip.tsx). Only `/games` mounts this — see its page.tsx's two-pane
 * grid — since the collapsed bar hides itself there once this rail exists, leaving exactly one
 * interactive slip per viewport (both remain in the DOM; only one has `display` other than
 * `none` at any given viewport).
 *
 * A plain server component: `SlipPanel` itself is the client boundary, and this wrapper adds
 * no state of its own.
 */
export function SlipRail({
  balanceCents,
  creditsBalanceCents,
}: {
  balanceCents: string;
  creditsBalanceCents: string;
}) {
  return (
    <aside className="hidden lg:block sticky top-16 self-start">
      <SlipPanel balanceCents={balanceCents} creditsBalanceCents={creditsBalanceCents} />
    </aside>
  );
}
