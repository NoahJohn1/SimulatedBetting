import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { ledgerEntries, p2pWagers, users } from '@/db/schema';
import { potCents } from '@/domain/p2p';
import { emitFeedEvent } from '@/server/feed/emit';
import type { P2PSettledPayload, P2PVoidedPayload, P2PVoidReason } from '@/server/feed/payload';
import { postEntry } from '@/server/money/ledger';
import { loadSelectionSubject } from './subject';
import type { P2PVerdict } from './types';

export interface SettleWagerOptions {
  wagerId: string;
  verdict: P2PVerdict;
  settledAt: Date;
  /** Why both stakes are coming back. Ignored unless the verdict is VOID. */
  reason: P2PVoidReason;
  /** True when an admin decided it rather than the two parties agreeing. */
  byArbitration: boolean;
  actorUserId?: string;
  /** Mandatory on an arbitration; recorded on the wager and the card. */
  note?: string;
}

export interface SettleWagerSummary {
  attempt: number;
  /** Total credits moved out of escrow — the pot, whether won or refunded. */
  paidCents: bigint;
  /** Null on a VOID: nobody won. */
  winnerMembershipId: string | null;
}

/** The money entry types this module writes, and therefore the ones a reversal undoes. */
const PAYOUT_TYPES = ['P2P_WON', 'P2P_REFUND'] as const;

/**
 * `PAYOUT_TYPES` plus `SETTLEMENT_REVERSAL` itself — the full set of entry types that ever
 * move money for a settlement, used to net out what a wager still owes each member across an
 * unbounded chain of corrections (see the reversal block below).
 */
const SETTLEMENT_TYPES = [...PAYOUT_TYPES, 'SETTLEMENT_REVERSAL'] as const;

/**
 * The one and only place a wager pays out.
 *
 * `claimWinner`, `proposeCancel`, `sweepP2PWagers` and `arbitrateWager` all route through
 * here. Do not add a second payout path — every one of those four callers has a different
 * trigger but the identical money consequence, and duplicating it is how the two versions
 * drift apart.
 *
 * Takes a `tx` rather than opening its own, for the reason `emitFeedEvent` does: a payout
 * that commits separately from the decision that caused it can succeed when the decision
 * fails. **The caller must already hold `SELECT ... FOR UPDATE` on the wager row.**
 *
 * Re-settlement lives here too. A wager already `SETTLED` or `VOIDED` has everything paid so
 * far netted out and reversed, per member, before the new verdict is paid, so history is
 * corrected by addition and never by edit (D15). `settlementAttempts` feeds every idempotency
 * key, which is what stops a correction colliding with the payout it corrects.
 */
