import type { MarketType, Side } from '@/domain/grading';
import type { Currency, Sport } from '@/db/schema';
import { currencyForKinds } from '@/domain/custom-grading';
import { americanToRational, combine, payoutCents, rationalToAmerican } from '@/domain/odds';
import { linesEqual, normalizeLine } from '@/domain/line';
import type { LineMovement, PlaceBetError, PlaceBetInput } from './types';

export const MIN_STAKE_CENTS = 100n;
export const MIN_PARLAY_LEGS = 2;
export const MAX_PARLAY_LEGS = 10;

export interface PlacementContext {
  now: Date;
  user: { status: 'PENDING' | 'APPROVED' | 'DISABLED' };
  membership: { id: string; balanceCents: bigint; creditsBalanceCents: bigint } | null;
  activeSeasonId: string | null;
  /**
   * One entry per submitted leg, in submission order. null when the selection doesn't
   * exist. Misalignment (wrong length, or entries out of submission order) is a bug in
   * the caller that builds this context, not something user input can cause — it is
   * asserted against in `validatePlacement`, not silently tolerated.
   */
  selections: (LoadedSelection | null)[];
}

interface LoadedSelectionBase {
  selectionId: string;
  marketId: string;
  marketStatus: 'OPEN' | 'SUSPENDED' | 'SETTLED';
  line: string | null;
  priceAmerican: number;
  eventId: string;
  eventStartsAt: Date;
  /** The subtype's own lifecycle value — `games.status` or `custom_events.status`. */
  eventStatus: string;
}

export interface LoadedGameSelection extends LoadedSelectionBase {
  kind: 'GAME';
  marketType: MarketType;
  side: Side;
  // Carried for the feed card's frozen snapshot, not for validation.
  sport: Sport;
  homeAbbr: string;
  awayAbbr: string;
}

export interface LoadedCustomSelection extends LoadedSelectionBase {
  kind: 'CUSTOM';
  marketType: 'CUSTOM_OUTCOME';
  eventTitle: string;
  marketTitle: string;
  outcomeLabel: string;
  creatorMembershipId: string;
}

export type LoadedSelection = LoadedGameSelection | LoadedCustomSelection;

/** Shared arithmetic for both the submitted-price quote and the current-price re-quote. */
function quoteFromPrices(
  stakeCents: bigint,
  prices: number[],
): { potentialPayoutCents: bigint; combinedPriceAmerican: number } {
  const combined = combine(prices.map((price) => americanToRational(price)));
  return {
    potentialPayoutCents: payoutCents(stakeCents, combined),
    combinedPriceAmerican: rationalToAmerican(combined),
  };
}

// `ctx` is kept for signature parity with the brief's PlacementContext-based API even though
// quoting the submitted prices never needs the snapshot (unlike the internal LINE_MOVED re-quote,
// which does use ctx's stored prices).
export function quotePlacement(
  input: PlaceBetInput,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ctx: PlacementContext,
): { potentialPayoutCents: bigint; combinedPriceAmerican: number } {
  return quoteFromPrices(
    input.stakeCents,
    input.legs.map((leg) => leg.priceAmerican),
  );
}

function isBettable(selection: LoadedSelection, now: Date): boolean {
  const open =
    selection.kind === 'GAME' ? selection.eventStatus === 'SCHEDULED' : selection.eventStatus === 'OPEN';
  return open && selection.eventStartsAt > now;
}

