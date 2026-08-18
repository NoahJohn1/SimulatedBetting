import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { customEvents, events, markets, seasonMemberships, selections } from '@/db/schema';
import { americanToRational } from '@/domain/odds';
import { emitFeedEvent } from '@/server/feed/emit';
import type { CustomEventCreatedPayload } from '@/server/feed/payload';
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_MARKETS_PER_EVENT,
  MAX_OUTCOMES_PER_MARKET,
  MAX_TITLE_LENGTH,
  MIN_OUTCOMES_PER_MARKET,
  type CreateCustomEventInput,
  type CreateCustomEventResult,
  type CreateEventError,
} from './types';

/**
 * Validation is a pure pass over the input, run before any transaction opens.
 *
 * Prices are checked for *parseability*, never for sanity: a creator may offer +50000 on a
 * coin flip, and those are their credits to give away (D38).
 */
function validate(input: CreateCustomEventInput, now: Date): CreateEventError | null {
  const title = input.title.trim();
  if (title.length === 0 || title.length > MAX_TITLE_LENGTH) return { code: 'INVALID_TITLE' };

  if ((input.description ?? '').length > MAX_DESCRIPTION_LENGTH) {
    return { code: 'INVALID_DESCRIPTION' };
  }

  if (input.startsAt <= now || input.resolvesBy < input.startsAt) {
    return { code: 'INVALID_SCHEDULE' };
  }

  if (input.markets.length < 1 || input.markets.length > MAX_MARKETS_PER_EVENT) {
    return {
      code: 'INVALID_MARKET_COUNT',
      count: input.markets.length,
      min: 1,
      max: MAX_MARKETS_PER_EVENT,
    };
  }

  for (let m = 0; m < input.markets.length; m++) {
    const market = input.markets[m];
    const marketTitle = market.title.trim();
    if (marketTitle.length === 0 || marketTitle.length > MAX_TITLE_LENGTH) {
      return { code: 'INVALID_MARKET', marketIndex: m, reason: 'TITLE' };
    }

    if (
      market.outcomes.length < MIN_OUTCOMES_PER_MARKET ||
      market.outcomes.length > MAX_OUTCOMES_PER_MARKET
    ) {
      return { code: 'INVALID_MARKET', marketIndex: m, reason: 'OUTCOME_COUNT' };
    }

    const seen = new Set<string>();
    for (let o = 0; o < market.outcomes.length; o++) {
      const label = market.outcomes[o].label.trim();
      if (label.length === 0 || label.length > MAX_TITLE_LENGTH) {
        return { code: 'INVALID_MARKET', marketIndex: m, reason: 'LABEL' };
      }
      // Case- and whitespace-insensitive, because "Falcons" and " falcons " are the same
      // outcome to a reader and the unique index would not catch it.
      const key = label.toLowerCase();
      if (seen.has(key)) {
        return { code: 'INVALID_MARKET', marketIndex: m, reason: 'DUPLICATE_LABEL' };
      }
      seen.add(key);

      try {
        americanToRational(market.outcomes[o].priceAmerican);
      } catch {
        return { code: 'INVALID_PRICE', marketIndex: m, outcomeIndex: o };
      }
    }
  }

  return null;
}

export async function createCustomEvent(
  input: CreateCustomEventInput,
): Promise<CreateCustomEventResult> {
  const now = input.now ?? new Date();

  const error = validate(input, now);
  if (error) return { ok: false, error };

  const [membership] = await db
    .select({ id: seasonMemberships.id, seasonId: seasonMemberships.seasonId })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, input.creatorMembershipId));

  if (!membership) return { ok: false, error: { code: 'NOT_A_MEMBER' } };

  const eventId = await db.transaction(async (tx) => {
    const [event] = await tx
      .insert(events)
      .values({ kind: 'CUSTOM', title: input.title.trim(), startsAt: input.startsAt })
      .returning({ id: events.id });

    await tx.insert(customEvents).values({
      eventId: event.id,
      seasonId: membership.seasonId,
      creatorMembershipId: membership.id,
      description: input.description?.trim() || null,
      resolvesBy: input.resolvesBy,
    });

    for (const market of input.markets) {
      const [row] = await tx
        .insert(markets)
        .values({
          eventId: event.id,
          type: 'CUSTOM_OUTCOME',
          title: market.title.trim(),
          // Null, not a sentinel: there is no book behind a hand-priced market.
          sourceBook: null,
          status: 'OPEN',
        })
        .returning({ id: markets.id });

      await tx.insert(selections).values(
        market.outcomes.map((outcome, i) => ({
          marketId: row.id,
          side: null,
          line: null,
          label: outcome.label.trim(),
          priceAmerican: outcome.priceAmerican,
          sortOrder: i,
        })),
      );
    }

    const payload: CustomEventCreatedPayload = {
      eventId: event.id,
      title: input.title.trim(),
      marketCount: input.markets.length,
      startsAt: input.startsAt.toISOString(),
      resolvesBy: input.resolvesBy.toISOString(),
    };

    await emitFeedEvent(tx, {
      seasonId: membership.seasonId,
      type: 'CUSTOM_EVENT_CREATED',
      subjectMembershipId: membership.id,
      dedupeKey: `customevent:${event.id}:created`,
      payload,
      occurredAt: now,
    });

    return event.id;
  });

  return { ok: true, eventId };
}
