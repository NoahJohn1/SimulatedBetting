import { redirect } from 'next/navigation';
import { currentMember } from '@/server/auth/session';

export default async function DisabledPage() {
  // Self-correcting: if an admin re-enables the account, this stops being the right screen.
  const member = await currentMember();
  if (!member || member.ok || member.reason !== 'DISABLED') redirect('/');

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Account disabled</h1>
      <p className="mt-3 max-w-sm text-balance text-sm text-zinc-500">
        This account can no longer place bets. Talk to an admin if you think that is a mistake.
      </p>
    </main>
  );
}
