'use server';

import { revalidatePath } from 'next/cache';
import { requireApprovedMemberOrThrow } from '@/server/auth/session';
import { acceptWager } from '@/server/p2p/accept';
import { claimWinner, proposeCancel } from '@/server/p2p/claim';
import { cancelOffer, declineWager, offerWager } from '@/server/p2p/offer';
import type { P2PVerdict, P2PWagerKind } from '@/server/p2p/types';

/**
 * Every action re-authorizes server-side. The board computes what a viewer may do, but that
 * is for rendering only — authorization is never by hidden UI.
 *
 * Cents cross this boundary as decimal strings: `bigint` is not serializable through a
 * server action, exactly as in `src/app/(app)/bets/actions.ts`.
 */
export async function offerWagerAction(input: {
  kind: P2PWagerKind;
  opponentMembershipId?: string | null;
  offererStakeCents: string;
  acceptorStakeCents: string;
  selectionId?: string;
  description?: string;
  expiresAt: string;
  resolvesBy: string;
}) {
  const member = await requireApprovedMemberOrThrow();

  const result = await offerWager({
    actorUserId: member.userId,
    kind: input.kind,
    opponentMembershipId: input.opponentMembershipId ?? null,
    offererStakeCents: BigInt(input.offererStakeCents),
    acceptorStakeCents: BigInt(input.acceptorStakeCents),
    selectionId: input.selectionId,
    description: input.description,
    expiresAt: new Date(input.expiresAt),
    resolvesBy: new Date(input.resolvesBy),
  });

  revalidatePath('/wagers');
  revalidatePath('/feed');

  return result.ok
    ? { ok: true as const, wagerId: result.wagerId }
    : { ok: false as const, error: result.error };
}

export async function acceptWagerAction(wagerId: string) {
  const member = await requireApprovedMemberOrThrow();
  const result = await acceptWager({ wagerId, actorUserId: member.userId });

  revalidatePath('/wagers');
  revalidatePath(`/wagers/${wagerId}`);
  revalidatePath('/feed');

  return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
}

export async function declineWagerAction(wagerId: string) {
  const member = await requireApprovedMemberOrThrow();
  const result = await declineWager({ wagerId, actorUserId: member.userId });

  revalidatePath('/wagers');
  revalidatePath(`/wagers/${wagerId}`);

  return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
}

export async function cancelOfferAction(wagerId: string) {
  const member = await requireApprovedMemberOrThrow();
  const result = await cancelOffer({ wagerId, actorUserId: member.userId });

  revalidatePath('/wagers');
  revalidatePath(`/wagers/${wagerId}`);

  return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
}

export async function claimWinnerAction(wagerId: string, verdict: P2PVerdict) {
  const member = await requireApprovedMemberOrThrow();
  const result = await claimWinner({ wagerId, actorUserId: member.userId, verdict });

  revalidatePath('/wagers');
  revalidatePath(`/wagers/${wagerId}`);
  revalidatePath('/feed');

  return result.ok
    ? { ok: true as const, outcome: result.outcome }
    : { ok: false as const, error: result.error };
}

export async function proposeCancelAction(wagerId: string) {
  const member = await requireApprovedMemberOrThrow();
  const result = await proposeCancel({ wagerId, actorUserId: member.userId });

  revalidatePath('/wagers');
  revalidatePath(`/wagers/${wagerId}`);
  revalidatePath('/feed');

  return result.ok
    ? { ok: true as const, outcome: result.outcome }
    : { ok: false as const, error: result.error };
}
