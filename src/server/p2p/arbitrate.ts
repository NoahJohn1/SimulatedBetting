import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { p2pWagers } from '@/db/schema';
import { settleWagerInTx } from './settle-wager';
import type { ArbitrateWagerInput, ArbitrateWagerResult } from './types';

/** The statuses an admin can rule on: live, or already decided and being corrected. */
const ARBITRABLE = new Set(['ACCEPTED', 'SETTLED', 'VOIDED']);

/**
 * An admin decides a wager the two parties could not.
 *
 * Reached from the disputed and overdue queues, both of which are derived rather than
 * stored (D44). Three verdicts are available — `OFFERER`, `ACCEPTOR`, and `VOID` for the
 * case where a winner genuinely does not exist (D45).
 *
 * A wager that already settled is corrected rather than re-paid: `settleWagerInTx` reverses
 * every entry the previous attempt wrote before paying the new verdict, so history is
 * corrected by addition and never by edit (D15).
 *
 * The admin *check* lives at the route boundary in `requireAdmin()`, as it does for every
 * other admin action in this codebase. This function records who acted; it does not
 * re-derive whether they were allowed to.
 */
export async function arbitrateWager(input: ArbitrateWagerInput): Promise<ArbitrateWagerResult> {
  const note = input.note.trim();
  if (note.length === 0) return { ok: false, error: { code: 'NOTE_REQUIRED' } };

  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const [wager] = await tx
      .select()
      .from(p2pWagers)
      .where(eq(p2pWagers.id, input.wagerId))
      .for('update');

    if (!wager) return { ok: false as const, error: { code: 'WAGER_NOT_FOUND' as const } };
    if (!ARBITRABLE.has(wager.status)) {
      // An offer nobody took, or one already withdrawn or expired, has no pot to award.
      return {
        ok: false as const,
        error: { code: 'NOT_ARBITRABLE' as const, status: wager.status },
      };
    }

    const summary = await settleWagerInTx(tx, {
      wagerId: wager.id,
      verdict: input.verdict,
      settledAt: now,
      reason: 'ARBITRATED',
      byArbitration: true,
      actorUserId: input.actorUserId,
      note,
    });

    return { ok: true as const, attempt: summary.attempt, paidCents: summary.paidCents };
  });
}
