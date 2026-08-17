import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { seasonMemberships, users } from '@/db/schema';
import { postEntry } from '@/server/money/ledger';
import { emitFeedEvent } from '@/server/feed/emit';
import { detectLeadChange } from '@/server/feed/leaders';

export interface AdjustBalanceInput {
  membershipId: string;
  amountCents: bigint;
  note: string;
  actorUserId: string;
  idempotencyKey: string;
}

export async function adjustBalance(input: AdjustBalanceInput): Promise<{ balanceCents: bigint }> {
  if (input.amountCents === 0n) {
    throw new Error('adjustment must be non-zero');
  }

  const result = await db.transaction(async (tx) => {
    const posted = await postEntry(tx, {
      membershipId: input.membershipId,
      amountCents: input.amountCents,
      type: input.amountCents > 0n ? 'ADMIN_CREDIT' : 'ADMIN_DEBIT',
      idempotencyKey: input.idempotencyKey,
      actorUserId: input.actorUserId,
      note: input.note,
    });

    // A replayed adjustment moved no money, so it announces nothing.
    if (!posted.applied || posted.entryId === null) return posted;

    const [membership] = await tx
      .select({ seasonId: seasonMemberships.seasonId })
      .from(seasonMemberships)
      .where(eq(seasonMemberships.id, input.membershipId));

    const [admin] = await tx
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, input.actorUserId));

    // Published to the whole season on purpose (D24): an admin cannot quietly gift anyone
    // when the league watches every adjustment land.
    await emitFeedEvent(tx, {
      seasonId: membership.seasonId,
      type: 'ADMIN_ADJUSTMENT',
      subjectMembershipId: input.membershipId,
      ledgerEntryId: posted.entryId,
      dedupeKey: `ledger:${posted.entryId}`,
      payload: {
        amountCents: input.amountCents.toString(),
        note: input.note,
        adminDisplayName: admin?.displayName ?? 'an admin',
      },
    });

    return posted;
  });

  if (result.applied) {
    const [membership] = await db
      .select({ seasonId: seasonMemberships.seasonId })
      .from(seasonMemberships)
      .where(eq(seasonMemberships.id, input.membershipId));
    await detectLeadChange(membership.seasonId);
  }

  return { balanceCents: result.balanceCents };
}
