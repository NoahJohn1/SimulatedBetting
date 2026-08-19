import { and, eq, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, type Tx } from '@/db/client';
import {
  betLegs,
  bets,
  customEvents,
  events,
  games,
  markets,
  seasonMemberships,
  seasons,
  selections,
  teams,
  users,
  type CustomEventStatus,
  type EventKind,
  type GameStatus,
  type MarketStatusValue,
  type MarketTypeValue,
  type SelectionSide,
  type Sport,
} from '@/db/schema';
import type { MarketType, Side } from '@/domain/grading';
import { postEntry } from '@/server/money/ledger';
import { emitFeedEvent } from '@/server/feed/emit';
import { buildCustomLegSnapshot, buildLegSnapshot } from '@/server/feed/snapshot';
import type { BetPlacedPayload } from '@/server/feed/payload';
import type { PlaceBetError, PlaceBetInput, PlaceBetResult } from './types';
import {
  currencyForSelections,
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

const homeTeams = alias(teams, 'home_teams');
const awayTeams = alias(teams, 'away_teams');

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
      marketTitle: markets.title,
      side: selections.side,
      label: selections.label,
      line: selections.line,
      priceAmerican: selections.priceAmerican,
      eventId: events.id,
      eventKind: events.kind,
      eventTitle: events.title,
      eventStartsAt: events.startsAt,
      gameStatus: games.status,
      sport: games.sport,
      homeAbbr: homeTeams.abbreviation,
      awayAbbr: awayTeams.abbreviation,
      customStatus: customEvents.status,
      creatorMembershipId: customEvents.creatorMembershipId,
    })
    .from(selections)
    .innerJoin(markets, eq(selections.marketId, markets.id))
    .innerJoin(events, eq(markets.eventId, events.id))
    .leftJoin(games, eq(games.eventId, events.id))
    .leftJoin(homeTeams, eq(games.homeTeamId, homeTeams.id))
    .leftJoin(awayTeams, eq(games.awayTeamId, awayTeams.id))
    .leftJoin(customEvents, eq(customEvents.eventId, events.id))
    .where(inArray(selections.id, ids));

  const bySelectionId = new Map(rows.map((row) => [row.selectionId, toLoadedSelection(row)]));

  // Aligned 1:1 with input.legs in submission order — validatePlacement asserts this.
  return input.legs.map((leg) => bySelectionId.get(leg.selectionId) ?? null);
}

/**
 * Non-null assertions below are load-bearing and safe: a `GAME` event always has a `games`
 * row (the unique FK from Task 5) and a `CUSTOM` event always has a `custom_events` row (the
 * PK FK from Task 7). If either is ever null, the schema is broken and a crash is the
 * correct outcome — do not silently default them.
 */
function toLoadedSelection(row: {
  selectionId: string;
  marketId: string;
  marketType: MarketTypeValue;
  marketStatus: MarketStatusValue;
  marketTitle: string | null;
  side: SelectionSide | null;
  label: string | null;
  line: string | null;
  priceAmerican: number;
  eventId: string;
  eventKind: EventKind;
  eventTitle: string;
  eventStartsAt: Date;
  gameStatus: GameStatus | null;
  sport: Sport | null;
  homeAbbr: string | null;
  awayAbbr: string | null;
  customStatus: CustomEventStatus | null;
  creatorMembershipId: string | null;
}): LoadedSelection {
  if (row.eventKind === 'GAME') {
    return {
      kind: 'GAME',
      selectionId: row.selectionId,
      marketId: row.marketId,
      marketType: row.marketType as MarketType,
      marketStatus: row.marketStatus,
      side: row.side as Side,
      line: row.line,
      priceAmerican: row.priceAmerican,
      eventId: row.eventId,
      eventStartsAt: row.eventStartsAt,
      eventStatus: row.gameStatus!,
      sport: row.sport!,
      homeAbbr: row.homeAbbr!,
      awayAbbr: row.awayAbbr!,
    };
  }

  return {
    kind: 'CUSTOM',
    selectionId: row.selectionId,
    marketId: row.marketId,
    marketType: 'CUSTOM_OUTCOME',
    marketStatus: row.marketStatus,
    line: null,
    priceAmerican: row.priceAmerican,
    eventId: row.eventId,
    eventStartsAt: row.eventStartsAt,
    eventStatus: row.customStatus!,
    eventTitle: row.eventTitle,
    marketTitle: row.marketTitle!,
    outcomeLabel: row.label!,
    creatorMembershipId: row.creatorMembershipId!,
  };
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

  let membership: { id: string; balanceCents: bigint; creditsBalanceCents: bigint } | null = null;
  if (activeSeason) {
    const base = reader
      .select({
        id: seasonMemberships.id,
        balanceCents: seasonMemberships.balanceCents,
        creditsBalanceCents: seasonMemberships.creditsBalanceCents,
      })
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
      // is what the ledger idempotency key is built from. The fresh, lock-held selections
      // aren't loaded yet at this point, so currency is derived from the early context's
      // selections instead — already proven well-formed by the validation that just ran.
      // The re-validation below re-derives it from `fresh` and would reject any slip whose
      // kinds somehow changed between the two reads.
      const currency = currencyForSelections(context.selections as LoadedSelection[]);
      const quote = quotePlacement(input, context);
      const inserted = await tx
        .insert(bets)
        .values({
          membershipId: context.membership!.id,
          type: input.type,
          currency,
          stakeCents: input.stakeCents,
          potentialPayoutCents: quote.potentialPayoutCents,
          combinedPriceAmerican: quote.combinedPriceAmerican,
          clientRequestId: input.clientRequestId,
        })
        .onConflictDoNothing({ target: bets.clientRequestId })
        .returning({ id: bets.id, placedAt: bets.placedAt });

      if (inserted.length === 0) {
        const [existing] = await tx
          .select({ id: bets.id })
          .from(bets)
          .where(eq(bets.clientRequestId, input.clientRequestId));
        throw new PlacementRejected({ code: 'DUPLICATE_REQUEST', betId: existing.id });
      }

      const betId = inserted[0].id;
      const placedAt = inserted[0].placedAt;

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
        currency,
        idempotencyKey: `bet:${betId}:placed`,
        betId,
      });

      const payload: BetPlacedPayload = {
        betType: input.type,
        currency,
        stakeCents: input.stakeCents.toString(),
        potentialPayoutCents: freshQuote.potentialPayoutCents.toString(),
        combinedPriceAmerican: freshQuote.combinedPriceAmerican,
        legs: freshSelections.map((selection) =>
          selection.kind === 'GAME'
            ? buildLegSnapshot(
                { ...selection, startsAt: selection.eventStartsAt },
                { line: selection.line, priceAmerican: selection.priceAmerican },
              )
            : buildCustomLegSnapshot(
                {
                  eventTitle: selection.eventTitle,
                  marketTitle: selection.marketTitle,
                  outcomeLabel: selection.outcomeLabel,
                  startsAt: selection.eventStartsAt,
                  byCreator: selection.creatorMembershipId === fresh.membership!.id,
                },
                { priceAmerican: selection.priceAmerican },
              ),
        ),
      };

      await emitFeedEvent(tx, {
        seasonId: fresh.activeSeasonId!,
        type: 'BET_PLACED',
        subjectMembershipId: fresh.membership!.id,
        betId,
        dedupeKey: `bet:${betId}:placed`,
        payload,
        occurredAt: placedAt,
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
