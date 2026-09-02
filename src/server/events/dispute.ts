import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { customEventDisputes, customEvents, events, seasonMemberships } from '@/db/schema';
import { emitFeedEvent } from '@/server/feed/emit';
import type { CustomEventDisputedPayload } from '@/server/feed/payload';

export const MAX_DISPUTE_REASON_LENGTH = 500;

export type DisputeError =
  | { code: 'EVENT_NOT_FOUND' }
  | { code: 'NOT_RESOLVED' }
  | { code: 'WRONG_SEASON' }
  | { code: 'REASON_REQUIRED' };

export interface DisputeResolutionInput {
  eventId: string;
  membershipId: string;
  reason: string;
  now?: Date;
}

export type DisputeResolutionResult =
  { ok: true; disputeId: string; created: boolean } | { ok: false; error: DisputeError };

/**
 * A dispute is state, not just an announcement: the admin queue queries this table rather
 * than reading the feed back, because the feed is a publication and not a system of record.
 *
 * It moves no money and changes no status. The correction is an admin re-resolution (D35).
 */
export async function disputeResolution(
  input: DisputeResolutionInput,
): Promise<DisputeResolutionResult> {
  const reason = input.reason.trim();
  if (reason.length === 0 || reason.length > MAX_DISPUTE_REASON_LENGTH) {
    return { ok: false, error: { code: 'REASON_REQUIRED' } };
  }

  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const [custom] = await tx
      .select()
      .from(customEvents)
      .where(eq(customEvents.eventId, input.eventId));

    if (!custom) return { ok: false as const, error: { code: 'EVENT_NOT_FOUND' as const } };
    if (custom.status !== 'RESOLVED') {
      return { ok: false as const, error: { code: 'NOT_RESOLVED' as const } };
    }

    const [membership] = await tx
      .select({ seasonId: seasonMemberships.seasonId })
      .from(seasonMemberships)
      .where(eq(seasonMemberships.id, input.membershipId));

    if (!membership || membership.seasonId !== custom.seasonId) {
      return { ok: false as const, error: { code: 'WRONG_SEASON' as const } };
    }

    const inserted = await tx
      .insert(customEventDisputes)
      .values({ eventId: input.eventId, membershipId: input.membershipId, reason })
      .onConflictDoNothing({
        target: [customEventDisputes.eventId, customEventDisputes.membershipId],
      })
      .returning({ id: customEventDisputes.id });

    if (inserted.length === 0) {
      // A second click is not an error; it is the same dispute.
      const [existing] = await tx
        .select({ id: customEventDisputes.id })
        .from(customEventDisputes)
        .where(
          and(
            eq(customEventDisputes.eventId, input.eventId),
            eq(customEventDisputes.membershipId, input.membershipId),
          ),
        );
      return { ok: true as const, disputeId: existing.id, created: false };
    }

    const [event] = await tx.select().from(events).where(eq(events.id, input.eventId));

    const payload: CustomEventDisputedPayload = {
      eventId: input.eventId,
      title: event.title,
      reason,
    };

    await emitFeedEvent(tx, {
      seasonId: custom.seasonId,
      type: 'CUSTOM_EVENT_DISPUTED',
      subjectMembershipId: input.membershipId,
      dedupeKey: `customevent:${input.eventId}:disputed:${input.membershipId}`,
      payload,
      occurredAt: now,
    });

    return { ok: true as const, disputeId: inserted[0].id, created: true };
  });
}
