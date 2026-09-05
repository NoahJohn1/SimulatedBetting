import { and, eq, ne } from 'drizzle-orm';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { flushSoon } from '@/server/notify/deliver';
import { enqueueNotification } from '@/server/notify/enqueue';

/**
 * The approval write, moved out of `src/app/admin/page.tsx` because it now enqueues inside a
 * transaction — an action that does that does not belong in a page component, and cannot be
 * tested there.
 *
 * `ne(status, target)` in the WHERE plus `returning()` makes a double-click a no-op at the
 * database rather than at the UI. The unique dedupe key would catch it anyway; this keeps the
 * "changed" answer honest, which is what the caller revalidates on.
 */
export async function setUserStatus(
  userId: string,
  status: 'APPROVED' | 'DISABLED',
): Promise<{ changed: boolean }> {
  const changed = await db.transaction(async (tx) => {
    const updated = await tx
      .update(users)
      .set({ status })
      .where(and(eq(users.id, userId), ne(users.status, status)))
      .returning({ id: users.id, displayName: users.displayName });

    if (updated.length === 0) return false;
    if (status !== 'APPROVED') return true;

    // Unversioned on purpose (D63): approve, disable, approve again sends one email ever. Being
    // let in is not news the second time.
    await enqueueNotification(tx, {
      userId,
      type: 'ACCOUNT_APPROVED',
      dedupeKey: `user:${userId}:approved`,
      payload: { displayName: updated[0].displayName },
    });

    return true;
  });

  // Outside the transaction: a send must never be able to roll the approval back.
  if (changed && status === 'APPROVED') flushSoon();
  return { changed };
}
