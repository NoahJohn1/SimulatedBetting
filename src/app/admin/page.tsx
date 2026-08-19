import { revalidatePath } from 'next/cache';
import { asc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { EmptyState } from '@/components/ui/empty-state';
import { requireAdmin } from '@/server/auth/session';

/**
 * The approval queue. New sign-ins land PENDING (D7) and cannot bet until an admin acts,
 * so without this screen the only way in is the promote script.
 *
 * requireAdmin runs server-side on every request; the tab is hidden for non-admins as a
 * convenience, never as the control.
 */
export default async function AdminPage() {
  await requireAdmin();

  const pending = await db
    .select()
    .from(users)
    .where(eq(users.status, 'PENDING'))
    .orderBy(asc(users.createdAt));

  async function setStatus(formData: FormData) {
    'use server';
    await requireAdmin();

    const userId = String(formData.get('userId'));
    const status = String(formData.get('status'));
    if (status !== 'APPROVED' && status !== 'DISABLED') return;

    await db.update(users).set({ status }).where(eq(users.id, userId));
    revalidatePath('/admin');
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Admin</h1>
        <Link href="/games" className="text-sm text-zinc-500 underline">
          Back to app
        </Link>
      </div>

      <Link href="/admin/events" className="text-sm text-zinc-500 underline">
        Overdue &amp; disputed events
      </Link>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Waiting for approval
        </h2>

        {pending.length === 0 ? (
          <EmptyState title="Nobody is waiting" />
        ) : (
          pending.map((user) => (
            <div
              key={user.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{user.displayName}</span>
                <span className="block truncate text-xs text-zinc-500">{user.email}</span>
              </span>
              <span className="flex shrink-0 gap-2">
                <form action={setStatus}>
                  <input type="hidden" name="userId" value={user.id} />
                  <input type="hidden" name="status" value="APPROVED" />
                  <button className="h-9 rounded-full bg-zinc-900 px-4 text-xs font-medium text-white dark:bg-zinc-50 dark:text-zinc-900">
                    Approve
                  </button>
                </form>
                <form action={setStatus}>
                  <input type="hidden" name="userId" value={user.id} />
                  <input type="hidden" name="status" value="DISABLED" />
                  <button className="h-9 rounded-full border border-zinc-300 px-4 text-xs font-medium dark:border-zinc-700">
                    Deny
                  </button>
                </form>
              </span>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
