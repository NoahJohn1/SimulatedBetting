import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { GateScreen } from '@/components/ui/gate-screen';
import { signOut } from '@/server/auth/config';
import { currentMember } from '@/server/auth/session';

export const metadata: Metadata = { title: 'Account disabled' };

export default async function DisabledPage() {
  // Self-correcting: if an admin re-enables the account, this stops being the right screen.
  const member = await currentMember();
  if (!member || member.ok || member.reason !== 'DISABLED') redirect('/');

  return (
    <GateScreen
      title="Account disabled"
      body="This account can no longer place bets. Talk to an admin if you think that is a mistake."
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
    />
  );
}