export function validatePlacement(
  input: PlaceBetInput,
  ctx: PlacementContext,
): PlaceBetError | null {
  // 1. Identity
  if (ctx.user.status !== 'APPROVED') {
    return { code: 'NOT_APPROVED' };
  }
  if (ctx.activeSeasonId === null) {
    return { code: 'NO_ACTIVE_SEASON' };
  }
  if (ctx.membership === null) {
    return { code: 'NOT_A_MEMBER' };
  }

  // 2. Shape

  // 2a. Malformed client-supplied leg values. Checked first because it only depends on
  // `input` itself, not `ctx` — cheapest and most context-independent thing to verify
  // before anything below assumes `line`/`priceAmerican` are well-formed. `line` and
  // `priceAmerican` come straight from the client, so a malformed value here is user
  // input, not a programmer bug — it must return a typed error, not throw. Reuses the
  // real parsers (never re-derives their validation) and checks line before price,
  // leg by leg, returning on the first invalid field found.
  for (let i = 0; i < input.legs.length; i++) {
    const leg = input.legs[i];
    try {
      normalizeLine(leg.line);
    } catch {
      return { code: 'INVALID_LEG_VALUE', legIndex: i, field: 'line' };
    }
    try {
      americanToRational(leg.priceAmerican);
    } catch {
      return { code: 'INVALID_LEG_VALUE', legIndex: i, field: 'priceAmerican' };
    }
  }

  for (let i = 0; i < input.legs.length; i++) {
    if (!ctx.selections[i]) {
      return { code: 'UNKNOWN_SELECTION', legIndex: i, selectionId: input.legs[i].selectionId };
    }
  }

  // Every selection is now known to exist. `PlacementContext.selections` is documented
  // to be aligned 1:1 with `input.legs` in submission order — assert that instead of
  // trusting it silently. A mismatch here can only come from a bug in the caller that
  // built `ctx` (never from user input, since the user doesn't control server-side
  // array construction), so a thrown error is correct: loud and immediate, rather than
  // either a crash further down or a validation result that's silently wrong.
  for (let i = 0; i < input.legs.length; i++) {
    const selection = ctx.selections[i] as LoadedSelection;
    if (selection.selectionId !== input.legs[i].selectionId) {
      throw new Error(
        `PlacementContext.selections misaligned at index ${i}: expected selectionId ` +
          `${JSON.stringify(input.legs[i].selectionId)} but found ${JSON.stringify(selection.selectionId)}`,
      );
    }
  }

  const legCount = input.legs.length;
  const min = input.type === 'SINGLE' ? 1 : MIN_PARLAY_LEGS;
  const max = input.type === 'SINGLE' ? 1 : MAX_PARLAY_LEGS;
  if (legCount < min || legCount > max) {
    return { code: 'INVALID_LEG_COUNT', legCount, min, max };
  }

  // At this point every selection is known (non-null), so we can safely assert.
  const selections = ctx.selections as LoadedSelection[];

  // Same-event legs are correlated for exactly the reason same-game legs are: "who wins the
  // cup" and "who wins the final" are not independent, and paying them at independent odds
  // is free money (D13, extended to events).
  const firstIndexByEventId = new Map<string, number>();
  let duplicateEventId: string | null = null;
  for (let i = 0; i < selections.length; i++) {
    const eventId = selections[i].eventId;
    if (firstIndexByEventId.has(eventId)) {
      duplicateEventId = eventId;
      break;
    }
    firstIndexByEventId.set(eventId, i);
  }
  if (duplicateEventId !== null) {
    const legIndexes = selections
      .map((selection, i) => (selection.eventId === duplicateEventId ? i : -1))
      .filter((i) => i !== -1);
    return { code: 'DUPLICATE_EVENT', eventId: duplicateEventId, legIndexes };
  }

  // Currency is derived from the legs, and a mixed slip is a shape one stake cannot
  // represent (D31). Checked before bettability so the clearest error wins.
  const derived = currencyForKinds(selections.map((s) => s.kind));
  if (!derived.ok) {
    return {
      code: 'MIXED_CURRENCY_PARLAY',
      gameLegIndexes: derived.gameIndexes,
      customLegIndexes: derived.customIndexes,
    };
  }

  // 3. Bettability — for each leg, check event-bettable then market-status before
  // advancing to the next leg.
  for (let i = 0; i < selections.length; i++) {
    const selection = selections[i];
    if (!isBettable(selection, ctx.now)) {
      return {
        code: 'EVENT_NOT_BETTABLE',
        legIndex: i,
        eventStatus: selection.eventStatus,
        startsAt: selection.eventStartsAt.toISOString(),
      };
    }
    if (selection.marketStatus !== 'OPEN') {
      return { code: 'MARKET_CLOSED', legIndex: i, marketStatus: selection.marketStatus };
    }
  }

  // 4. Stake
  if (input.stakeCents < MIN_STAKE_CENTS) {
    return { code: 'STAKE_BELOW_MINIMUM', stakeCents: input.stakeCents, minimumCents: MIN_STAKE_CENTS };
  }
  const available =
    derived.currency === 'CASH' ? ctx.membership.balanceCents : ctx.membership.creditsBalanceCents;
  if (input.stakeCents > available) {
    return { code: 'INSUFFICIENT_FUNDS', stakeCents: input.stakeCents, balanceCents: available };
  }

  // 5. Lines — check every leg, accumulating movements instead of stopping at the first.
  const movements: LineMovement[] = [];
  for (let i = 0; i < input.legs.length; i++) {
    const leg = input.legs[i];
    const selection = selections[i];
    const lineMoved = !linesEqual(leg.line, selection.line);
    const priceMoved = leg.priceAmerican !== selection.priceAmerican;
    if (lineMoved || priceMoved) {
      movements.push({
        legIndex: i,
        selectionId: leg.selectionId,
        submittedLine: leg.line,
        currentLine: selection.line,
        submittedPrice: leg.priceAmerican,
        currentPrice: selection.priceAmerican,
      });
    }
  }
  if (movements.length > 0) {
    const { potentialPayoutCents } = quoteFromPrices(
      input.stakeCents,
      selections.map((selection) => selection.priceAmerican),
    );
    return { code: 'LINE_MOVED', movements, newPotentialPayoutCents: potentialPayoutCents };
  }

  // 6. All rules passed.
  return null;
}

export function currencyForSelections(selections: LoadedSelection[]): Currency {
  const derived = currencyForKinds(selections.map((s) => s.kind));
  if (!derived.ok) throw new Error('mixed-currency slip reached currencyForSelections');
  return derived.currency;
}
