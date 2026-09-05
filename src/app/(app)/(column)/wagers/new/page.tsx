import { and, eq, ne } from 'drizzle-orm';
import { db } from '@/db/client';
import { seasonMemberships, users } from '@/db/schema';
import { requireApprovedMember } from '@/server/auth/session';
import { WagerForm, type MemberOption } from './wager-form';

export default async function NewWagerPage() {
  const member = await requireApprovedMember();

  const rows = await db
    .select({ membershipId: seasonMemberships.id, displayName: users.displayName })
    .from(seasonMemberships)
    .innerJoin(users, eq(seasonMemberships.userId, users.id))
    .where(
      and(
        eq(seasonMemberships.seasonId, member.seasonId),
        ne(seasonMemberships.id, member.membershipId),
      ),
    );

  const members: MemberOption[] = rows.map((r) => ({
    membershipId: r.membershipId,
    displayName: r.displayName,
  }));

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <h1 className="text-lg font-semibold">Offer a wager</h1>
      <WagerForm members={members} />
    </div>
  );
}