export async function settleWagerInTx(
  tx: Tx,
  opts: SettleWagerOptions,
): Promise<SettleWagerSummary> {
  const [wager] = await tx.select().from(p2pWagers).where(eq(p2pWagers.id, opts.wagerId));
  if (!wager) throw new Error(`no wager ${opts.wagerId}`);
  if (wager.acceptorMembershipId === null) {
    throw new Error(`wager ${opts.wagerId} was never accepted and cannot settle`);
  }

  const attempt = wager.settlementAttempts + 1;
  const pot = potCents(wager.offererStakeCents, wager.acceptorStakeCents);
  const note = opts.note?.trim() ?? null;

  // Undo the *net* effect of every prior attempt, one reversing entry per member still owed
  // money back. Netting across every payout AND every previous reversal (rather than summing
  // just P2P_WON/P2P_REFUND, or replaying each historical entry one-for-one) is what keeps a
  // third or later correction from re-reversing money a second attempt already unwound —
  // exactly the failure mode `resettleBetInTx`'s `netPaid` sum avoids on the single-bet path.
  if (wager.settlementAttempts > 0) {
    const netByMembership = await tx
      .select({
        membershipId: ledgerEntries.membershipId,
        netCents: sql<string>`coalesce(sum(${ledgerEntries.amountCents}), 0)`,
      })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.p2pWagerId, wager.id),
          inArray(ledgerEntries.type, [...SETTLEMENT_TYPES]),
        ),
      )
      .groupBy(ledgerEntries.membershipId);

    for (const { membershipId, netCents } of netByMembership) {
      const net = BigInt(netCents);
      if (net === 0n) continue;
      await postEntry(tx, {
        membershipId,
        amountCents: -net,
        type: 'SETTLEMENT_REVERSAL',
        currency: 'CREDITS',
        idempotencyKey: `p2p:${wager.id}:reversal:${attempt}:${membershipId}`,
        p2pWagerId: wager.id,
        actorUserId: opts.actorUserId,
        note: note ?? undefined,
      });
    }
  }

  const winnerMembershipId =
    opts.verdict === 'OFFERER'
      ? wager.offererMembershipId
      : opts.verdict === 'ACCEPTOR'
        ? wager.acceptorMembershipId
        : null;

  if (winnerMembershipId !== null) {
    await postEntry(tx, {
      membershipId: winnerMembershipId,
      amountCents: pot,
      type: 'P2P_WON',
      currency: 'CREDITS',
      idempotencyKey: `p2p:${wager.id}:settled:${attempt}:won`,
      p2pWagerId: wager.id,
      actorUserId: opts.actorUserId,
      note: note ?? undefined,
    });
  } else {
    // Each side gets back exactly what they put in — never half the pot each, which would
    // silently transfer credits whenever the stakes were asymmetric.
    for (const [membershipId, stake] of [
      [wager.offererMembershipId, wager.offererStakeCents],
      [wager.acceptorMembershipId, wager.acceptorStakeCents],
    ] as const) {
      await postEntry(tx, {
        membershipId,
        amountCents: stake,
        type: 'P2P_REFUND',
        currency: 'CREDITS',
        idempotencyKey: `p2p:${wager.id}:settled:${attempt}:refund:${membershipId}`,
        p2pWagerId: wager.id,
        actorUserId: opts.actorUserId,
        note: note ?? undefined,
      });
    }
  }

  await tx
    .update(p2pWagers)
    .set({
      status: opts.verdict === 'VOID' ? 'VOIDED' : 'SETTLED',
      verdict: opts.verdict,
      settledAt: opts.settledAt,
      settlementAttempts: attempt,
      resolvedByUserId: opts.byArbitration ? (opts.actorUserId ?? null) : null,
      resolutionNote: note,
    })
    .where(eq(p2pWagers.id, wager.id));

  const subject =
    wager.kind === 'FREEFORM'
      ? (wager.description ?? '')
      : ((await loadSelectionSubject(wager.selectionId!, tx))?.subject ?? '');

  if (opts.verdict === 'VOID') {
    let adminDisplayName: string | null = null;
    if (opts.byArbitration && opts.actorUserId) {
      const [admin] = await tx
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, opts.actorUserId));
      adminDisplayName = admin?.displayName ?? 'an admin';
    }

    const payload: P2PVoidedPayload = {
      wagerId: wager.id,
      subject,
      reason: opts.reason,
      refundedCents: pot.toString(),
      attempt,
      note,
      adminDisplayName,
    };

    await emitFeedEvent(tx, {
      seasonId: wager.seasonId,
      type: 'P2P_VOIDED',
      // No subject member: a void is about the wager, not about either party.
      dedupeKey: `p2p:${wager.id}:voided:${attempt}`,
      payload,
      occurredAt: opts.settledAt,
    });
  } else {
    const payload: P2PSettledPayload = {
      wagerId: wager.id,
      kind: wager.kind,
      verdict: opts.verdict,
      potCents: pot.toString(),
      subject,
      attempt,
      correction: attempt > 1,
      byArbitration: opts.byArbitration,
    };

    await emitFeedEvent(tx, {
      seasonId: wager.seasonId,
      type: 'P2P_SETTLED',
      subjectMembershipId: winnerMembershipId ?? undefined,
      dedupeKey: `p2p:${wager.id}:settled:${attempt}`,
      payload,
      occurredAt: opts.settledAt,
    });
  }

  return { attempt, paidCents: pot, winnerMembershipId };
}
