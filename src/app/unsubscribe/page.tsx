import type { Metadata } from 'next';
import { Card } from '@/components/ui/card';
import { verifyUnsubscribe } from '@/server/notify/unsubscribe';

export const metadata: Metadata = { title: 'Unsubscribe' };

const LABELS: Record<string, string> = {
  all: 'all email',
  WAGER_OFFERED: 'wagers offered to you',
  OFFER_EXPIRING: 'offers about to expire',
  DISPUTE_NEEDS_RULING: 'disputes needing a ruling',
  ACCOUNT_APPROVED: 'account approval',
  BETS_SETTLED: 'your settled bets',
  ALLOWANCE_PAID: 'the weekly allowance',
};

/**
 * Renders a button and changes nothing; the POST route is the only writer (D67).
 *
 * Public by construction — no session helper is called, because somebody unsubscribing is by
 * definition not signed in.
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ u?: string; s?: string; t?: string }>;
}) {
  const { u = '', s = '', t = '' } = await searchParams;
  const verified = verifyUnsubscribe(u, s, t);

  if (!verified) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-4 py-6">
        <Card className="flex flex-col gap-2 p-4">
          <h1 className="text-lg font-semibold">This link is not valid</h1>
          <p className="text-sm text-ink-muted">
            It may have been truncated by your mail client. You can change what you receive from the
            app’s Email settings once you are signed in.
          </p>
        </Card>
      </main>
    );
  }

  const query = new URLSearchParams({ u, s, t }).toString();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-4 py-6">
      <Card className="flex flex-col gap-3 p-4">
        <h1 className="text-lg font-semibold">Turn off {LABELS[verified] ?? 'these emails'}?</h1>
        <p className="text-sm text-ink-muted">
          Nothing has changed yet. Nothing is deleted either — you can turn it back on any time from
          the app.
        </p>
        <form method="POST" action={`/api/unsubscribe?${query}`}>
          <button className="h-10 w-full rounded-full bg-accent px-4 text-sm font-medium text-accent-ink">
            Turn it off
          </button>
        </form>
      </Card>
    </main>
  );
}
