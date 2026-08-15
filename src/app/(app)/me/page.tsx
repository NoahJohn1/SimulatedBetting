import { desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { ledgerEntries } from '@/db/schema';
import { EmptyState } from '@/components/ui/empty-state';
import { Money } from '@/components/ui/money';
import { signOut } from '@/server/auth/config';
import { getSessionUser, requireApprovedMember } from '@/server/auth/session';

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

  const entries = await db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.membershipId, member.membershipId))
    .orderBy(desc(ledgerEntries.createdAt))
    .limit(100);

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <p className="text-sm text-zinc-500">{user?.email}</p>
        <p className="mt-1 text-2xl font-semibold">
          <Money cents={member.balanceCents} />
        </p>
      </section>

      {entries.length === 0 ? (
        <EmptyState title="No activity yet" />
      ) : (
        <ul className="flex flex-col gap-1">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-start justify-between gap-3 rounded-lg bg-white px-3 py-2 dark:bg-zinc-950"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  {LABELS[entry.type] ?? entry.type}
                </span>
                {entry.note ? (
                  <span className="block truncate text-xs text-zinc-500">{entry.note}</span>
                ) : null}
                <span className="block text-xs text-zinc-400">
                  {entry.createdAt.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    timeZone: 'America/New_York',
                  })}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <Money cents={entry.amountCents} className="block text-sm font-semibold" />
                <span className="block text-xs text-zinc-400">
                  <Money cents={entry.balanceAfterCents} />
                </span>
              </span>
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
        <button type="submit" className="text-sm font-medium text-zinc-500 underline">
          Sign out
        </button>
      </form>
    </div>
  );
}
