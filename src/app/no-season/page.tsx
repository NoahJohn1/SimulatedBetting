import { redirect } from 'next/navigation';
import { currentMember } from '@/server/auth/session';

export default async function NoSeasonPage() {
  // Self-correcting: once an admin starts a season this stops being the right screen.
  const member = await currentMember();
  if (!member || member.ok || member.reason !== 'NO_ACTIVE_SEASON') redirect('/');

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">No season running</h1>
      <p className="mt-3 max-w-sm text-balance text-sm text-zinc-500">
        An admin needs to start a season before there is anything to bet on.
      </p>
    </main>
  );
}
