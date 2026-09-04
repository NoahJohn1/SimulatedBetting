import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { GateScreen } from '@/components/ui/gate-screen';
import { signOut } from '@/server/auth/config';
import { currentMember, getSessionUser } from '@/server/auth/session';

export const metadata: Metadata = { title: 'Waiting for approval' };

export default async function PendingPage() {
  const user = await getSessionUser();
  if (!user) redirect('/sign-in');

  const member = await currentMember();
  if (!member || member.ok || member.reason !== 'PENDING') redirect('/');

  return (
    <GateScreen
      title="Waiting for approval"
      step={{ current: 1, total: 2 }}
      body={
        <>
          You&rsquo;re signed in as {user.email}. An admin needs to approve your account before you
          can place bets. Nothing else is needed from you.
        </>
      }
      footer={
        <>
          <Link href="/rules" className="underline">
            House rules
          </Link>
          <form
            action={async () => {
              'use server';
              await signOut({ redirectTo: '/sign-in' });
            }}
          >
            <button type="submit" className="underline">
              Sign out
            </button>
          </form>
        </>
      }
    >
      {/* Approval happens elsewhere and this screen has no way to learn about it. The redirect
          at the top of this file does all the work — the control just re-runs it. */}
      <form
        action={async () => {
          'use server';
          redirect('/pending');
        }}
      >
        <Button type="submit" variant="secondary" size="sm">
          Check again
        </Button>
      </form>
    </GateScreen>
  );
}
