import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedEvents, seasonMemberships, users } from '@/db/schema';
import { pickLeader } from '@/domain/milestones';
import { emitFeedEvent } from './emit';
import type { LeadChangePayload } from './payload';

/**
 * Emits MILESTONE_LEAD_CHANGE when the season's leader changes.
 *
 * The only derived event in the system: detecting it means comparing every membership's
 * balance, which has no business inside a bet's transaction. So it runs on its own, after
 * the settlement sweep and after an admin adjustment — the two things that actually reorder
 * standings. Not after the allowance run: crediting everyone the same amount cannot change
 * the order.
 *
 * Previous state is read back out of the last event's payload, which is the only place it
 * needs to exist. No snapshot table, no cursor, nothing to get stuck.
 */
export async function detectLeadChange(seasonId: string): Promise<{ emitted: boolean }> {
  const rows = await db
    .select({
      membershipId: seasonMemberships.id,
      balanceCents: seasonMemberships.balanceCents,
    })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.seasonId, seasonId))
    .orderBy(desc(seasonMemberships.balanceCents));

  const leader = pickLeader(rows);
  if (!leader) return { emitted: false };

  const priorEvents = await db
    .select({ payload: feedEvents.payload, subjectMembershipId: feedEvents.subjectMembershipId })
    .from(feedEvents)
    .where(
      and(eq(feedEvents.seasonId, seasonId), eq(feedEvents.type, 'MILESTONE_LEAD_CHANGE')),
    )
    // occurredAt is business time and can collide (this function's own emit defaults it to
    // `new Date()` at write time, so two calls landing in the same millisecond are a real
    // possibility). createdAt is a real defaultNow() timestamp recording actual write order,
    // so it is the correct tiebreaker for "which of these rows was written most recently" —
    // unlike feedEvents.id, which is a random UUID and carries no chronological meaning.
    .orderBy(desc(feedEvents.occurredAt), desc(feedEvents.createdAt));

  const previous = priorEvents[0] ?? null;
  if (previous?.subjectMembershipId === leader.membershipId) return { emitted: false };

  // rows is ordered by balance descending, so second place is the next distinct row.
  const runnerUp = rows.find((row) => row.membershipId !== leader.membershipId) ?? null;

  const [previousLeader] = previous?.subjectMembershipId
    ? await db
        .select({ displayName: users.displayName })
        .from(seasonMemberships)
        .innerJoin(users, eq(seasonMemberships.userId, users.id))
        .where(eq(seasonMemberships.id, previous.subjectMembershipId))
    : [];

  const payload: LeadChangePayload = {
    // Deterministic given prior state: two concurrent runs compute the same number and one
    // loses the unique-key race harmlessly.
    sequence: priorEvents.length + 1,
    previousLeaderMembershipId: previous?.subjectMembershipId ?? null,
    previousLeaderDisplayName: previousLeader?.displayName ?? null,
    balanceCents: leader.balanceCents.toString(),
    marginCents: (leader.balanceCents - (runnerUp?.balanceCents ?? 0n)).toString(),
  };

  const result = await db.transaction((tx) =>
    emitFeedEvent(tx, {
      seasonId,
      type: 'MILESTONE_LEAD_CHANGE',
      subjectMembershipId: leader.membershipId,
      dedupeKey: `lead:${seasonId}:${payload.sequence}`,
      payload,
    }),
  );

  return { emitted: result.applied };
}
