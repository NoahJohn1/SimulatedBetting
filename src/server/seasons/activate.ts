import { and, eq, ne } from 'drizzle-orm';
import { db } from '@/db/client';
import { seasons } from '@/db/schema';

export type ActivateResult =
  | { ok: true }
  | { ok: false; code: 'ALREADY_ACTIVE'; blockingSeasonName: string }
  | { ok: false; code: 'NOT_FOUND' };

/**
 * Activation is the half that changes what every member sees, which is why it is a separate,
 * guarded act rather than part of creation (D61).
 *
 * `seasons_one_active_idx` is a partial unique index on status = 'ACTIVE', so a careless second
 * activation would otherwise surface as a raw constraint error through admin/error.tsx. Checking
 * explicitly lets the screen name the season in the way instead.
 */
export async function activateSeason(seasonId: string): Promise<ActivateResult> {
  return db.transaction(async (tx) => {
    const [target] = await tx.select().from(seasons).where(eq(seasons.id, seasonId));
    if (!target) return { ok: false, code: 'NOT_FOUND' };
    if (target.status === 'ACTIVE') return { ok: true };

    const [blocking] = await tx
      .select({ name: seasons.name })
      .from(seasons)
      .where(and(eq(seasons.status, 'ACTIVE'), ne(seasons.id, seasonId)));

    if (blocking) {
      return { ok: false, code: 'ALREADY_ACTIVE', blockingSeasonName: blocking.name };
    }

    await tx.update(seasons).set({ status: 'ACTIVE' }).where(eq(seasons.id, seasonId));
    return { ok: true };
  });
}
