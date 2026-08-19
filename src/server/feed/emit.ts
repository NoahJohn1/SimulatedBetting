import type { Tx } from '@/db/client';
import { feedEvents, type FeedEventType } from '@/db/schema';
import type { FeedEventPayload } from './payload';

export interface EmitFeedEventInput {
  seasonId: string;
  type: FeedEventType;
  /** Deterministic. Two calls describing the same fact must produce the same key. */
  dedupeKey: string;
  payload: FeedEventPayload;
  /** Null only for season-wide events (ALLOWANCE_PAID). */
  subjectMembershipId?: string;
  betId?: string;
  ledgerEntryId?: string;
  /** Business time. Defaults to now when the caller has no better answer. */
  occurredAt?: Date;
}

export interface EmitFeedEventResult {
  applied: boolean;
  eventId: string | null;
}

/**
 * The single write path for every feed event.
 *
 * Takes a `tx` rather than opening its own, deliberately: an event that commits separately
 * from the change it describes can succeed when the bet fails, producing a feed that lies.
 * Inside the transaction this is one INSERT with no joins and no computation, so the only
 * way it fails is a database that is unavailable — in which case the bet must not commit
 * either. Same argument `postEntry` already makes for the ledger (D23).
 */
export async function emitFeedEvent(
  tx: Tx,
  input: EmitFeedEventInput,
): Promise<EmitFeedEventResult> {
  const inserted = await tx
    .insert(feedEvents)
    .values({
      seasonId: input.seasonId,
      type: input.type,
      subjectMembershipId: input.subjectMembershipId,
      betId: input.betId,
      ledgerEntryId: input.ledgerEntryId,
      payload: input.payload,
      dedupeKey: input.dedupeKey,
      occurredAt: input.occurredAt ?? new Date(),
    })
    .onConflictDoNothing({ target: feedEvents.dedupeKey })
    .returning({ id: feedEvents.id });

  if (inserted.length === 0) return { applied: false, eventId: null };
  return { applied: true, eventId: inserted[0].id };
}
