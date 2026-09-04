import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { GateScreen } from '@/components/ui/gate-screen';
import { db } from '@/db/client';
import { seasons } from '@/db/schema';
import { formatAmount } from '@/domain/money';
import { currentMember, getSessionUser } from '@/server/auth/session';
import { JoinForm } from './join-form';

export const metadata: Metadata = { title: 'Join the season' };

export default async function JoinPage() {
  const user = await getSessionUser();
  if (!user) redirect('/sign-in');

  const member = await currentMember();
  if (member?.ok) redirect('/');
  if (member && !member.ok && member.reason === 'PENDING') redirect('/pending');

  const [season] = await db.select().from(seasons).where(eq(seasons.status, 'ACTIVE'));
  if (!season) redirect('/no-season');

  return (
    <GateScreen
      title={season.name}
      step={{ current: 2, total: 2 }}
      body={
        <>
          Join and start with {formatAmount(season.startingBankrollCents)} plus{' '}
          {formatAmount(season.startingCreditsCents, 'CREDITS')}, topped up by{' '}
          {formatAmount(season.weeklyAllowanceCents)} and{' '}
          {formatAmount(season.weeklyCreditAllowanceCents, 'CREDITS')} every week. None of it is
          real money.
        </>
      }
      footer={
        <Link href="/rules" className="underline">
          How this works
        </Link>
      }
    >
      <JoinForm seasonId={season.id} />
    </GateScreen>
  );
}
