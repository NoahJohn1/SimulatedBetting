import { and, eq, inArray } from 'drizzle-orm';
import { db, type Tx } from '@/db/client';
import {
  betLegs,
  bets,
  games,
  markets,
  seasonMemberships,
  seasons,
  selections,
  users,
} from '@/db/schema';
import { postEntry } from '@/server/money/ledger';
import type { PlaceBetError, PlaceBetInput, PlaceBetResult } from './types';
import {
  quotePlacement,
  validatePlacement,
  type LoadedSelection,
  type PlacementContext,
} from './validate';

/** Thrown to unwind the transaction; carries the validation error back out. */
class PlacementRejected extends Error {
  constructor(readonly error: PlaceBetError) {
    super(error.code);
    this.name = 'PlacementRejected';
  }
}

type Reader = Tx | typeof db;

async function loadSelections(
  reader: Reader,
  input: PlaceBetInput,
): Promise<(LoadedSelection | null)[]> {
  const ids = [...new Set(input.legs.map((leg) => leg.selectionId))];
  if (ids.length === 0) return [];

  const rows = await reader
    .select({
      selectionId: selections.id,
      marketId: markets.id,
      marketType: markets.type,
      marketStatus: markets.status,
      side: selections.side,
      line: selections.line,
      priceAmerican: selections.priceAmerican,
      gameId: games.id,
      gameStatus: games.status,
      gameStartsAt: games.startsAt,
    })
    .from(selections)
    .innerJoin(markets, eq(selections.marketId, markets.id))
    .innerJoin(games, eq(markets.gameId, games.id))
    .where(inArray(selections.id, ids));

  const bySelectionId = new Map(rows.map((row) => [row.selectionId, row as LoadedSelection]));

  // Aligned 1:1 with input.legs in submission order — validatePlacement asserts this.
  return input.legs.map((leg) => bySelectionId.get(leg.selectionId) ?? null);
}

/**
 * The snapshot placement validates against. Exported so a caller that already quoted a slip
 * can hand back the same context it showed the user; `placeBet` always re-derives it inside
 * the transaction regardless, so a stale snapshot can only ever cost a rejection, never a
 * bad bet.
 */
export async function loadPlacementContext(
  input: PlaceBetInput,
  reader: Reader = db,
  lockMembership = false,
): Promise<PlacementContext> {
  const [user] = await reader
    .select({ status: users.status })
    .from(users)
    .where(eq(users.id, input.userId));

  const [activeSeason] = await reader
    .select({ id: seasons.id })
    .from(seasons)
    .where(eq(seasons.status, 'ACTIVE'));

  let membership: { id: string; balanceCents: bigint } | null = null;
  if (activeSeason) {
    const base = reader
      .select({ id: seasonMemberships.id, balanceCents: seasonMemberships.balanceCents })
      .from(seasonMemberships)
      .where(
        and(
          eq(seasonMemberships.userId, input.userId),
          eq(seasonMemberships.seasonId, activeSeason.id),
        ),
      );
    // The lock is taken before the balance is read, so a concurrent placement blocks here
    // and then re-reads the committed balance rather than the one it started with.
    const [row] = lockMembership ? await base.for('update') : await base;
    membership = row ?? null;
  }

  return {
    now: new Date(),
    user: { status: user?.status ?? 'PENDING' },
    membership,
    activeSeasonId: activeSeason?.id ?? null,
    selections: await loadSelections(reader, input),
  };
}

/**
 * Places exactly one bet. Multiple singles are multiple calls.
 *
 * Validation runs twice on purpose: once cheaply before opening a transaction, and once
 * inside it holding the membership row lock. Only the second is load-bearing — the first
 * just avoids paying for a transaction that was never going to commit.
 */
export async function placeBet(
  input: PlaceBetInput,
  preloadedContext?: PlacementContext,
): Promise<PlaceBetResult> {
  const context = preloadedContext ?? (await loadPlacementContext(input));

  const earlyError = validatePlacement(input, context);
  if (earlyError) {
    return { ok: false, error: earlyError };
  }

  try {
    return await db.transaction(async (tx) => {
      // Insert first: the unique client_request_id is the retry guard, and the returned id
      // is what the ledger idempotency key is built from.
      const quote = quotePlacement(input, context);
      const inserted = await tx
        .insert(bets)
        .values({
          membershipId: context.membership!.id,
          type: input.type,
          stakeCents: input.stakeCents,
          potentialPayoutCents: quote.potentialPayoutCents,
          combinedPriceAmerican: quote.combinedPriceAmerican,
          clientRequestId: input.clientRequestId,
        })
        .onConflictDoNothing({ target: bets.clientRequestId })
        .returning({ id: bets.id });

      if (inserted.length === 0) {
        const [existing] = await tx
          .select({ id: bets.id })
          .from(bets)
          .where(eq(bets.clientRequestId, input.clientRequestId));
        throw new PlacementRejected({ code: 'DUPLICATE_REQUEST', betId: existing.id });
      }

      const betId = inserted[0].id;

      const fresh = await loadPlacementContext(input, tx, true);
      const error = validatePlacement(input, fresh);
      if (error) {
        throw new PlacementRejected(error);
      }

      const freshSelections = fresh.selections as LoadedSelection[];
      const freshQuote = quotePlacement(input, fresh);

      await tx.insert(betLegs).values(
        input.legs.map((leg, i) => ({
          betId,
          selectionId: leg.selectionId,
          // Freeze what was actually offered, from the locked read — not from the
          // client's submission and not from a later read of `selections`.
          lineAtPlacement: freshSelections[i].line,
          priceAtPlacement: freshSelections[i].priceAmerican,
        })),
      );

      const posted = await postEntry(tx, {
        membershipId: fresh.membership!.id,
        amountCents: -input.stakeCents,
        type: 'BET_PLACED',
        idempotencyKey: `bet:${betId}:placed`,
        betId,
      });

      return {
        ok: true as const,
        bet: {
          id: betId,
          type: input.type,
          stakeCents: input.stakeCents,
          potentialPayoutCents: freshQuote.potentialPayoutCents,
          combinedPriceAmerican: freshQuote.combinedPriceAmerican,
          balanceAfterCents: posted.balanceCents,
          legs: input.legs.map((leg, i) => ({
            selectionId: leg.selectionId,
            line: freshSelections[i].line,
            priceAmerican: freshSelections[i].priceAmerican,
          })),
        },
      };
    });
  } catch (err) {
    if (err instanceof PlacementRejected) {
      return { ok: false, error: err.error };
    }
    throw err;
  }
}
