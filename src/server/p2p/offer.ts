import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { p2pWagers, seasonMemberships, seasons } from '@/db/schema';
import { potCents } from '@/domain/p2p';
import { emitFeedEvent } from '@/server/feed/emit';
import type { P2POfferedPayload } from '@/server/feed/payload';
import { postEntry } from '@/server/money/ledger';
import { loadSelectionSubject } from './subject';
import type {
  CancelOfferInput,
  CancelOfferResult,
  OfferWagerError,
  OfferWagerInput,
  OfferWagerResult,
} from './types';

/** Thrown to unwind the transaction; carries the validation error back out. */
class OfferRejected extends Error {
  constructor(readonly error: OfferWagerError) {
    super(error.code);
    this.name = 'OfferRejected';
  }
}

/**
 * Opens a wager and escrows the offerer's stake in the same transaction (D46).
 *
 * Escrowing here rather than at acceptance is what makes a live offer always good: an
 * acceptance can never fail because the offerer has since spent down. It also means the
 * refund path is exercised by cancellation and expiry, not just by settlement.
 */
export async function offerWager(input: OfferWagerInput): Promise<OfferWagerResult> {
  const now = input.now ?? new Date();

  // Cheap shape checks first, before paying for a transaction that cannot commit.
  if (input.offererStakeCents <= 0n) {
    return { ok: false, error: { code: 'INVALID_STAKE', side: 'OFFERER' } };
  }
  if (input.acceptorStakeCents <= 0n) {
    return { ok: false, error: { code: 'INVALID_STAKE', side: 'ACCEPTOR' } };
  }
  if (
    input.expiresAt.getTime() <= now.getTime() ||
    input.resolvesBy.getTime() < input.expiresAt.getTime()
  ) {
    return { ok: false, error: { code: 'INVALID_WINDOW' } };
  }

  const description = input.description?.trim() ?? '';
  if (input.kind === 'FREEFORM' && (description.length === 0 || input.selectionId)) {
    return { ok: false, error: { code: 'WRONG_KIND_FIELDS' } };
  }
  if (input.kind === 'MARKET' && (!input.selectionId || description.length > 0)) {
    return { ok: false, error: { code: 'WRONG_KIND_FIELDS' } };
  }

  try {
    return await db.transaction(async (tx) => {
      const [activeSeason] = await tx
        .select({ id: seasons.id })
        .from(seasons)
        .where(eq(seasons.status, 'ACTIVE'));
      if (!activeSeason) throw new OfferRejected({ code: 'NOT_A_MEMBER' });

      // The lock is taken before the balance is read, so a concurrent offer blocks here and
      // then re-reads the committed balance rather than the one it started with.
      const [membership] = await tx
        .select({
          id: seasonMemberships.id,
          creditsBalanceCents: seasonMemberships.creditsBalanceCents,
        })
        .from(seasonMemberships)
        .where(
          and(
            eq(seasonMemberships.userId, input.actorUserId),
            eq(seasonMemberships.seasonId, activeSeason.id),
          ),
        )
        .for('update');
      if (!membership) throw new OfferRejected({ code: 'NOT_A_MEMBER' });

      if (membership.creditsBalanceCents < input.offererStakeCents) {
        throw new OfferRejected({
          code: 'INSUFFICIENT_CREDITS',
          availableCents: membership.creditsBalanceCents,
        });
      }

      const opponentId = input.opponentMembershipId ?? null;
      if (opponentId !== null) {
        if (opponentId === membership.id) throw new OfferRejected({ code: 'OPPONENT_IS_SELF' });
        const [opponent] = await tx
          .select({ id: seasonMemberships.id })
          .from(seasonMemberships)
          .where(
            and(
              eq(seasonMemberships.id, opponentId),
              eq(seasonMemberships.seasonId, activeSeason.id),
            ),
          );
        if (!opponent) throw new OfferRejected({ code: 'OPPONENT_NOT_IN_SEASON' });
      }

      let lineAtOffer: string | null = null;
      let subject: string | null = null;

      if (input.kind === 'MARKET') {
        const loaded = await loadSelectionSubject(input.selectionId!, tx);
        if (!loaded) throw new OfferRejected({ code: 'SELECTION_NOT_FOUND' });
        if (loaded.marketStatus !== 'OPEN') throw new OfferRejected({ code: 'MARKET_NOT_OPEN' });
        if (loaded.eventStartsAt.getTime() <= now.getTime()) {
          throw new OfferRejected({ code: 'EVENT_ALREADY_STARTED' });
        }
        // The offer window must close before the event does, or an acceptance could land
        // after the result is known.
        if (input.expiresAt.getTime() > loaded.eventStartsAt.getTime()) {
          throw new OfferRejected({ code: 'INVALID_WINDOW' });
        }
        lineAtOffer = loaded.line;
        subject = loaded.subject;
      }

      const [wager] = await tx
        .insert(p2pWagers)
        .values({
          seasonId: activeSeason.id,
          kind: input.kind,
          offererMembershipId: membership.id,
          opponentMembershipId: opponentId,
          offererStakeCents: input.offererStakeCents,
          acceptorStakeCents: input.acceptorStakeCents,
          selectionId: input.kind === 'MARKET' ? input.selectionId : undefined,
          lineAtOffer,
          description: input.kind === 'FREEFORM' ? description : undefined,
          expiresAt: input.expiresAt,
          resolvesBy: input.resolvesBy,
        })
        .returning({ id: p2pWagers.id });

      const posted = await postEntry(tx, {
        membershipId: membership.id,
        amountCents: -input.offererStakeCents,
        type: 'P2P_ESCROW',
        currency: 'CREDITS',
        idempotencyKey: `p2p:${wager.id}:escrow:offerer`,
        p2pWagerId: wager.id,
      });

      const payload: P2POfferedPayload = {
        wagerId: wager.id,
        kind: input.kind,
        offererStakeCents: input.offererStakeCents.toString(),
        acceptorStakeCents: input.acceptorStakeCents.toString(),
        potCents: potCents(input.offererStakeCents, input.acceptorStakeCents).toString(),
        description: input.kind === 'FREEFORM' ? description : null,
        subject,
        directed: opponentId !== null,
        expiresAt: input.expiresAt.toISOString(),
      };

      await emitFeedEvent(tx, {
        seasonId: activeSeason.id,
        type: 'P2P_OFFERED',
        subjectMembershipId: membership.id,
        dedupeKey: `p2p:${wager.id}:offered`,
        payload,
        occurredAt: now,
      });

      return { ok: true as const, wagerId: wager.id, creditsBalanceCents: posted.balanceCents };
    });
  } catch (err) {
    if (err instanceof OfferRejected) return { ok: false, error: err.error };
    throw err;
  }
}

