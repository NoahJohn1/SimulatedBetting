import { and, asc, eq, inArray } from 'drizzle-orm';
import { db, type Tx } from '@/db/client';
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
import { resettleBetInTx } from '@/server/bets/resettle';
import { settleBetsForLegs } from '@/server/bets/grade-legs';
import { buildCustomLegSnapshot } from '@/server/feed/snapshot';
import { emitFeedEvent } from '@/server/feed/emit';
import type { CustomEventResolvedPayload, CustomEventVoidedPayload } from '@/server/feed/payload';

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

/**
 * Extract a bet's legs for settlement. Used by both resolveCustomEvent and voidCustomEvent
 * to snapshot the leg metadata (status, price, market/event titles) for feed cards.
 */
function customSnapshotLegs(tx: Tx) {
  return async (betId: string) => {
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
  };
}

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

    let betsSettled = 0;
    let creditsPaid = 0n;

    const touchedBetIds = [...new Set(pending.map((leg) => leg.betId))];

    if (attempt === 1) {
      const summary = await settleBetsForLegs(tx, {
        betIds: touchedBetIds,
        settledAt: now,
        snapshotLegs: customSnapshotLegs(tx),
      });
      betsSettled = summary.betsSettled;
      creditsPaid = summary.centsPaid;
    } else {
      // Every bet on this event was already settled by the previous attempt, so correcting
      // it means reversing what that attempt paid — which is precisely resettleBet's job
      // (D15). resettleBetInTx re-grades from the markets' new winning_selection_id.
      const affected = await tx
        .selectDistinct({ betId: betLegs.betId })
        .from(betLegs)
        .innerJoin(selections, eq(betLegs.selectionId, selections.id))
        .where(inArray(selections.marketId, eventMarkets.map((m) => m.id)));

      for (const { betId } of affected) {
        const result = await resettleBetInTx(tx, {
          betId,
          actorUserId: input.actorUserId,
          note: input.note!.trim(),
        });
        if (result.ok) {
          betsSettled += 1;
          creditsPaid += result.paidCents;
        }
      }
    }

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
      betsSettled,
      creditsPaid,
    };
  });
}

export type VoidError =
  | { code: 'EVENT_NOT_FOUND' }
  | { code: 'ALREADY_VOIDED' }
  | { code: 'NOTE_REQUIRED' };

export interface VoidCustomEventInput {
  eventId: string;
  actorUserId: string;
  /** Required. A void moves money, so it says who and why (D15). */
  note: string;
  now?: Date;
}

export type VoidCustomEventResult =
  | { ok: true; refundedBets: number; refundedCents: bigint }
  | { ok: false; error: VoidError };

/**
 * Admin-only. Voids every bet on the event and refunds every stake — the same path a
 * postponed game already runs (D12), reached from a different trigger.
 *
 * A resolved event unwinds through `resettleBetInTx`, which reverses whatever the
 * resolution paid before writing the refund. An open event has nothing to reverse, so its
 * legs are voided in place and settled normally.
 */
export async function voidCustomEvent(
  input: VoidCustomEventInput,
): Promise<VoidCustomEventResult> {
  const note = input.note.trim();
  if (note.length === 0) return { ok: false, error: { code: 'NOTE_REQUIRED' as const } };

  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const [custom] = await tx
      .select()
      .from(customEvents)
      .where(eq(customEvents.eventId, input.eventId))
      .for('update');

    if (!custom) return { ok: false as const, error: { code: 'EVENT_NOT_FOUND' as const } };
    if (custom.status === 'VOIDED') {
      return { ok: false as const, error: { code: 'ALREADY_VOIDED' as const } };
    }

    const wasResolved = custom.status === 'RESOLVED';

    const eventMarkets = await tx
      .select({ id: markets.id })
      .from(markets)
      .where(eq(markets.eventId, input.eventId));
    const marketIds = eventMarkets.map((m) => m.id);

    // Flip the status first: resettleBetInTx re-grades from it, and a leg on a VOIDED event
    // grades VOIDED regardless of any winning_selection_id left behind.
    await tx
      .update(customEvents)
      .set({
        status: 'VOIDED',
        resolvedAt: now,
        resolvedByUserId: input.actorUserId,
        resolutionNote: note,
        resolutionAttempts: custom.resolutionAttempts + 1,
      })
      .where(eq(customEvents.eventId, input.eventId));

    await tx
      .update(customEventDisputes)
      .set({ resolvedAt: now })
      .where(eq(customEventDisputes.eventId, input.eventId));

    const affected = await tx
      .selectDistinct({ betId: betLegs.betId })
      .from(betLegs)
      .innerJoin(selections, eq(betLegs.selectionId, selections.id))
      .where(inArray(selections.marketId, marketIds));

    let refundedBets = 0;
    let refundedCents = 0n;

    if (wasResolved) {
      for (const { betId } of affected) {
        const result = await resettleBetInTx(tx, {
          betId,
          actorUserId: input.actorUserId,
          note,
        });
        if (result.ok) {
          refundedBets += 1;
          refundedCents += result.paidCents;
        }
      }
    } else {
      await tx
        .update(betLegs)
        .set({ status: 'VOIDED', settledAt: now })
        .where(
          and(
            inArray(
              betLegs.selectionId,
              tx.select({ id: selections.id }).from(selections).where(inArray(selections.marketId, marketIds)),
            ),
            eq(betLegs.status, 'PENDING'),
          ),
        );

      const summary = await settleBetsForLegs(tx, {
        betIds: affected.map((a) => a.betId),
        settledAt: now,
        snapshotLegs: customSnapshotLegs(tx),
      });
      refundedBets = summary.betsSettled;
      refundedCents = summary.centsPaid;
    }

    await tx
      .update(markets)
      .set({ status: 'SETTLED' })
      .where(eq(markets.eventId, input.eventId));

    const [event] = await tx.select().from(events).where(eq(events.id, input.eventId));
    const [admin] = await tx
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, input.actorUserId));

    const payload: CustomEventVoidedPayload = {
      eventId: input.eventId,
      title: event.title,
      note,
      refundedBetCount: refundedBets,
      refundedCreditsCents: refundedCents.toString(),
      adminDisplayName: admin?.displayName ?? 'an admin',
    };

    await emitFeedEvent(tx, {
      seasonId: custom.seasonId,
      type: 'CUSTOM_EVENT_VOIDED',
      // No subject: a void is about the event, not about any one member.
      dedupeKey: `customevent:${input.eventId}:voided`,
      payload,
      occurredAt: now,
    });

    return { ok: true as const, refundedBets, refundedCents };
  });
}
