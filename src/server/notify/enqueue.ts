import type { Tx } from '@/db/client';
import { notifications, type NotificationType } from '@/db/schema';
import { CHANNEL_FOR_TYPE } from './types';

export interface EnqueueInput {
  userId: string;
  type: NotificationType;
  /** Deterministic. The feed event's own dedupe key with the recipient appended (D63). */
  dedupeKey: string;
  payload: Record<string, unknown>;
}

/**
 * The single write path into the outbox.
 *
 * Takes a `tx` rather than opening its own, deliberately, and for the reason `emitFeedEvent`
 * gives: a notification that commits separately from the fact it describes can announce a
 * settlement that rolled back. Inside the transaction this is one INSERT with no joins and no
 * computation, so the only way it fails is a database that is unavailable — in which case the
 * settlement must not commit either.
 *
 * `ON CONFLICT DO NOTHING` on the unique key is what makes a `settle` re-run send nothing a
 * second time. That is the whole point of the table (D64).
 *
 * Preferences are NOT read here. They are applied at delivery, so this stays a pure function of
 * the fact rather than of who happens to be listening (D65).
 */
export async function enqueueNotification(
  tx: Tx,
  input: EnqueueInput,
): Promise<{ applied: boolean }> {
  const inserted = await tx
    .insert(notifications)
    .values({
      userId: input.userId,
      type: input.type,
      channel: CHANNEL_FOR_TYPE[input.type],
      dedupeKey: input.dedupeKey,
      payload: input.payload,
    })
    .onConflictDoNothing({ target: notifications.dedupeKey })
    .returning({ id: notifications.id });

  return { applied: inserted.length > 0 };
}
