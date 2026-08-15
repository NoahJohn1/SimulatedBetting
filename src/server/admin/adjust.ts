import { db } from '@/db/client';
import { postEntry } from '@/server/money/ledger';

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

  const result = await db.transaction((tx) =>
    postEntry(tx, {
      membershipId: input.membershipId,
      amountCents: input.amountCents,
      type: input.amountCents > 0n ? 'ADMIN_CREDIT' : 'ADMIN_DEBIT',
      idempotencyKey: input.idempotencyKey,
      actorUserId: input.actorUserId,
      note: input.note,
    }),
  );

  return { balanceCents: result.balanceCents };
}
