import type { MarketType, Side } from '@/domain/grading';
import { americanToRational, combine, payoutCents, rationalToAmerican } from '@/domain/odds';
import { linesEqual } from '@/domain/line';
import type { LineMovement, PlaceBetError, PlaceBetInput } from './types';

export const MIN_STAKE_CENTS = 100n;
export const MIN_PARLAY_LEGS = 2;
export const MAX_PARLAY_LEGS = 10;

export interface PlacementContext {
  now: Date;
  user: { status: 'PENDING' | 'APPROVED' | 'DISABLED' };
  membership: { id: string; balanceCents: bigint } | null;
  activeSeasonId: string | null;
  /** One entry per submitted leg, in submission order. null when the selection doesn't exist. */
  selections: (LoadedSelection | null)[];
}

export interface LoadedSelection {
  selectionId: string;
  marketId: string;
  marketType: MarketType;
  marketStatus: 'OPEN' | 'SUSPENDED' | 'SETTLED';
  side: Side;
  line: string | null;
  priceAmerican: number;
  gameId: string;
  gameStatus: string;
  gameStartsAt: Date;
}

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

function isGameBettable(selection: LoadedSelection, now: Date): boolean {
  return selection.gameStatus === 'SCHEDULED' && selection.gameStartsAt > now;
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
  for (let i = 0; i < input.legs.length; i++) {
    if (ctx.selections[i] === null) {
      return { code: 'UNKNOWN_SELECTION', legIndex: i, selectionId: input.legs[i].selectionId };
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

  // Scan in leg order; the first gameId seen a second time is "the first duplicated
  // gameId found, in leg order" — not necessarily the game with the earliest first
  // appearance (another game's repeat could be confirmed earlier in leg order).
  const firstIndexByGameId = new Map<string, number>();
  let duplicateGameId: string | null = null;
  for (let i = 0; i < selections.length; i++) {
    const gameId = selections[i].gameId;
    if (firstIndexByGameId.has(gameId)) {
      duplicateGameId = gameId;
      break;
    }
    firstIndexByGameId.set(gameId, i);
  }
  if (duplicateGameId !== null) {
    const legIndexes = selections
      .map((selection, i) => (selection.gameId === duplicateGameId ? i : -1))
      .filter((i) => i !== -1);
    return { code: 'DUPLICATE_GAME', gameId: duplicateGameId, legIndexes };
  }

  // 3. Bettability — for each leg, check game-bettable then market-status before
  // advancing to the next leg.
  for (let i = 0; i < selections.length; i++) {
    const selection = selections[i];
    if (!isGameBettable(selection, ctx.now)) {
      return {
        code: 'GAME_NOT_BETTABLE',
        legIndex: i,
        gameStatus: selection.gameStatus,
        startsAt: selection.gameStartsAt.toISOString(),
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
  if (input.stakeCents > ctx.membership.balanceCents) {
    return {
      code: 'INSUFFICIENT_FUNDS',
      stakeCents: input.stakeCents,
      balanceCents: ctx.membership.balanceCents,
    };
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
