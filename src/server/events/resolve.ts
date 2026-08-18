import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  betLegs,
  customEventDisputes,
  customEvents,
  events,
  markets,
  selections,
  users,
} from '@/db/schema';
import type { LegStatus } from '@/domain/grading';
import { gradeCustomLeg } from '@/domain/custom-grading';
import { settleBetsForLegs } from '@/server/bets/grade-legs';
import { buildCustomLegSnapshot } from '@/server/feed/snapshot';
import { emitFeedEvent } from '@/server/feed/emit';
import type { CustomEventResolvedPayload } from '@/server/feed/payload';

export type ResolveError =
  | { code: 'EVENT_NOT_FOUND' }
  | { code: 'NOT_CUSTOM_EVENT' }
  | { code: 'NOT_AUTHORIZED' }
  | { code: 'ALREADY_VOIDED' }
  | { code: 'RE_RESOLUTION_IS_ADMIN_ONLY' }
  | { code: 'NOTE_REQUIRED' }
  | { code: 'INCOMPLETE_RESOLUTION'; missingMarketIds: string[] }
  | { code: 'UNKNOWN_MARKET'; marketId: string }
  | { code: 'SELECTION_NOT_IN_MARKET'; marketId: string; winningSelectionId: string };

export interface ResolveCustomEventInput {
  eventId: string;
  actorUserId: string;
  actorMembershipId: string;
  isAdmin: boolean;
  winners: { marketId: string; winningSelectionId: string }[];
  /** Required from the second attempt onward — D15's audit trail. */
  note?: string;
  now?: Date;
}

export type ResolveCustomEventResult =
  | { ok: true; attempt: number; betsSettled: number; creditsPaid: bigint }
  | { ok: false; error: ResolveError };

