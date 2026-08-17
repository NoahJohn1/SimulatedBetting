import { describe, expect, it } from 'vitest';
import { americanToRational, combine, payoutCents } from '@/domain/odds';
import {
  MAX_PARLAY_LEGS,
  MIN_PARLAY_LEGS,
  MIN_STAKE_CENTS,
  quotePlacement,
  validatePlacement,
  type LoadedSelection,
  type PlacementContext,
} from '@/server/bets/validate';
import type { PlaceBetInput, PlaceBetLegInput } from '@/server/bets/types';

const NOW = new Date('2026-01-01T00:00:00Z');
const FUTURE = new Date('2026-01-02T00:00:00Z');

function makeSelection(overrides: Partial<LoadedSelection> = {}): LoadedSelection {
  return {
    selectionId: 'sel-1',
    marketId: 'mkt-1',
    marketType: 'MONEYLINE',
    marketStatus: 'OPEN',
    side: 'HOME',
    line: null,
    priceAmerican: -110,
    gameId: 'game-1',
    gameStatus: 'SCHEDULED',
    gameStartsAt: FUTURE,
    sport: 'NFL',
    homeAbbr: 'HOME',
    awayAbbr: 'AWAY',
    ...overrides,
  };
}

function makeLeg(overrides: Partial<PlaceBetLegInput> = {}): PlaceBetLegInput {
  return {
    selectionId: 'sel-1',
    line: null,
    priceAmerican: -110,
    ...overrides,
  };
}

function makeInput(overrides: Partial<PlaceBetInput> = {}): PlaceBetInput {
  return {
    userId: 'user-1',
    type: 'SINGLE',
    stakeCents: 1_000n,
    legs: [makeLeg()],
    clientRequestId: 'req-1',
    ...overrides,
  };
}

function makeCtx(overrides: Partial<PlacementContext> = {}): PlacementContext {
  return {
    now: NOW,
    user: { status: 'APPROVED' },
    membership: { id: 'mem-1', balanceCents: 10_000n },
    activeSeasonId: 'season-1',
    selections: [makeSelection()],
    ...overrides,
  };
}

describe('validatePlacement: identity', () => {
  it('rejects a PENDING user', () => {
    const result = validatePlacement(makeInput(), makeCtx({ user: { status: 'PENDING' } }));
    expect(result).toEqual({ code: 'NOT_APPROVED' });
  });

  it('rejects a DISABLED user', () => {
    const result = validatePlacement(makeInput(), makeCtx({ user: { status: 'DISABLED' } }));
    expect(result).toEqual({ code: 'NOT_APPROVED' });
  });

  it('rejects when there is no active season', () => {
    const result = validatePlacement(makeInput(), makeCtx({ activeSeasonId: null }));
    expect(result).toEqual({ code: 'NO_ACTIVE_SEASON' });
  });

  it('rejects an approved user with no membership', () => {
    const result = validatePlacement(makeInput(), makeCtx({ membership: null }));
    expect(result).toEqual({ code: 'NOT_A_MEMBER' });
  });
});

