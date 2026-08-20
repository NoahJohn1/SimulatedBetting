import { and, desc, eq, inArray } from 'drizzle-orm';
import Link from 'next/link';
import { db } from '@/db/client';
import { betLegs, bets, events, markets, selections } from '@/db/schema';
import type { Currency } from '@/db/schema';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Money, Price } from '@/components/ui/money';
import { requireApprovedMember } from '@/server/auth/session';

export default async function MyBetsPage({ searchParams }: PageProps<'/bets'>) {
  const member = await requireApprovedMember();
  const params = await searchParams;
  const filterCurrency: Currency = params.currency === 'CREDITS' ? 'CREDITS' : 'CASH';

  const rows = await db
    .select()
    .from(bets)
    .where(and(eq(bets.membershipId, member.membershipId), eq(bets.currency, filterCurrency)))
    .orderBy(desc(bets.placedAt));

  const sectionLinks = (
    <div className="flex gap-2 px-1">
      <span className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
        Bets
      </span>
      <Link
        href="/wagers"
        className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
      >
        Wagers
      </Link>
    </div>
  );

  const filterLinks = (
    <div className="flex gap-2 px-1">
      {(['CASH', 'CREDITS'] as const).map((c) => (
        <Link
          key={c}
          href={c === 'CASH' ? '/bets' : '/bets?currency=CREDITS'}
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            filterCurrency === c
              ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
              : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
          }`}
        >
          {c === 'CASH' ? 'Cash' : 'Credits'}
        </Link>
      ))}
    </div>
  );

  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-4 px-4 py-4">
        {sectionLinks}
        {filterLinks}
        <EmptyState title="No bets yet" body="Pick something off the board to get started." />
      </div>
    );
  }

  // Kind-aware, matching place.ts's loadSelections (Task 11): a custom-event leg's market
  // has no matching `games` row, so a plain inner join to `games` silently dropped it from
  // the leg list. Joining through `events` — always present via markets.eventId — instead of
  // `games` keeps every leg, and `events.kind` tells us how to render it.
  const legRows = await db
    .select({
      betId: betLegs.betId,
      status: betLegs.status,
      line: betLegs.lineAtPlacement,
      price: betLegs.priceAtPlacement,
      side: selections.side,
      marketType: markets.type,
      marketTitle: markets.title,
      outcomeLabel: selections.label,
      eventKind: events.kind,
      eventTitle: events.title,
    })
    .from(betLegs)
    .innerJoin(selections, eq(betLegs.selectionId, selections.id))
    .innerJoin(markets, eq(selections.marketId, markets.id))
    .innerJoin(events, eq(markets.eventId, events.id))
    .where(
      inArray(
        betLegs.betId,
        rows.map((b) => b.id),
      ),
    );

  const legsByBet = new Map<string, typeof legRows>();
  for (const leg of legRows) {
    legsByBet.set(leg.betId, [...(legsByBet.get(leg.betId) ?? []), leg]);
  }

  const pending = rows.filter((b) => b.status === 'PENDING');
  const settled = rows.filter((b) => b.status !== 'PENDING');

  return (
    <div className="flex flex-col gap-6 px-4 py-4">
      {sectionLinks}
      {filterLinks}
      <Section title="Pending" bets={pending} legsByBet={legsByBet} />
      <Section title="Settled" bets={settled} legsByBet={legsByBet} />
    </div>
  );
}

function Section({
  title,
  bets: list,
  legsByBet,
}: {
  title: string;
  bets: (typeof bets.$inferSelect)[];
  legsByBet: Map<
    string,
    {
      status: string;
      line: string | null;
      price: number;
      side: string | null;
      marketType: string;
      marketTitle: string | null;
      outcomeLabel: string | null;
      eventKind: 'GAME' | 'CUSTOM';
      eventTitle: string;
    }[]
  >;
}) {
  if (list.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
      {list.map((bet) => (
        <article
          key={bet.id}
          className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">
              {bet.type === 'PARLAY' ? `${legsByBet.get(bet.id)?.length ?? 0}-leg parlay` : 'Single'}
            </span>
            <Badge status={bet.status} />
          </div>

          <ul className="flex flex-col gap-1">
            {(legsByBet.get(bet.id) ?? []).map((leg, i) => (
              <li key={i} className="flex items-center justify-between text-sm">
                <span className="text-zinc-600 dark:text-zinc-400">
                  {leg.eventKind === 'CUSTOM'
                    ? `${leg.eventTitle} · ${leg.marketTitle ?? ''} · ${leg.outcomeLabel ?? ''}`
                    : `${leg.marketType} · ${leg.side}${leg.line !== null ? ` ${Number(leg.line)}` : ''}`}
                </span>
                <span className="flex items-center gap-2">
                  <Price american={leg.price} />
                  <Badge status={leg.status} />
                </span>
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between border-t border-zinc-100 pt-2 text-sm dark:border-zinc-800">
            <span className="text-zinc-500">
              Stake <Money cents={bet.stakeCents} currency={bet.currency} />
            </span>
            <span className="text-zinc-500">
              {bet.status === 'PENDING' ? 'To return ' : 'Quoted '}
              <Money cents={bet.potentialPayoutCents} currency={bet.currency} />
            </span>
          </div>
        </article>
      ))}
    </section>
  );
}