export async function resolveCustomEvent(
  input: ResolveCustomEventInput,
): Promise<ResolveCustomEventResult> {
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    // The lock is what serializes two people hitting Resolve at the same moment.
    const [custom] = await tx
      .select()
      .from(customEvents)
      .where(eq(customEvents.eventId, input.eventId))
      .for('update');

    if (!custom) return { ok: false as const, error: { code: 'EVENT_NOT_FOUND' as const } };
    if (custom.status === 'VOIDED') {
      return { ok: false as const, error: { code: 'ALREADY_VOIDED' as const } };
    }

    const isCreator = custom.creatorMembershipId === input.actorMembershipId;
    if (!isCreator && !input.isAdmin) {
      return { ok: false as const, error: { code: 'NOT_AUTHORIZED' as const } };
    }

    // A creator gets one shot. After that the league's referee is the referee (D35).
    if (custom.status === 'RESOLVED' && !input.isAdmin) {
      return { ok: false as const, error: { code: 'RE_RESOLUTION_IS_ADMIN_ONLY' as const } };
    }
    if (custom.status === 'RESOLVED' && !input.note?.trim()) {
      return { ok: false as const, error: { code: 'NOTE_REQUIRED' as const } };
    }

    const eventMarkets = await tx
      .select({ id: markets.id, title: markets.title })
      .from(markets)
      .where(eq(markets.eventId, input.eventId))
      .orderBy(asc(markets.createdAt));

    const byMarketId = new Map(eventMarkets.map((m) => [m.id, m]));
    const chosen = new Map<string, string>();

    for (const winner of input.winners) {
      if (!byMarketId.has(winner.marketId)) {
        return {
          ok: false as const,
          error: { code: 'UNKNOWN_MARKET' as const, marketId: winner.marketId },
        };
      }
      chosen.set(winner.marketId, winner.winningSelectionId);
    }

    const missingMarketIds = eventMarkets.filter((m) => !chosen.has(m.id)).map((m) => m.id);
    if (missingMarketIds.length > 0) {
      // Partial resolution is not a state this design has: a parlay leg on the missing
      // market could never grade.
      return {
        ok: false as const,
        error: { code: 'INCOMPLETE_RESOLUTION' as const, missingMarketIds },
      };
    }

    const outcomeRows = await tx
      .select({ id: selections.id, marketId: selections.marketId, label: selections.label })
      .from(selections)
      .where(inArray(selections.marketId, eventMarkets.map((m) => m.id)));

    for (const [marketId, winningSelectionId] of chosen) {
      const belongs = outcomeRows.some(
        (row) => row.id === winningSelectionId && row.marketId === marketId,
      );
      if (!belongs) {
        return {
          ok: false as const,
          error: { code: 'SELECTION_NOT_IN_MARKET' as const, marketId, winningSelectionId },
        };
      }
    }

    const attempt = custom.resolutionAttempts + 1;

    for (const [marketId, winningSelectionId] of chosen) {
      await tx
        .update(markets)
        .set({ winningSelectionId, status: 'SETTLED' })
        .where(eq(markets.id, marketId));
    }

    // Grade every pending leg on this event's markets from the stored winner.
    const pending = await tx
      .select({
        legId: betLegs.id,
        betId: betLegs.betId,
        selectionId: betLegs.selectionId,
        marketId: selections.marketId,
      })
      .from(betLegs)
      .innerJoin(selections, eq(betLegs.selectionId, selections.id))
      .where(
        and(
          inArray(selections.marketId, eventMarkets.map((m) => m.id)),
          eq(betLegs.status, 'PENDING'),
        ),
      );

    for (const leg of pending) {
      const status = gradeCustomLeg({
        selectionId: leg.selectionId,
        winningSelectionId: chosen.get(leg.marketId) ?? null,
      });
      await tx.update(betLegs).set({ status, settledAt: now }).where(eq(betLegs.id, leg.legId));
    }

    const [event] = await tx.select().from(events).where(eq(events.id, input.eventId));

    const summary = await settleBetsForLegs(tx, {
      betIds: [...new Set(pending.map((leg) => leg.betId))],
      settledAt: now,
      snapshotLegs: async (betId) => {
        const legs = await tx
          .select({
            status: betLegs.status,
            priceAtPlacement: betLegs.priceAtPlacement,
            label: selections.label,
            marketTitle: markets.title,
            eventTitle: events.title,
            eventStartsAt: events.startsAt,
            creatorMembershipId: customEvents.creatorMembershipId,
            membershipId: betLegs.betId,
          })
          .from(betLegs)
          .innerJoin(selections, eq(betLegs.selectionId, selections.id))
          .innerJoin(markets, eq(selections.marketId, markets.id))
          .innerJoin(events, eq(markets.eventId, events.id))
          .innerJoin(customEvents, eq(customEvents.eventId, events.id))
          .where(eq(betLegs.betId, betId))
          .orderBy(asc(betLegs.createdAt));

        return {
          statuses: legs.map((leg) => leg.status as LegStatus),
          prices: legs.map((leg) => leg.priceAtPlacement),
          snapshots: legs.map((leg) =>
            buildCustomLegSnapshot(
              {
                eventTitle: leg.eventTitle,
                marketTitle: leg.marketTitle ?? '',
                outcomeLabel: leg.label ?? '',
                startsAt: leg.eventStartsAt,
                // Recomputed rather than copied from the placement card: the card is a
                // frozen render snapshot, and this is a fresh one for a fresh event.
                byCreator: false,
              },
              { priceAmerican: leg.priceAtPlacement },
            ),
          ),
        };
      },
    });

    await tx
      .update(customEvents)
      .set({
        status: 'RESOLVED',
        resolvedAt: now,
        resolvedByUserId: input.actorUserId,
        resolutionNote: input.note?.trim() ?? null,
        resolutionAttempts: attempt,
      })
      .where(eq(customEvents.eventId, input.eventId));

    // Any dispute that prompted this correction is now answered.
    await tx
      .update(customEventDisputes)
      .set({ resolvedAt: now })
      .where(eq(customEventDisputes.eventId, input.eventId));

    const [actor] = await tx
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, input.actorUserId));

    const payload: CustomEventResolvedPayload = {
      eventId: input.eventId,
      title: event.title,
      outcomes: eventMarkets.map((market) => ({
        marketTitle: market.title ?? '',
        winningLabel:
          outcomeRows.find((row) => row.id === chosen.get(market.id))?.label ?? '',
      })),
      note: input.note?.trim() ?? null,
      attempt,
      correction: attempt > 1,
      resolvedByDisplayName: actor?.displayName ?? 'a member',
    };

    await emitFeedEvent(tx, {
      seasonId: custom.seasonId,
      type: 'CUSTOM_EVENT_RESOLVED',
      subjectMembershipId: input.actorMembershipId,
      dedupeKey: `customevent:${input.eventId}:resolved:${attempt}`,
      payload,
      occurredAt: now,
    });

    return {
      ok: true as const,
      attempt,
      betsSettled: summary.betsSettled,
      creditsPaid: summary.centsPaid,
    };
  });
}
