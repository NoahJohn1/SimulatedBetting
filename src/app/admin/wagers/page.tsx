import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
import { Money } from '@/components/ui/money';
import { requireAdmin } from '@/server/auth/session';
import { loadArbitrationQueue } from '@/server/p2p/query';
import { ArbitrationForm } from './arbitration-form';

/**
 * The arbitration queue — accepted wagers where the two parties disagree, or where the
 * settle-by date has passed with no agreement (D44). Both conditions are derived at read
 * time in `loadArbitrationQueue`, so a wager leaves this queue the moment it is resolved.
 *
 * requireAdmin runs server-side before anything renders, exactly like `/admin/events` —
 * the tab being hidden from non-admins elsewhere is a courtesy, never the control.
 */
export default async function AdminWagersPage() {
  const admin = await requireAdmin();
  const queue = await loadArbitrationQueue(admin.seasonId);

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Wagers needing a ruling</h1>
        <Link href="/admin" className="text-sm text-zinc-500 underline">
          Back to admin
        </Link>
      </div>

      {queue.length === 0 ? (
        <EmptyState
          title="Nothing to settle"
          body="Every wager is either agreed or still inside its window."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {queue.map((wager) => (
            <div
              key={wager.id}
              className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <div className="flex flex-col gap-1">
                <Link href={`/wagers/${wager.id}`} className="text-sm font-semibold hover:underline">
                  {wager.subject}
                </Link>
                <span className="text-xs text-zinc-500">
                  {wager.offererDisplayName} (
                  <Money cents={wager.offererStakeCents} currency="CREDITS" />) vs{' '}
                  {wager.acceptorDisplayName ?? 'the other side'} (
                  <Money cents={wager.acceptorStakeCents} currency="CREDITS" />) — pot{' '}
                  <Money cents={wager.potCents} currency="CREDITS" />
                </span>
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  {wager.disputed
                    ? `They disagree: ${wager.offererDisplayName} says ${wager.offererClaim ?? '—'}, ${
                        wager.acceptorDisplayName ?? 'the other side'
                      } says ${wager.acceptorClaim ?? '—'}`
                    : 'Past its settle-by date with no agreement'}
                </span>
              </div>

              <ArbitrationForm
                wagerId={wager.id}
                offererDisplayName={wager.offererDisplayName}
                acceptorDisplayName={wager.acceptorDisplayName ?? 'The other side'}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
