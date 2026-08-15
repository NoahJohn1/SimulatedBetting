'use server';

import { revalidatePath } from 'next/cache';
import { placeBet } from '@/server/bets/place';
import type { PlaceBetResult } from '@/server/bets/types';
import { requireApprovedMemberOrThrow } from '@/server/auth/session';

export interface PlaceBetActionInput {
  type: 'SINGLE' | 'PARLAY';
  stakeCents: string;
  legs: { selectionId: string; line: string | null; priceAmerican: number }[];
  clientRequestId: string;
}

/**
 * Server action behind the slip's Place button.
 *
 * Authorization is re-checked here rather than trusted from the page that rendered the
 * slip, and the user id comes from the session — never from the client, which would let
 * anyone bet from anyone's balance.
 *
 * Cents cross the wire as strings because bigint is not serializable through a server
 * action boundary.
 */
export async function placeBetAction(
  input: PlaceBetActionInput,
): Promise<PlaceBetResult & { stakeCents?: string }> {
  const member = await requireApprovedMemberOrThrow();

  const result = await placeBet({
    userId: member.userId,
    type: input.type,
    stakeCents: BigInt(input.stakeCents),
    legs: input.legs,
    clientRequestId: input.clientRequestId,
  });

  if (result.ok) {
    revalidatePath('/bets');
    revalidatePath('/games');
    revalidatePath('/me');
  }

  return result;
}
