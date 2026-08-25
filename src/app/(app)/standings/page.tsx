import { desc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/db/client';
import { seasonMemberships, users } from '@/db/schema';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Money } from '@/components/ui/money';
import { requireApprovedMember } from '@/server/auth/session';

export const metadata: Metadata = { title: 'Standings' };

export default async function StandingsPage() {
  const member = await requireApprovedMember();

  const rows = await db
    .select({
      membershipId: seasonMemberships.id,
      balanceCents: seasonMemberships.balanceCents,
      creditsBalanceCents: seasonMemberships.creditsBalanceCents,
      displayName: users.displayName,
    })
    .from(seasonMemberships)
    .innerJoin(users, eq(seasonMemberships.userId, users.id))
    .where(eq(seasonMemberships.seasonId, member.seasonId))
    .orderBy(desc(seasonMemberships.balanceCents));

  if (rows.length === 0) return <EmptyState title="Nobody has joined yet" />;

  const byCredits = [...rows].sort((a, b) => (a.creditsBalanceCents < b.creditsBalanceCents ? 1 : a.creditsBalanceCents > b.creditsBalanceCents ? -1 : 0));

  return (
    <div className="flex flex-col gap-6 px-4 py-4">
      <ol className="flex flex-col gap-2">
        {rows.map((row, i) => {
          const isMe = row.membershipId === member.membershipId;
          return (
            <li key={row.membershipId}>
              <Card emphasis={isMe} className="flex items-center gap-3 p-3">
                <span className="w-6 text-sm tabular-nums text-ink-subtle">{i + 1}</span>
                <Link
                  href={`/members/${row.membershipId}`}
                  className="flex-1 truncate text-sm font-medium hover:underline"
                >
                  {row.displayName}
                </Link>
                <Money cents={row.balanceCents} className="text-sm font-semibold" />
              </Card>
            </li>
          );
        })}
      </ol>

      <section className="flex flex-col gap-2">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Credits — custom events
        </h2>
        <p className="px-1 text-xs text-ink-muted">
          Credits are granted, never converted, and do not affect the season standings above.
        </p>
        <ol className="flex flex-col gap-2">
          {byCredits.map((row, i) => {
            const isMe = row.membershipId === member.membershipId;
            return (
              <li key={row.membershipId}>
                <Card emphasis={isMe} className="flex items-center gap-3 p-3">
                  <span className="w-6 text-sm tabular-nums text-ink-subtle">{i + 1}</span>
                  <Link
                    href={`/members/${row.membershipId}`}
                    className="flex-1 truncate text-sm font-medium hover:underline"
                  >
                    {row.displayName}
                  </Link>
                  <Money cents={row.creditsBalanceCents} currency="CREDITS" className="text-sm font-semibold" />
                </Card>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