describe('validatePlacement: shape', () => {
  it('rejects an unknown selection with the right legIndex', () => {
    const result = validatePlacement(makeInput(), makeCtx({ selections: [null] }));
    expect(result).toEqual({ code: 'UNKNOWN_SELECTION', legIndex: 0, selectionId: 'sel-1' });
  });

  it('returns the first unknown selection when several legs are unknown', () => {
    const input = makeInput({
      type: 'PARLAY',
      legs: [makeLeg({ selectionId: 'sel-a' }), makeLeg({ selectionId: 'sel-b' })],
    });
    const ctx = makeCtx({ selections: [null, null] });
    const result = validatePlacement(input, ctx);
    expect(result).toEqual({ code: 'UNKNOWN_SELECTION', legIndex: 0, selectionId: 'sel-a' });
  });

  it('checks unknown selections before leg count, even for a too-short SINGLE', () => {
    const input = makeInput({
      type: 'SINGLE',
      legs: [makeLeg({ selectionId: 'sel-a' }), makeLeg({ selectionId: 'sel-b', line: null })],
    });
    const ctx = makeCtx({
      selections: [
        makeSelection({ selectionId: 'sel-a', gameId: 'game-a' }),
        null,
      ],
    });
    const result = validatePlacement(input, ctx);
    expect(result).toEqual({ code: 'UNKNOWN_SELECTION', legIndex: 1, selectionId: 'sel-b' });
  });

  it('reports UNKNOWN_SELECTION for a leg missing from a too-short selections array', () => {
    const input = makeInput({
      type: 'PARLAY',
      legs: [makeLeg({ selectionId: 'sel-a' }), makeLeg({ selectionId: 'sel-b' })],
    });
    const ctx = makeCtx({
      selections: [makeSelection({ selectionId: 'sel-a', gameId: 'game-a' })],
    });
    const result = validatePlacement(input, ctx);
    expect(result).toEqual({ code: 'UNKNOWN_SELECTION', legIndex: 1, selectionId: 'sel-b' });
  });

  it('throws when ctx.selections is misaligned with input.legs', () => {
    const input = makeInput({
      type: 'PARLAY',
      legs: [makeLeg({ selectionId: 'sel-a' }), makeLeg({ selectionId: 'sel-b' })],
    });
    const ctx = makeCtx({
      selections: [
        makeSelection({ selectionId: 'sel-b', gameId: 'game-b' }),
        makeSelection({ selectionId: 'sel-a', gameId: 'game-a' }),
      ],
    });
    expect(() => validatePlacement(input, ctx)).toThrow();
  });

  it('rejects a SINGLE with two legs', () => {
    const input = makeInput({
      type: 'SINGLE',
      legs: [
        makeLeg({ selectionId: 'sel-a' }),
        makeLeg({ selectionId: 'sel-b' }),
      ],
    });
    const ctx = makeCtx({
      selections: [
        makeSelection({ selectionId: 'sel-a', gameId: 'game-a' }),
        makeSelection({ selectionId: 'sel-b', gameId: 'game-b' }),
      ],
    });
    const result = validatePlacement(input, ctx);
    expect(result).toEqual({ code: 'INVALID_LEG_COUNT', legCount: 2, min: 1, max: 1 });
  });

  it('rejects a PARLAY with one leg', () => {
    const input = makeInput({ type: 'PARLAY', legs: [makeLeg()] });
    const result = validatePlacement(input, makeCtx());
    expect(result).toEqual({ code: 'INVALID_LEG_COUNT', legCount: 1, min: 2, max: 10 });
  });

  it('rejects a PARLAY with eleven legs', () => {
    const legs = Array.from({ length: 11 }, (_, i) => makeLeg({ selectionId: `sel-${i}` }));
    const selections = legs.map((leg, i) =>
      makeSelection({ selectionId: leg.selectionId, gameId: `game-${i}` }),
    );
    const result = validatePlacement(
      makeInput({ type: 'PARLAY', legs }),
      makeCtx({ selections }),
    );
    expect(result).toEqual({ code: 'INVALID_LEG_COUNT', legCount: 11, min: 2, max: 10 });
  });

  it('rejects two legs from the same game', () => {
    const input = makeInput({
      type: 'PARLAY',
      legs: [
        makeLeg({ selectionId: 'sel-a' }),
        makeLeg({ selectionId: 'sel-b' }),
      ],
    });
    const ctx = makeCtx({
      selections: [
        makeSelection({ selectionId: 'sel-a', gameId: 'game-1' }),
        makeSelection({ selectionId: 'sel-b', gameId: 'game-1' }),
      ],
    });
    const result = validatePlacement(input, ctx);
    expect(result).toEqual({ code: 'DUPLICATE_GAME', gameId: 'game-1', legIndexes: [0, 1] });
  });

  it('reports the first duplicated game when duplicates appear later in the legs', () => {
    const input = makeInput({
      type: 'PARLAY',
      legs: [
        makeLeg({ selectionId: 'sel-a' }),
        makeLeg({ selectionId: 'sel-b' }),
        makeLeg({ selectionId: 'sel-c' }),
      ],
    });
    const ctx = makeCtx({
      selections: [
        makeSelection({ selectionId: 'sel-a', gameId: 'game-1' }),
        makeSelection({ selectionId: 'sel-b', gameId: 'game-2' }),
        makeSelection({ selectionId: 'sel-c', gameId: 'game-2' }),
      ],
    });
    const result = validatePlacement(input, ctx);
    expect(result).toEqual({ code: 'DUPLICATE_GAME', gameId: 'game-2', legIndexes: [1, 2] });
  });

  it('finds the gameId confirmed as a duplicate earliest in leg order, not the one that appeared first', () => {
    // game-A appears first (leg 0) but its repeat isn't confirmed until leg 3.
    // game-B's repeat is confirmed at leg 2, which comes first in leg order.
    const input = makeInput({
      type: 'PARLAY',
      legs: [
        makeLeg({ selectionId: 'sel-w' }),
        makeLeg({ selectionId: 'sel-x' }),
        makeLeg({ selectionId: 'sel-y' }),
        makeLeg({ selectionId: 'sel-z' }),
      ],
    });
    const ctx = makeCtx({
      selections: [
        makeSelection({ selectionId: 'sel-w', gameId: 'game-A' }),
        makeSelection({ selectionId: 'sel-x', gameId: 'game-B' }),
        makeSelection({ selectionId: 'sel-y', gameId: 'game-B' }),
        makeSelection({ selectionId: 'sel-z', gameId: 'game-A' }),
      ],
    });
    const result = validatePlacement(input, ctx);
    expect(result).toEqual({ code: 'DUPLICATE_GAME', gameId: 'game-B', legIndexes: [1, 2] });
  });

  it('checks leg count before duplicate games', () => {
    const input = makeInput({
      type: 'SINGLE',
      legs: [
        makeLeg({ selectionId: 'sel-a' }),
        makeLeg({ selectionId: 'sel-b' }),
      ],
    });
    const ctx = makeCtx({
      selections: [
        makeSelection({ selectionId: 'sel-a', gameId: 'game-1' }),
        makeSelection({ selectionId: 'sel-b', gameId: 'game-1' }),
      ],
    });
    const result = validatePlacement(input, ctx);
    expect(result).toEqual({ code: 'INVALID_LEG_COUNT', legCount: 2, min: 1, max: 1 });
  });
});

