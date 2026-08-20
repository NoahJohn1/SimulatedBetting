'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/server/auth/session';
import { arbitrateWager } from '@/server/p2p/arbitrate';
import type { P2PVerdict } from '@/server/p2p/types';

/**
 * The admin check lives here, at the route boundary, exactly as it does for every other
 * admin action in this codebase. `arbitrateWager` records who acted; `requireAdmin` decides
 * whether they were allowed to.
 */
export async function arbitrateWagerAction(wagerId: string, verdict: P2PVerdict, note: string) {
  const admin = await requireAdmin();

  const result = await arbitrateWager({
    wagerId,
    actorUserId: admin.userId,
    verdict,
    note,
  });

  revalidatePath('/admin/wagers');
  revalidatePath(`/wagers/${wagerId}`);
  revalidatePath('/feed');

  return result.ok
    ? { ok: true as const, attempt: result.attempt }
    : { ok: false as const, error: result.error };
}
