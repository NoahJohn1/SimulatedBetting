import { eq } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { ledgerEntries, seasonMemberships, type Currency, type LedgerEntryType } from '@/db/schema';
import { MoneyError } from './errors';

const ADMIN_TYPES: ReadonlySet<LedgerEntryType> = new Set(['ADMIN_CREDIT', 'ADMIN_DEBIT']);

export interface PostEntryInput {
  membershipId: string;
  amountCents: bigint;
  type: LedgerEntryType;
  idempotencyKey: string;
  /** Which denomination moves. Defaults to CASH so every existing caller is unchanged. */
  currency?: Currency;
  actorUserId?: string;
  /** The bet this movement belongs to, for BET_PLACED and every settlement entry. */
  betId?: string;
  /** The wager this movement belongs to, for P2P escrow, payout and refund entries. */
  p2pWagerId?: string;
  note?: string;
}

export interface PostEntryResult {
  applied: boolean;
  /** The balance of this entry's own currency after the write. Never the other one. */
  balanceCents: bigint;
  /** The row this call inserted, or null when the idempotency key already existed. */
  entryId: string | null;
}

export async function postEntry(tx: Tx, input: PostEntryInput): Promise<PostEntryResult> {
  if (ADMIN_TYPES.has(input.type) && !input.note?.trim()) {
    throw new MoneyError('NOTE_REQUIRED', `${input.type} requires a note`);
  }

  const currency: Currency = input.currency ?? 'CASH';

  // One lock on the membership row covers both balances, so a cash write and a credits
  // write for the same member still serialize against each other. That is deliberate:
  // two cached columns on one row must not be updated by two racing transactions.
  const [membership] = await tx
    .select({
      balanceCents: seasonMemberships.balanceCents,
      creditsBalanceCents: seasonMemberships.creditsBalanceCents,
    })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, input.membershipId))
    .for('update');

  if (!membership) {
    throw new MoneyError('MEMBERSHIP_NOT_FOUND', `no membership ${input.membershipId}`);
  }

  const current = currency === 'CASH' ? membership.balanceCents : membership.creditsBalanceCents;
  const nextBalance = current + input.amountCents;
  if (nextBalance < 0n) {
    throw new MoneyError(
      'INSUFFICIENT_FUNDS',
      `${currency} balance ${current} cannot absorb ${input.amountCents}`,
    );
  }

  const inserted = await tx
    .insert(ledgerEntries)
    .values({
      membershipId: input.membershipId,
      amountCents: input.amountCents,
      type: input.type,
      currency,
      balanceAfterCents: nextBalance,
      actorUserId: input.actorUserId,
      betId: input.betId,
      p2pWagerId: input.p2pWagerId,
      note: input.note,
      idempotencyKey: input.idempotencyKey,
    })
    .onConflictDoNothing({ target: ledgerEntries.idempotencyKey })
    .returning({ id: ledgerEntries.id });

  if (inserted.length === 0) {
    return { applied: false, balanceCents: current, entryId: null };
  }

  await tx
    .update(seasonMemberships)
    .set(currency === 'CASH' ? { balanceCents: nextBalance } : { creditsBalanceCents: nextBalance })
    .where(eq(seasonMemberships.id, input.membershipId));

  return { applied: true, balanceCents: nextBalance, entryId: inserted[0].id };
}