describe('validatePlacement: malformed leg values', () => {
  it('rejects an invalid line', () => {
    const input = makeInput({ legs: [makeLeg({ line: 'abc' })] });
    const result = validatePlacement(input, makeCtx());
    expect(result).toEqual({ code: 'INVALID_LEG_VALUE', legIndex: 0, field: 'line' });
  });

  it('rejects an invalid priceAmerican inside the -99..99 dead band', () => {
    const input = makeInput({ legs: [makeLeg({ priceAmerican: 50 })] });
    const result = validatePlacement(input, makeCtx());
    expect(result).toEqual({ code: 'INVALID_LEG_VALUE', legIndex: 0, field: 'priceAmerican' });
  });

  it('reports the line before the price when both are invalid on the same leg', () => {
    const input = makeInput({ legs: [makeLeg({ line: 'abc', priceAmerican: 50 })] });
    const result = validatePlacement(input, makeCtx());
    expect(result).toEqual({ code: 'INVALID_LEG_VALUE', legIndex: 0, field: 'line' });
  });

  it('reports INVALID_LEG_VALUE before UNKNOWN_SELECTION for the same leg', () => {
    const input = makeInput({ legs: [makeLeg({ selectionId: 'sel-missing', line: 'abc' })] });
    const ctx = makeCtx({ selections: [null] });
    const result = validatePlacement(input, ctx);
    expect(result).toEqual({ code: 'INVALID_LEG_VALUE', legIndex: 0, field: 'line' });
  });

  it('still returns null for a genuinely valid line and price', () => {
    const input = makeInput({
      legs: [makeLeg({ line: '-3.5', priceAmerican: -110 })],
    });
    const ctx = makeCtx({
      selections: [makeSelection({ marketType: 'SPREAD', line: '-3.5', priceAmerican: -110 })],
    });
    const result = validatePlacement(input, ctx);
    expect(result).toBeNull();
  });
});

