import { redirect } from 'next/navigation';
import { signOut } from '@/server/auth/config';
import { currentMember, getSessionUser } from '@/server/auth/session';

/** Holding screen for a signed-in account an admin has not approved yet (D7). */
export default async function PendingPage() {
  const user = await getSessionUser();
  if (!user) redirect('/sign-in');

  const member = await currentMember();
  if (member?.ok) redirect('/');

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Waiting for approval</h1>
        <p className="mt-3 max-w-sm text-balance text-sm text-zinc-500 dark:text-zinc-400">
          You&rsquo;re signed in as {user.email}. An admin needs to approve your account before
          you can place bets.
        </p>
      </div>
      <form
        action={async () => {
          'use server';
          await signOut({ redirectTo: '/sign-in' });
        }}
      >
        <button type="submit" className="text-sm font-medium text-zinc-500 underline">
          Sign out
        </button>
      </form>
    </main>
  );
}
