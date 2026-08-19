'use server';

import { redirect } from 'next/navigation';
import { requireAdmin } from '@/server/auth/session';
import { voidCustomEvent, type VoidError } from '@/server/events/resolve';

/**
 * Void an event from the admin queue.
 *
 * The actor is the session's user, never the client's claim — the same reason
 * `resolveEventAction` reads identity off the session rather than a form field. `requireAdmin`
 * is the real gate; the page hiding the control from non-admins is only a courtesy.
 */
export async function voidEventAction(input: {
  eventId: string;
  note: string;
}): Promise<{ ok: false; error: VoidError } | never> {
  const member = await requireAdmin();

  const result = await voidCustomEvent({
    eventId: input.eventId,
    actorUserId: member.userId,
    note: input.note,
  });

  if (!result.ok) return result;
  redirect('/admin/events');
}