describe('validatePlacement: bettability', () => {
  it('rejects a game that is IN_PROGRESS', () => {
    const ctx = makeCtx({ selections: [makeSelection({ gameStatus: 'IN_PROGRESS' })] });
    const result = validatePlacement(makeInput(), ctx);
    expect(result).toEqual({
      code: 'GAME_NOT_BETTABLE',
      legIndex: 0,
      gameStatus: 'IN_PROGRESS',
      startsAt: FUTURE.toISOString(),
    });
  });

  it('rejects a game that is FINAL', () => {
    const ctx = makeCtx({ selections: [makeSelection({ gameStatus: 'FINAL' })] });
    const result = validatePlacement(makeInput(), ctx);
    expect(result).toEqual({
      code: 'GAME_NOT_BETTABLE',
      legIndex: 0,
      gameStatus: 'FINAL',
      startsAt: FUTURE.toISOString(),
    });
  });

  it('rejects a game whose kickoff is one second in the past', () => {
    const startsAt = new Date(NOW.getTime() - 1000);
    const ctx = makeCtx({ selections: [makeSelection({ gameStatus: 'SCHEDULED', gameStartsAt: startsAt })] });
    const result = validatePlacement(makeInput(), ctx);
    expect(result).toEqual({
      code: 'GAME_NOT_BETTABLE',
      legIndex: 0,
      gameStatus: 'SCHEDULED',
      startsAt: startsAt.toISOString(),
    });
  });

  it('allows a game whose kickoff is one second in the future', () => {
    const startsAt = new Date(NOW.getTime() + 1000);
    const ctx = makeCtx({ selections: [makeSelection({ gameStatus: 'SCHEDULED', gameStartsAt: startsAt })] });
    const result = validatePlacement(makeInput(), ctx);
    expect(result).toBeNull();
  });

  it('rejects a SUSPENDED market', () => {
    const ctx = makeCtx({ selections: [makeSelection({ marketStatus: 'SUSPENDED' })] });
    const result = validatePlacement(makeInput(), ctx);
    expect(result).toEqual({ code: 'MARKET_CLOSED', legIndex: 0, marketStatus: 'SUSPENDED' });
  });

  it('rejects a SETTLED market', () => {
    const ctx = makeCtx({ selections: [makeSelection({ marketStatus: 'SETTLED' })] });
    const result = validatePlacement(makeInput(), ctx);
    expect(result).toEqual({ code: 'MARKET_CLOSED', legIndex: 0, marketStatus: 'SETTLED' });
  });

  it('checks each leg in order, reporting the first unbettable leg', () => {
    const input = makeInput({
      type: 'PARLAY',
      legs: [
        makeLeg({ selectionId: 'sel-a' }),
        makeLeg({ selectionId: 'sel-b' }),
      ],
    });
    const ctx = makeCtx({
      selections: [
        makeSelection({ selectionId: 'sel-a', gameId: 'game-a' }),
        makeSelection({ selectionId: 'sel-b', gameId: 'game-b', gameStatus: 'IN_PROGRESS' }),
      ],
    });
    const result = validatePlacement(input, ctx);
    expect(result).toEqual({
      code: 'GAME_NOT_BETTABLE',
      legIndex: 1,
      gameStatus: 'IN_PROGRESS',
      startsAt: FUTURE.toISOString(),
    });
  });

  it('checks game-bettable and market-closed together per leg, before moving to the next leg', () => {
    // Leg 0 has a closed market. Leg 1 has an unbettable game. Because bettability is
    // evaluated leg-by-leg (both conditions for a leg before advancing), leg 0's market
    // problem is reported first even though it is a "later" kind of check than leg 1's.
    const input = makeInput({
      type: 'PARLAY',
      legs: [
        makeLeg({ selectionId: 'sel-a' }),
        makeLeg({ selectionId: 'sel-b' }),
      ],
    });
    const ctx = makeCtx({
      selections: [
        makeSelection({ selectionId: 'sel-a', gameId: 'game-a', marketStatus: 'SUSPENDED' }),
        makeSelection({ selectionId: 'sel-b', gameId: 'game-b', gameStatus: 'IN_PROGRESS' }),
      ],
    });
    const result = validatePlacement(input, ctx);
    expect(result).toEqual({ code: 'MARKET_CLOSED', legIndex: 0, marketStatus: 'SUSPENDED' });
  });
});

