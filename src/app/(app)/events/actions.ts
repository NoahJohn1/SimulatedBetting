'use server';

import { redirect } from 'next/navigation';
import { requireApprovedMemberOrThrow } from '@/server/auth/session';
import { createCustomEvent } from '@/server/events/create';
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
