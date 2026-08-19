import { and, count, eq, lt } from 'drizzle-orm';
import { db } from '@/db/client';
import { betLegs, customEvents, events, markets, selections } from '@/db/schema';
import { emitFeedEvent } from '@/server/feed/emit';
import type { CustomEventOverduePayload } from '@/server/feed/payload';

/**
 * Finds open events past their resolve-by date and announces each one, exactly once.
 *
 * It moves no money and changes no status — overdue is derived, not stored (D37). Its whole
 * job is to make a forgotten event impossible to ignore; an admin then resolves or voids it.
 *
 * Called from the settle cron route rather than getting its own schedule, for the same
 * reason lead-change detection is: no new entry to keep in sync, and no cursor to get stuck.
 */
export async function sweepOverdueEvents(now: Date = new Date()): Promise<{ flagged: number }> {
  const overdue = await db
    .select({
      eventId: customEvents.eventId,
      seasonId: customEvents.seasonId,
      creatorMembershipId: customEvents.creatorMembershipId,
      resolvesBy: customEvents.resolvesBy,
      title: events.title,
    })
    .from(customEvents)
    .innerJoin(events, eq(events.id, customEvents.eventId))
    .where(and(eq(customEvents.status, 'OPEN'), lt(customEvents.resolvesBy, now)));

  for (const event of overdue) {
    const [{ openBets }] = await db
      .select({ openBets: count() })
      .from(betLegs)
      .innerJoin(selections, eq(betLegs.selectionId, selections.id))
      .innerJoin(markets, eq(selections.marketId, markets.id))
      .where(and(eq(markets.eventId, event.eventId), eq(betLegs.status, 'PENDING')));

    const payload: CustomEventOverduePayload = {
      eventId: event.eventId,
      title: event.title,
      resolvesBy: event.resolvesBy.toISOString(),
      openBetCount: openBets,
    };

    await db.transaction((tx) =>
      emitFeedEvent(tx, {
        seasonId: event.seasonId,
        type: 'CUSTOM_EVENT_OVERDUE',
        subjectMembershipId: event.creatorMembershipId,
        dedupeKey: `customevent:${event.eventId}:overdue`,
        payload,
        occurredAt: now,
      }),
    );
  }

  return { flagged: overdue.length };
}