describe('validatePlacement: stake', () => {
  it('rejects a stake below the minimum', () => {
    const result = validatePlacement(makeInput({ stakeCents: 99n }), makeCtx());
    expect(result).toEqual({ code: 'STAKE_BELOW_MINIMUM', stakeCents: 99n, minimumCents: MIN_STAKE_CENTS });
  });

  it('allows a stake exactly at the minimum', () => {
    const result = validatePlacement(
      makeInput({ stakeCents: 100n }),
      makeCtx({ membership: { id: 'mem-1', balanceCents: 100n } }),
    );
    expect(result).toBeNull();
  });

  it('rejects a stake one cent over the balance', () => {
    const result = validatePlacement(
      makeInput({ stakeCents: 101n }),
      makeCtx({ membership: { id: 'mem-1', balanceCents: 100n } }),
    );
    expect(result).toEqual({ code: 'INSUFFICIENT_FUNDS', stakeCents: 101n, balanceCents: 100n });
  });

  it('allows a stake exactly equal to the balance', () => {
    const result = validatePlacement(
      makeInput({ stakeCents: 100n }),
      makeCtx({ membership: { id: 'mem-1', balanceCents: 100n } }),
    );
    expect(result).toBeNull();
  });
});

describe('validatePlacement: lines', () => {
  it('flags a price change as LINE_MOVED', () => {
    const input = makeInput({ stakeCents: 10_000n, legs: [makeLeg({ priceAmerican: -110 })] });
    const ctx = makeCtx({ selections: [makeSelection({ priceAmerican: -120 })] });
    const result = validatePlacement(input, ctx);
    const expectedPayout = payoutCents(10_000n, americanToRational(-120));
    expect(result).toEqual({
      code: 'LINE_MOVED',
      movements: [
        {
          legIndex: 0,
          selectionId: 'sel-1',
          submittedLine: null,
          currentLine: null,
          submittedPrice: -110,
          currentPrice: -120,
        },
      ],
      newPotentialPayoutCents: expectedPayout,
    });
  });

  it('flags a line change as LINE_MOVED', () => {
    const input = makeInput({
      stakeCents: 10_000n,
      legs: [makeLeg({ priceAmerican: -110, line: '-3' })],
    });
    const ctx = makeCtx({
      selections: [makeSelection({ marketType: 'SPREAD', priceAmerican: -110, line: '-4' })],
    });
    const result = validatePlacement(input, ctx);
    const expectedPayout = payoutCents(10_000n, americanToRational(-110));
    expect(result).toEqual({
      code: 'LINE_MOVED',
      movements: [
        {
          legIndex: 0,
          selectionId: 'sel-1',
          submittedLine: '-3',
          currentLine: '-4',
          submittedPrice: -110,
          currentPrice: -110,
        },
      ],
      newPotentialPayoutCents: expectedPayout,
    });
  });

  it('treats differently-formatted equal lines as unchanged', () => {
    const input = makeInput({ legs: [makeLeg({ priceAmerican: -110, line: '-3.50' })] });
    const ctx = makeCtx({
      selections: [makeSelection({ marketType: 'SPREAD', priceAmerican: -110, line: '-3.5' })],
    });
    const result = validatePlacement(input, ctx);
    expect(result).toBeNull();
  });

  it('flags a moneyline line of "0" against a stored null line as LINE_MOVED', () => {
    const input = makeInput({
      stakeCents: 10_000n,
      legs: [makeLeg({ priceAmerican: -110, line: '0' })],
    });
    const ctx = makeCtx({ selections: [makeSelection({ priceAmerican: -110, line: null })] });
    const result = validatePlacement(input, ctx);
    const expectedPayout = payoutCents(10_000n, americanToRational(-110));
    expect(result).toEqual({
      code: 'LINE_MOVED',
      movements: [
        {
          legIndex: 0,
          selectionId: 'sel-1',
          submittedLine: '0',
          currentLine: null,
          submittedPrice: -110,
          currentPrice: -110,
        },
      ],
      newPotentialPayoutCents: expectedPayout,
    });
  });

  it('collects movements from every moved leg into a single LINE_MOVED error', () => {
    const input = makeInput({
      type: 'PARLAY',
      stakeCents: 10_000n,
      legs: [
        makeLeg({ selectionId: 'sel-a', priceAmerican: -110 }),
        makeLeg({ selectionId: 'sel-b', priceAmerican: -110 }),
      ],
    });
    const ctx = makeCtx({
      selections: [
        makeSelection({ selectionId: 'sel-a', gameId: 'game-a', priceAmerican: -130 }),
        makeSelection({ selectionId: 'sel-b', gameId: 'game-b', priceAmerican: -140 }),
      ],
    });
    const result = validatePlacement(input, ctx);
    const expectedPayout = payoutCents(
      10_000n,
      combine([americanToRational(-130), americanToRational(-140)]),
    );
    expect(result).toEqual({
      code: 'LINE_MOVED',
      movements: [
        {
          legIndex: 0,
          selectionId: 'sel-a',
          submittedLine: null,
          currentLine: null,
          submittedPrice: -110,
          currentPrice: -130,
        },
        {
          legIndex: 1,
          selectionId: 'sel-b',
          submittedLine: null,
          currentLine: null,
          submittedPrice: -110,
          currentPrice: -140,
        },
      ],
      newPotentialPayoutCents: expectedPayout,
    });
  });
});

