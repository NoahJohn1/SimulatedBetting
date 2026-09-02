import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { signOut } from '@/server/auth/config';
import { currentMember, getSessionUser } from '@/server/auth/session';

/** Holding screen for a signed-in account an admin has not approved yet (D7). */
export default async function PendingPage() {
  const user = await getSessionUser();
  if (!user) redirect('/sign-in');

  // Only a genuinely PENDING account belongs here. Any other state — approved, disabled,
  // approved but not yet joined — goes back through the root so requireApprovedMember can
  // route it, otherwise an approved member sits on "waiting for approval" forever.
  const member = await currentMember();
  if (!member || member.ok || member.reason !== 'PENDING') redirect('/');

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Waiting for approval</h1>
        <p className="mt-3 max-w-sm text-balance text-sm text-ink-muted">
          You&rsquo;re signed in as {user.email}. An admin needs to approve your account before you
          can place bets.
        </p>
      </div>
      <form
        action={async () => {
          'use server';
          await signOut({ redirectTo: '/sign-in' });
        }}
      >
        <Button type="submit" variant="ghost" size="sm" className="underline">
          Sign out
        </Button>
      </form>
    </main>
  );
}
