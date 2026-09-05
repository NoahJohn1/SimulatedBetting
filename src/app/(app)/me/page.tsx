import { desc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/db/client';
import { ledgerEntries, seasonMemberships } from '@/db/schema';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Money } from '@/components/ui/money';
import { signOut } from '@/server/auth/config';
import { getSessionUser, requireApprovedMember } from '@/server/auth/session';

export const metadata: Metadata = { title: 'Me' };

const LABELS: Record<string, string> = {
  SEASON_STARTING_GRANT: 'Starting bankroll',
  WEEKLY_ALLOWANCE: 'Weekly allowance',
  BET_PLACED: 'Bet placed',
  BET_WON: 'Bet won',
  BET_PUSHED: 'Bet pushed',
  BET_VOIDED: 'Bet voided',
  ADMIN_CREDIT: 'Admin credit',
  ADMIN_DEBIT: 'Admin debit',
  SETTLEMENT_REVERSAL: 'Settlement reversal',
};

/** Every entry is visible to its owner, admin adjustments and their notes included (D16). */
export default async function MePage() {
  const member = await requireApprovedMember();
  const user = await getSessionUser();

  const [membership] = await db
    .select({ creditsBalanceCents: seasonMemberships.creditsBalanceCents })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, member.membershipId));

  const entries = await db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.membershipId, member.membershipId))
    .orderBy(desc(ledgerEntries.createdAt))
    .limit(100);

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <Card className="p-4">
        <p className="text-sm text-ink-muted">{user?.email}</p>
        <div className="mt-1 flex items-baseline gap-4">
          <p className="text-2xl font-semibold">
            <Money cents={member.balanceCents} />
          </p>
          {membership ? (
            <p className="text-sm font-medium text-ink-muted">
              <Money cents={membership.creditsBalanceCents} currency="CREDITS" /> credits
            </p>
          ) : null}
        </div>
      </Card>

      <Link href="/me/feed-preferences" className="text-xs text-ink-muted hover:underline">
        Feed filters
      </Link>

      <Link href="/me/notifications" className="text-xs text-ink-muted hover:underline">
        Email
      </Link>

      {entries.length === 0 ? (
        <EmptyState title="No activity yet" />
      ) : (
        <ul className="flex flex-col gap-1">
          {entries.map((entry) => (
            <li key={entry.id}>
              <Card className="flex items-start justify-between gap-3 px-3 py-2">
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {LABELS[entry.type] ?? entry.type}
                  </span>
                  {entry.note ? (
                    <span className="block truncate text-xs text-ink-muted">{entry.note}</span>
                  ) : null}
                  <span className="block text-xs text-ink-muted">
                    {entry.createdAt.toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      timeZone: 'America/New_York',
                    })}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <Money
                    cents={entry.amountCents}
                    currency={entry.currency}
                    className="block text-sm font-semibold"
                  />
                  <span className="block text-xs text-ink-muted">
                    <Money cents={entry.balanceAfterCents} currency={entry.currency} />
                  </span>
                </span>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <form
        action={async () => {
          'use server';
          await signOut({ redirectTo: '/sign-in' });
        }}
      >
        <button type="submit" className="text-sm font-medium text-ink-muted underline">
          Sign out
        </button>
      </form>
    </div>
  );
}