describe('validatePlacement: ordering', () => {
  it('returns NOT_APPROVED first even when other rules would also fail', () => {
    const input = makeInput({ stakeCents: 50n });
    const ctx = makeCtx({
      user: { status: 'DISABLED' },
      selections: [makeSelection({ gameStatus: 'FINAL' })],
    });
    const result = validatePlacement(input, ctx);
    expect(result).toEqual({ code: 'NOT_APPROVED' });
  });

  it('prefers shape errors over bettability errors', () => {
    const input = makeInput({
      type: 'PARLAY',
      legs: [
        makeLeg({ selectionId: 'sel-a' }),
        makeLeg({ selectionId: 'sel-b' }),
      ],
    });
    const ctx = makeCtx({
      selections: [
        makeSelection({ selectionId: 'sel-a', gameId: 'game-1', gameStatus: 'FINAL' }),
        makeSelection({ selectionId: 'sel-b', gameId: 'game-1', gameStatus: 'FINAL' }),
      ],
    });
    const result = validatePlacement(input, ctx);
    expect(result).toEqual({ code: 'DUPLICATE_GAME', gameId: 'game-1', legIndexes: [0, 1] });
  });

  it('prefers bettability errors over stake errors', () => {
    const input = makeInput({ stakeCents: 1n });
    const ctx = makeCtx({ selections: [makeSelection({ gameStatus: 'FINAL' })] });
    const result = validatePlacement(input, ctx);
    expect(result).toEqual({
      code: 'GAME_NOT_BETTABLE',
      legIndex: 0,
      gameStatus: 'FINAL',
      startsAt: FUTURE.toISOString(),
    });
  });

  it('prefers stake errors over line-movement errors', () => {
    const input = makeInput({ stakeCents: 1n, legs: [makeLeg({ priceAmerican: -110 })] });
    const ctx = makeCtx({ selections: [makeSelection({ priceAmerican: -200 })] });
    const result = validatePlacement(input, ctx);
    expect(result).toEqual({ code: 'STAKE_BELOW_MINIMUM', stakeCents: 1n, minimumCents: MIN_STAKE_CENTS });
  });

  it('returns null when every rule passes', () => {
    const result = validatePlacement(makeInput(), makeCtx());
    expect(result).toBeNull();
  });

  it('returns null for a valid PARLAY', () => {
    const input = makeInput({
      type: 'PARLAY',
      stakeCents: 10_000n,
      legs: [
        makeLeg({ selectionId: 'sel-a', priceAmerican: -110 }),
        makeLeg({ selectionId: 'sel-b', priceAmerican: -110 }),
        makeLeg({ selectionId: 'sel-c', priceAmerican: 150 }),
      ],
    });
    const ctx = makeCtx({
      selections: [
        makeSelection({ selectionId: 'sel-a', gameId: 'game-a', priceAmerican: -110 }),
        makeSelection({ selectionId: 'sel-b', gameId: 'game-b', priceAmerican: -110 }),
        makeSelection({ selectionId: 'sel-c', gameId: 'game-c', priceAmerican: 150 }),
      ],
    });
    const result = validatePlacement(input, ctx);
    expect(result).toBeNull();
  });
});

