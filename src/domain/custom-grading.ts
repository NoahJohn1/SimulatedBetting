import type { Currency, EventKind } from '@/db/schema';

/**
 * Grades one leg of a member-created market.
 *
 * A custom market has exactly one winning outcome, so grading is an identity comparison
 * against a stored value — never a computation over a result. That is the same discipline
 * `line_at_placement` enforces for spreads (D10), and it is what keeps this function pure
 * and exhaustively testable without a database.
 *
 * There is no PUSHED: an N-way market cannot tie. A market that should not have graded at
 * all is VOIDED by the void path, not by this function.
 */
export function gradeCustomLeg(input: {
  selectionId: string;
  winningSelectionId: string | null;
}): 'WON' | 'LOST' | 'PENDING' {
  if (input.winningSelectionId === null) return 'PENDING';
  return input.selectionId === input.winningSelectionId ? 'WON' : 'LOST';
}

export type CurrencyForKindsResult =
  | { ok: true; currency: Currency }
  | { ok: false; gameIndexes: number[]; customIndexes: number[] };

/**
 * Derives the currency a slip must be placed in, from the kinds of its legs.
 *
 * Games are cash, custom events are credits, and a bet carries one stake in one currency —
 * so a mixed slip is not a rule this code enforces so much as a shape the money model
 * cannot represent (D31). Both index lists come back so the UI can point at the offending
 * legs rather than saying "something is wrong".
 */
export function currencyForKinds(kinds: EventKind[]): CurrencyForKindsResult {
  if (kinds.length === 0) throw new Error('a bet needs at least one leg');

  const gameIndexes: number[] = [];
  const customIndexes: number[] = [];

  kinds.forEach((kind, i) => {
    if (kind === 'GAME') gameIndexes.push(i);
    else customIndexes.push(i);
  });

  if (gameIndexes.length > 0 && customIndexes.length > 0) {
    return { ok: false, gameIndexes, customIndexes };
  }

  return { ok: true, currency: gameIndexes.length > 0 ? 'CASH' : 'CREDITS' };
}
