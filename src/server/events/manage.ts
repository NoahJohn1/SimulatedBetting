import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { betLegs, customEvents, events, markets, selections } from '@/db/schema';
import { isValidPriceAmerican } from './types';

export type ManageError =
  | { code: 'EVENT_NOT_FOUND' }
  | { code: 'MARKET_NOT_FOUND' }
  | { code: 'NOT_AUTHORIZED' }
  | { code: 'EVENT_NOT_OPEN' }
  | { code: 'EVENT_HAS_BETS' }
  // Not in the brief's union, but editing re-validates prices and the failure needs
  // somewhere to land. Shaped like `CreateEventError`'s INVALID_PRICE so the form can
  // highlight the same field either way.
  | { code: 'INVALID_PRICE'; marketIndex: number; outcomeIndex: number };

export type ManageResult = { ok: true } | { ok: false; error: ManageError };

export interface SetMarketStatusInput {
  marketId: string;
  status: 'OPEN' | 'SUSPENDED';
  actorMembershipId: string;
  isAdmin: boolean;
  now?: Date;
}

export interface EditCustomEventInput {
  eventId: string;
  actorMembershipId: string;
  title?: string;
  description?: string;
  markets: {
    marketId: string;
    title: string;
    outcomes: { selectionId: string; priceAmerican: number }[];
  }[];
}

/**
 * Suspension is the only lever a creator keeps once bets exist.
 *
 * It stops new bets and touches nothing already placed — placed legs froze their price at
 * placement (D10) and grade from that regardless. Reopening additionally requires that the
 * close time has not passed, because a market that reopened after `starts_at` would advertise
 * betting that placement itself would reject.
 */
export async function setMarketStatus(input: SetMarketStatusInput): Promise<ManageResult> {
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        marketStatus: markets.status,
        eventId: markets.eventId,
        startsAt: events.startsAt,
        creatorMembershipId: customEvents.creatorMembershipId,
        eventStatus: customEvents.status,
      })
      .from(markets)
      .innerJoin(events, eq(events.id, markets.eventId))
      // Inner join: a sports market has no custom_events row and is not a creator's to
      // suspend — the odds sync owns those.
      .innerJoin(customEvents, eq(customEvents.eventId, events.id))
      .where(eq(markets.id, input.marketId));

    if (!row) return { ok: false as const, error: { code: 'MARKET_NOT_FOUND' as const } };

    const isCreator = row.creatorMembershipId === input.actorMembershipId;
    if (!isCreator && !input.isAdmin) {
      return { ok: false as const, error: { code: 'NOT_AUTHORIZED' as const } };
    }

    // A resolved or voided event's markets are settled; their status is settlement's to own.
    if (row.eventStatus !== 'OPEN' || row.marketStatus === 'SETTLED') {
      return { ok: false as const, error: { code: 'EVENT_NOT_OPEN' as const } };
    }

    if (input.status === 'OPEN' && row.startsAt <= now) {
      return { ok: false as const, error: { code: 'EVENT_NOT_OPEN' as const } };
    }

    await tx.update(markets).set({ status: input.status }).where(eq(markets.id, input.marketId));

    // No feed card: creating, resolving, disputing and voiding are league news; a market
    // going on and off the board is not.
    return { ok: true as const };
  });
}

/**
 * Editing an event's wording and prices, allowed only while nobody has acted on it.
 *
 * Placed bets are immune to repricing anyway (D10) — this rule exists so the *displayed*
 * market cannot change out from under people who already read it and bet. The bet count is
 * taken inside the transaction, so a bet landing concurrently either blocks this edit or
 * loses to it, never straddles it.
 */
export async function editCustomEvent(input: EditCustomEventInput): Promise<ManageResult> {
  // Prices are checked before any transaction opens; it is a pure pass over the input.
  for (let m = 0; m < input.markets.length; m++) {
    const outcomes = input.markets[m].outcomes;
    for (let o = 0; o < outcomes.length; o++) {
      if (!isValidPriceAmerican(outcomes[o].priceAmerican)) {
        return { ok: false, error: { code: 'INVALID_PRICE', marketIndex: m, outcomeIndex: o } };
      }
    }
  }

  return db.transaction(async (tx) => {
    const [custom] = await tx
      .select()
      .from(customEvents)
      .where(eq(customEvents.eventId, input.eventId))
      .for('update');

    if (!custom) return { ok: false as const, error: { code: 'EVENT_NOT_FOUND' as const } };

    // Editing is the creator's alone. An admin who disagrees with a resolved event has
    // re-resolution and void; neither is a quiet rewrite of what people bet into.
    if (custom.creatorMembershipId !== input.actorMembershipId) {
      return { ok: false as const, error: { code: 'NOT_AUTHORIZED' as const } };
    }

    if (custom.status !== 'OPEN') {
      return { ok: false as const, error: { code: 'EVENT_NOT_OPEN' as const } };
    }

    const eventMarkets = await tx
      .select({ id: markets.id })
      .from(markets)
      .where(eq(markets.eventId, input.eventId));
    const marketIds = eventMarkets.map((m) => m.id);

    // Any leg at all, anywhere on the event, freezes the wording.
    if (marketIds.length > 0) {
      const [{ count }] = await tx
        .select({ count: sql<string>`COUNT(*)` })
        .from(betLegs)
        .innerJoin(selections, eq(selections.id, betLegs.selectionId))
        .where(inArray(selections.marketId, marketIds));

      if (Number(count) > 0) {
        return { ok: false as const, error: { code: 'EVENT_HAS_BETS' as const } };
      }
    }

    const known = new Set(marketIds);
    for (const market of input.markets) {
      if (!known.has(market.marketId)) {
        return { ok: false as const, error: { code: 'MARKET_NOT_FOUND' as const } };
      }
    }

    // Every submitted outcome has to belong to the market it was submitted under, or an
    // edit could reprice another event's board through a guessed id.
    const submittedSelectionIds = input.markets.flatMap((m) =>
      m.outcomes.map((o) => o.selectionId),
    );
    if (submittedSelectionIds.length > 0) {
      const owned = await tx
        .select({ id: selections.id, marketId: selections.marketId })
        .from(selections)
        .where(inArray(selections.id, submittedSelectionIds));
      const ownerBySelectionId = new Map(owned.map((row) => [row.id, row.marketId]));

      for (const market of input.markets) {
        for (const outcome of market.outcomes) {
          if (ownerBySelectionId.get(outcome.selectionId) !== market.marketId) {
            return { ok: false as const, error: { code: 'MARKET_NOT_FOUND' as const } };
          }
        }
      }
    }

    const title = input.title?.trim();
    if (title) {
      await tx.update(events).set({ title }).where(eq(events.id, input.eventId));
    }

    if (input.description !== undefined) {
      await tx
        .update(customEvents)
        .set({ description: input.description.trim() || null })
        .where(eq(customEvents.eventId, input.eventId));
    }

    for (const market of input.markets) {
      await tx
        .update(markets)
        .set({ title: market.title.trim() })
        .where(eq(markets.id, market.marketId));

      for (const outcome of market.outcomes) {
        await tx
          .update(selections)
          .set({ priceAmerican: outcome.priceAmerican, updatedAt: new Date() })
          .where(eq(selections.id, outcome.selectionId));
      }
    }

    // No feed card here either — a creator fixing a typo before anyone has bet is not news.
    return { ok: true as const };
  });
}
