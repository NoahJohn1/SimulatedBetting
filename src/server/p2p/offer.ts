import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { p2pWagers, seasonMemberships, seasons } from '@/db/schema';
import { potCents } from '@/domain/p2p';
import { emitFeedEvent } from '@/server/feed/emit';
import type { P2POfferedPayload } from '@/server/feed/payload';
import { postEntry } from '@/server/money/ledger';
import { loadSelectionSubject } from './subject';
import type { OfferWagerError, OfferWagerInput, OfferWagerResult } from './types';

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
