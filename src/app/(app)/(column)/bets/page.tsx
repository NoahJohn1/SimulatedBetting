import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Metadata } from 'next';
import { db } from '@/db/client';
import { betLegs, bets, events, markets, selections } from '@/db/schema';
import type { Currency } from '@/db/schema';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Money, Price } from '@/components/ui/money';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { requireApprovedMember } from '@/server/auth/session';

export const metadata: Metadata = { title: 'My Bets' };

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
    <SegmentedControl
      label="Bets or wagers"
      segments={[
        { href: '/bets', label: 'Bets', active: true },
        { href: '/wagers', label: 'Wagers', active: false },
      ]}
    />
  );

  const filterLinks = (
    <SegmentedControl
      label="Currency"
      segments={[
        { href: '/bets', label: 'Cash', active: filterCurrency === 'CASH' },
        { href: '/bets?currency=CREDITS', label: 'Credits', active: filterCurrency === 'CREDITS' },
      ]}
    />
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
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">{title}</h2>
      {list.map((bet) => (
        <article
          key={bet.id}
          className="flex flex-col gap-2 rounded-xl border border-line bg-surface-raised p-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">
              {bet.type === 'PARLAY'
                ? `${legsByBet.get(bet.id)?.length ?? 0}-leg parlay`
                : 'Single'}
            </span>
            <StatusBadge status={bet.status} />
          </div>

          <ul className="flex flex-col gap-1">
            {(legsByBet.get(bet.id) ?? []).map((leg, i) => (
              <li key={i} className="flex items-center justify-between text-sm">
                <span className="text-ink-secondary">
                  {leg.eventKind === 'CUSTOM'
                    ? `${leg.eventTitle} · ${leg.marketTitle ?? ''} · ${leg.outcomeLabel ?? ''}`
                    : `${leg.marketType} · ${leg.side}${leg.line !== null ? ` ${Number(leg.line)}` : ''}`}
                </span>
                <span className="flex items-center gap-2">
                  <Price american={leg.price} />
                  <StatusBadge status={leg.status} />
                </span>
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between border-t border-line-subtle pt-2 text-sm">
            <span className="text-ink-muted">
              Stake <Money cents={bet.stakeCents} currency={bet.currency} />
            </span>
            <span className="text-ink-muted">
              {bet.status === 'PENDING' ? 'To return ' : 'Quoted '}
              <Money cents={bet.potentialPayoutCents} currency={bet.currency} />
            </span>
          </div>
        </article>
      ))}
    </section>
  );
}
