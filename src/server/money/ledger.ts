import { eq } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { ledgerEntries, seasonMemberships, type LedgerEntryType } from '@/db/schema';
import { MoneyError } from './errors';

const ADMIN_TYPES: ReadonlySet<LedgerEntryType> = new Set(['ADMIN_CREDIT', 'ADMIN_DEBIT']);

export interface PostEntryInput {
  membershipId: string;
  amountCents: bigint;
  type: LedgerEntryType;
  idempotencyKey: string;
  actorUserId?: string;
  /** The bet this movement belongs to, for BET_PLACED and every settlement entry. */
  betId?: string;
  note?: string;
}

export interface PostEntryResult {
  applied: boolean;
  balanceCents: bigint;
}

export async function postEntry(tx: Tx, input: PostEntryInput): Promise<PostEntryResult> {
  if (ADMIN_TYPES.has(input.type) && !input.note?.trim()) {
    throw new MoneyError('NOTE_REQUIRED', `${input.type} requires a note`);
  }

  const [membership] = await tx
    .select({ balanceCents: seasonMemberships.balanceCents })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, input.membershipId))
    .for('update');

  if (!membership) {
    throw new MoneyError('MEMBERSHIP_NOT_FOUND', `no membership ${input.membershipId}`);
  }

  const nextBalance = membership.balanceCents + input.amountCents;
  if (nextBalance < 0n) {
    throw new MoneyError(
      'INSUFFICIENT_FUNDS',
      `balance ${membership.balanceCents} cannot absorb ${input.amountCents}`,
    );
  }

  const inserted = await tx
    .insert(ledgerEntries)
    .values({
      membershipId: input.membershipId,
      amountCents: input.amountCents,
      type: input.type,
      balanceAfterCents: nextBalance,
      actorUserId: input.actorUserId,
      betId: input.betId,
      note: input.note,
      idempotencyKey: input.idempotencyKey,
    })
    .onConflictDoNothing({ target: ledgerEntries.idempotencyKey })
    .returning({ id: ledgerEntries.id });

  if (inserted.length === 0) {
    return { applied: false, balanceCents: membership.balanceCents };
  }

  await tx
    .update(seasonMemberships)
    .set({ balanceCents: nextBalance })
    .where(eq(seasonMemberships.id, input.membershipId));

  return { applied: true, balanceCents: nextBalance };
}