/**
 * Ends an unaccepted offer and refunds the escrow.
 *
 * `who` decides who is allowed: the offerer withdrawing, or the named opponent refusing.
 * Both do exactly the same thing to the row and to the ledger, so they share one body — the
 * only difference worth having is the authorization check.
 */
async function closeOffer(
  input: CancelOfferInput,
  who: 'OFFERER' | 'OPPONENT',
): Promise<CancelOfferResult> {
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

    const [membership] = await tx
      .select({ id: seasonMemberships.id })
      .from(seasonMemberships)
      .where(
        and(
          eq(seasonMemberships.userId, input.actorUserId),
          eq(seasonMemberships.seasonId, wager.seasonId),
        ),
      );
    if (!membership) return { ok: false as const, error: { code: 'NOT_AUTHORIZED' as const } };

    const permitted =
      who === 'OFFERER'
        ? membership.id === wager.offererMembershipId
        : // Only a directed offer can be declined: an open offer has no one with standing,
          // and ignoring it is what expiry is for.
          wager.opponentMembershipId !== null && membership.id === wager.opponentMembershipId;
    if (!permitted) return { ok: false as const, error: { code: 'NOT_AUTHORIZED' as const } };

    await tx
      .update(p2pWagers)
      .set({ status: 'CANCELED', settledAt: now })
      .where(eq(p2pWagers.id, wager.id));

    await postEntry(tx, {
      membershipId: wager.offererMembershipId,
      amountCents: wager.offererStakeCents,
      type: 'P2P_REFUND',
      currency: 'CREDITS',
      idempotencyKey: `p2p:${wager.id}:refund:canceled:${wager.offererMembershipId}`,
      p2pWagerId: wager.id,
    });

    // No feed card. A withdrawn or refused offer is a non-event (D26's instinct); it stays
    // visible on the wager itself and in the offerer's ledger.
    return { ok: true as const, refundedCents: wager.offererStakeCents };
  });
}

/** The offerer withdraws their own unaccepted offer. */
export function cancelOffer(input: CancelOfferInput): Promise<CancelOfferResult> {
  return closeOffer(input, 'OFFERER');
}

/** The challenged member refuses a directed offer. */
export function declineWager(input: CancelOfferInput): Promise<CancelOfferResult> {
  return closeOffer(input, 'OPPONENT');
}
