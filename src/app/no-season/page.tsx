import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { GateScreen } from '@/components/ui/gate-screen';
import { signOut } from '@/server/auth/config';
import { currentMember } from '@/server/auth/session';

export const metadata: Metadata = { title: 'No season running' };

export default async function NoSeasonPage() {
  // Self-correcting: once an admin starts a season this stops being the right screen.
  const member = await currentMember();
  if (!member || member.ok || member.reason !== 'NO_ACTIVE_SEASON') redirect('/');

  return (
    <GateScreen
      title="No season running"
      body="An admin needs to start a season before there is anything to bet on. Your account is approved — nothing is wrong on your end."
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
