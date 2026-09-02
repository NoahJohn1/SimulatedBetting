import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { Button } from '@/components/ui/button';
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
        <p className="mt-3 max-w-sm text-balance text-sm text-ink-muted">
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
        <Button type="submit">Join season</Button>
      </form>
    </main>
  );
}
