'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireApprovedMemberOrThrow } from '@/server/auth/session';
import { createCustomEvent } from '@/server/events/create';
import { editCustomEvent, setMarketStatus, type ManageError } from '@/server/events/manage';
import type { CreateEventError } from '@/server/events/types';

export interface CreateEventFormValues {
  title: string;
  description: string;
  startsAtIso: string;
  resolvesByIso: string;
  markets: { title: string; outcomes: { label: string; priceAmerican: number }[] }[];
}

/**
 * Server action behind the "Create event" form.
 *
 * Authorization is re-checked here rather than trusted from the page that rendered the
 * form, and the creator id comes from the session — never from the client, which would let
 * anyone create an event as anyone else.
 */
export async function createEventAction(
  form: CreateEventFormValues,
): Promise<{ ok: false; error: CreateEventError } | never> {
  const member = await requireApprovedMemberOrThrow();

  const result = await createCustomEvent({
    creatorMembershipId: member.membershipId,
    title: form.title,
    description: form.description,
    startsAt: new Date(form.startsAtIso),
    resolvesBy: new Date(form.resolvesByIso),
    markets: form.markets,
  });

  if (!result.ok) return { ok: false, error: result.error };

  redirect(`/events/${result.eventId}`);
}

export type ManageActionResult = { ok: true } | { ok: false; error: ManageError };

/**
 * Suspend or reopen one market on a custom event.
 *
 * The actor is the session's membership, never the client's claim, and `isAdmin` comes from
 * the session's role for the same reason. `setMarketStatus` re-checks that the actor is the
 * creator or an admin regardless — this is authentication, the query is authorization.
 */
export async function suspendMarketAction(input: {
  eventId: string;
  marketId: string;
  status: 'OPEN' | 'SUSPENDED';
}): Promise<ManageActionResult> {
  const member = await requireApprovedMemberOrThrow();

  const result = await setMarketStatus({
    marketId: input.marketId,
    status: input.status,
    actorMembershipId: member.membershipId,
    isAdmin: member.role === 'ADMIN',
  });

  if (result.ok) revalidatePath(`/events/${input.eventId}`);
  return result;
}

/** Retitle and reprice an event's markets, allowed only while nobody has bet it. */
export async function editEventAction(input: {
  eventId: string;
  title?: string;
  description?: string;
  markets: {
    marketId: string;
    title: string;
    outcomes: { selectionId: string; priceAmerican: number }[];
  }[];
}): Promise<ManageActionResult> {
  const member = await requireApprovedMemberOrThrow();

  const result = await editCustomEvent({
    eventId: input.eventId,
    actorMembershipId: member.membershipId,
    title: input.title,
    description: input.description,
    markets: input.markets,
  });

  if (result.ok) revalidatePath(`/events/${input.eventId}`);
  return result;
}
