'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireApprovedMemberOrThrow } from '@/server/auth/session';
import { createCustomEvent } from '@/server/events/create';
import { disputeResolution, type DisputeResolutionResult } from '@/server/events/dispute';
import { editCustomEvent, setMarketStatus, type ManageError } from '@/server/events/manage';
import { resolveCustomEvent, type ResolveError } from '@/server/events/resolve';
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

/**
 * Resolve (or, from an admin, correct) an event's markets.
 *
 * The actor's identity and role come from the session, never the client — the same reason
 * `suspendMarketAction` reads `isAdmin` off `member.role` rather than trusting a form field.
 * The service is the real authority on who may do what; this only reports who is asking.
 */
export async function resolveEventAction(input: {
  eventId: string;
  winners: { marketId: string; winningSelectionId: string }[];
  note: string;
}): Promise<{ ok: false; error: ResolveError } | never> {
  const member = await requireApprovedMemberOrThrow();

  const result = await resolveCustomEvent({
    eventId: input.eventId,
    actorUserId: member.userId,
    actorMembershipId: member.membershipId,
    // The service decides what an admin may do; the action only reports who is asking.
    isAdmin: member.role === 'ADMIN',
    winners: input.winners,
    note: input.note,
  });

  if (!result.ok) return result;
  redirect(`/events/${input.eventId}`);
}

/** File a dispute against an event's resolution. Stays on the page — no redirect. */
export async function disputeEventAction(input: {
  eventId: string;
  reason: string;
}): Promise<DisputeResolutionResult> {
  const member = await requireApprovedMemberOrThrow();

  const result = await disputeResolution({
    eventId: input.eventId,
    membershipId: member.membershipId,
    reason: input.reason,
  });

  if (result.ok) revalidatePath(`/events/${input.eventId}`);
  return result;
}
