import { and, eq } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { seasonMemberships, users } from '@/db/schema';

/**
 * One primary-key lookup, inside the caller's transaction.
 *
 * The money path pays for this, so it is worth naming what it costs: one indexed read on a
 * table the settle transaction has already touched — strictly less than the `emitFeedEvent`
 * INSERT running beside it.
 */
export async function userIdForMembership(tx: Tx, membershipId: string): Promise<string | null> {
  const [row] = await tx
    .select({ userId: seasonMemberships.userId })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, membershipId));
  return row?.userId ?? null;
}

/** Every admin who could actually rule on something — a disabled admin is not a recipient. */
export async function adminUserIds(tx: Tx): Promise<string[]> {
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'ADMIN'), eq(users.status, 'APPROVED')));
  return rows.map((r) => r.id);
}

export async function seasonMemberUserIds(
  tx: Tx,
  seasonId: string,
): Promise<{ membershipId: string; userId: string }[]> {
  return tx
    .select({ membershipId: seasonMemberships.id, userId: seasonMemberships.userId })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.seasonId, seasonId));
}
