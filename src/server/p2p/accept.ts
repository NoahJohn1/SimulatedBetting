import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { p2pWagers, seasonMemberships } from '@/db/schema';
import { potCents } from '@/domain/p2p';
import { emitFeedEvent } from '@/server/feed/emit';
import type { P2PAcceptedPayload } from '@/server/feed/payload';
import { postEntry } from '@/server/money/ledger';
import { loadSelectionSubject } from './subject';
import type { AcceptWagerInput, AcceptWagerResult } from './types';

/**
 * Takes the other side of an offer and escrows the acceptor's stake.
 *
 * The `FOR UPDATE` lock on the wager row, followed by re-reading `status` from the locked
 * row, is what makes an open offer acceptable by exactly one member: a second caller blocks
 * on the lock, then wakes to find the status already moved to ACCEPTED and is rejected. Do
 * not replace it with a read-then-update — the gap between the two is the bug.
 */
export async function acceptWager(input: AcceptWagerInput): Promise<AcceptWagerResult> {
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const [wager] = await tx
      .select()
      .from(p2pWagers)
      .where(eq(p2pWagers.id, input.wagerId))
      .for('update');

    if (!wager) return { ok: false as const, error: { code: 'WAGER_NOT_FOUND' as const } };
    if (wager.status !== 'OFFERED') {
      return {
        ok: false as const,
        error: { code: 'WAGER_NOT_OPEN' as const, status: wager.status },
      };
    }
    if (wager.expiresAt.getTime() <= now.getTime()) {
      return { ok: false as const, error: { code: 'OFFER_EXPIRED' as const } };
    }

    const [membership] = await tx
      .select({
        id: seasonMemberships.id,
        creditsBalanceCents: seasonMemberships.creditsBalanceCents,
      })
      .from(seasonMemberships)
      .where(
        and(
          eq(seasonMemberships.userId, input.actorUserId),
          eq(seasonMemberships.seasonId, wager.seasonId),
        ),
      )
      .for('update');

    if (!membership) return { ok: false as const, error: { code: 'NOT_A_MEMBER' as const } };
    if (membership.id === wager.offererMembershipId) {
      return { ok: false as const, error: { code: 'CANNOT_ACCEPT_OWN_OFFER' as const } };
    }
    if (wager.opponentMembershipId !== null && wager.opponentMembershipId !== membership.id) {
      return { ok: false as const, error: { code: 'NOT_THE_INVITED_OPPONENT' as const } };
    }
    if (membership.creditsBalanceCents < wager.acceptorStakeCents) {
      return {
        ok: false as const,
        error: {
          code: 'INSUFFICIENT_CREDITS' as const,
          availableCents: membership.creditsBalanceCents,
        },
      };
    }

    await tx
      .update(p2pWagers)
      .set({ status: 'ACCEPTED', acceptorMembershipId: membership.id, acceptedAt: now })
      .where(eq(p2pWagers.id, wager.id));

    const posted = await postEntry(tx, {
      membershipId: membership.id,
      amountCents: -wager.acceptorStakeCents,
      type: 'P2P_ESCROW',
      currency: 'CREDITS',
      idempotencyKey: `p2p:${wager.id}:escrow:acceptor`,
      p2pWagerId: wager.id,
    });

    const subject =
      wager.kind === 'FREEFORM'
        ? (wager.description ?? '')
        : ((await loadSelectionSubject(wager.selectionId!, tx))?.subject ?? '');

    const payload: P2PAcceptedPayload = {
      wagerId: wager.id,
      kind: wager.kind,
      potCents: potCents(wager.offererStakeCents, wager.acceptorStakeCents).toString(),
      offererStakeCents: wager.offererStakeCents.toString(),
      acceptorStakeCents: wager.acceptorStakeCents.toString(),
      subject,
    };

    await emitFeedEvent(tx, {
      seasonId: wager.seasonId,
      type: 'P2P_ACCEPTED',
      subjectMembershipId: membership.id,
      dedupeKey: `p2p:${wager.id}:accepted`,
      payload,
      occurredAt: now,
    });

    return {
      ok: true as const,
      wagerId: wager.id,
      creditsBalanceCents: posted.balanceCents,
    };
  });
}
