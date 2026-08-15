import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { seasons } from '@/db/schema';
import { formatCents } from '@/domain/money';
import { currentMember, getSessionUser } from '@/server/auth/session';
import { joinSeason } from '@/server/seasons/service';

/** An approved member who has not joined the running season yet. */
export default async function JoinPage() {
  const user = await getSessionUser();
  if (!user) redirect('/sign-in');

  const member = await currentMember();
  if (member?.ok) redirect('/');
  if (member && !member.ok && member.reason === 'PENDING') redirect('/pending');

  const [season] = await db.select().from(seasons).where(eq(seasons.status, 'ACTIVE'));
  if (!season) redirect('/no-season');

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{season.name}</h1>
        <p className="mt-3 max-w-sm text-balance text-sm text-zinc-500 dark:text-zinc-400">
          Join the season and start with {formatCents(season.startingBankrollCents)}, plus{' '}
          {formatCents(season.weeklyAllowanceCents)} every week.
        </p>
      </div>
      <form
        action={async () => {
          'use server';
          await joinSeason(user.id, season.id);
          redirect('/');
        }}
      >
        <button
          type="submit"
          className="h-12 rounded-full bg-zinc-900 px-8 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-900"
        >
          Join season
        </button>
      </form>
    </main>
  );
}