describe('quotePlacement', () => {
  it('quotes a three-leg -110/-110/+150 parlay on a 10_000n stake', () => {
    const input = makeInput({
      type: 'PARLAY',
      stakeCents: 10_000n,
      legs: [
        makeLeg({ selectionId: 'sel-a', priceAmerican: -110 }),
        makeLeg({ selectionId: 'sel-b', priceAmerican: -110 }),
        makeLeg({ selectionId: 'sel-c', priceAmerican: 150 }),
      ],
    });
    const ctx = makeCtx({
      selections: [
        makeSelection({ selectionId: 'sel-a', gameId: 'game-a', priceAmerican: -110 }),
        makeSelection({ selectionId: 'sel-b', gameId: 'game-b', priceAmerican: -110 }),
        makeSelection({ selectionId: 'sel-c', gameId: 'game-c', priceAmerican: 150 }),
      ],
    });
    const quote = quotePlacement(input, ctx);
    expect(quote.potentialPayoutCents).toBe(91_116n);
    expect(quote.combinedPriceAmerican).toBeGreaterThan(0);
  });

  it('quotes using the submitted prices, not the stored ones', () => {
    const input = makeInput({ stakeCents: 10_000n, legs: [makeLeg({ priceAmerican: -110 })] });
    const ctx = makeCtx({ selections: [makeSelection({ priceAmerican: -200 })] });
    const quote = quotePlacement(input, ctx);
    expect(quote.potentialPayoutCents).toBe(payoutCents(10_000n, americanToRational(-110)));
  });
});

describe('constants', () => {
  it('exposes the expected bounds', () => {
    expect(MIN_STAKE_CENTS).toBe(100n);
    expect(MIN_PARLAY_LEGS).toBe(2);
    expect(MAX_PARLAY_LEGS).toBe(10);
  });
});
