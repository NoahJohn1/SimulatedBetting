import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { p2pWagers, seasonMemberships } from '@/db/schema';
import { agreedVerdict } from '@/domain/p2p';
import { emitFeedEvent } from '@/server/feed/emit';
import type { P2PDisputedPayload } from '@/server/feed/payload';
import { settleWagerInTx } from './settle-wager';
import { loadSelectionSubject } from './subject';
import type { ClaimWinnerInput, ClaimWinnerResult } from './types';

/**
 * One party names who won.
 *
 * Three outcomes, all decided inside the one transaction that writes the claim:
 * agreement settles immediately, disagreement announces a dispute and waits for an admin,
 * and a lone claim simply sits until the other side answers (D47).
 *
 * The `FOR UPDATE` lock is what makes two simultaneous claims deterministic — the second
 * transaction blocks, then reads the first claim and decides against it, so a wager can
 * never be paid twice by two people agreeing at the same instant.
 *
 * A party may overwrite their own claim while the wager is unsettled. Changing your mind
 * before it is resolved is honest, and it lets a dispute be resolved by one side conceding
 * rather than by an admin.
 */
export async function claimWinner(input: ClaimWinnerInput): Promise<ClaimWinnerResult> {
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const [wager] = await tx
      .select()
      .from(p2pWagers)
      .where(eq(p2pWagers.id, input.wagerId))
      .for('update');

    if (!wager) return { ok: false as const, error: { code: 'WAGER_NOT_FOUND' as const } };
    if (wager.status !== 'ACCEPTED') {
      return {
        ok: false as const,
        error: { code: 'WAGER_NOT_ACCEPTED' as const, status: wager.status },
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
    if (!membership) return { ok: false as const, error: { code: 'NOT_A_PARTY' as const } };

    const isOfferer = membership.id === wager.offererMembershipId;
    const isAcceptor = membership.id === wager.acceptorMembershipId;
    if (!isOfferer && !isAcceptor) {
      return { ok: false as const, error: { code: 'NOT_A_PARTY' as const } };
    }

    const claims = {
      offererClaim: isOfferer ? input.verdict : wager.offererClaim,
      acceptorClaim: isAcceptor ? input.verdict : wager.acceptorClaim,
    };

    await tx.update(p2pWagers).set(claims).where(eq(p2pWagers.id, wager.id));

    const agreed = agreedVerdict(claims);

    if (agreed !== null) {
      const summary = await settleWagerInTx(tx, {
        wagerId: wager.id,
        verdict: agreed,
        settledAt: now,
        // Only reached when the agreed verdict is VOID; the two of them decided it.
        reason: 'AGREED_VOID',
        byArbitration: false,
      });
      return {
        ok: true as const,
        outcome: 'SETTLED' as const,
        verdict: agreed,
        paidCents: summary.paidCents,
      };
    }

    if (claims.offererClaim !== null && claims.acceptorClaim !== null) {
      const subject =
        wager.kind === 'FREEFORM'
          ? (wager.description ?? '')
          : ((await loadSelectionSubject(wager.selectionId!, tx))?.subject ?? '');

      const payload: P2PDisputedPayload = {
        wagerId: wager.id,
        subject,
        attempt: wager.settlementAttempts + 1,
      };

      await emitFeedEvent(tx, {
        seasonId: wager.seasonId,
        type: 'P2P_DISPUTED',
        subjectMembershipId: membership.id,
        // Keyed on the attempt, so a dispute after an admin correction announces itself
        // again rather than being swallowed as a duplicate.
        dedupeKey: `p2p:${wager.id}:disputed:${wager.settlementAttempts + 1}`,
        payload,
        occurredAt: now,
      });

      return {
        ok: true as const,
        outcome: 'DISPUTED' as const,
        verdict: null,
        paidCents: 0n,
      };
    }

    return {
      ok: true as const,
      outcome: 'AWAITING_OTHER' as const,
      verdict: null,
      paidCents: 0n,
    };
  });
}
