import { and, desc, eq, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Metadata } from 'next';
import { db } from '@/db/client';
import { betLegs, bets, events, games, markets, selections, teams } from '@/db/schema';
import type { Currency } from '@/db/schema';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Money, Price } from '@/components/ui/money';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { requireApprovedMember } from '@/server/auth/session';
import { LegLine, type LegLineData } from './leg-label';

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

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <SegmentedControl
        label="Bets or wagers"
        segments={[
          { href: '/bets', label: 'Bets', active: true },
          { href: '/wagers', label: 'Wagers', active: false },
        ]}
      />
      <SegmentedControl
        label="Currency"
        segments={[
          { href: '/bets', label: 'Cash', active: filterCurrency === 'CASH' },
          {
            href: '/bets?currency=CREDITS',
            label: 'Credits',
            active: filterCurrency === 'CREDITS',
          },
        ]}
      />
    </div>
  );

  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-4 px-4 py-4">
        {controls}
        <EmptyState
          title="No bets yet"
          body="Pick something off the board to get started."
          action={{ href: '/games', label: 'Browse games' }}
        />
      </div>
    );
  }

  // Kind-aware, matching place.ts's loadSelections (Task 11): a custom-event leg's market
  // has no matching `games` row, so a plain inner join to `games` silently dropped it from
  // the leg list. Joining through `events` — always present via markets.eventId — instead of
  // `games` keeps every leg, and `events.kind` tells us how to render it.
  //
  // `games` and the two `teams` joins are left joins for the same reason: a CUSTOM leg has no
  // game and no teams, so homeAbbr/awayAbbr/startsAt come back null for it (Task 9's LegLine
  // branches on `eventKind` and never reads them in that case). Aliased because a single game
  // joins `teams` twice — unaliased, the second join would collapse onto the first.
  const homeTeams = alias(teams, 'leg_home_teams');
  const awayTeams = alias(teams, 'leg_away_teams');

  const legRows = await db
    .select({
      betId: betLegs.betId,
      status: betLegs.status,
      line: betLegs.lineAtPlacement,
      price: betLegs.priceAtPlacement,
      side: selections.side,
      marketType: markets.type,
      outcomeLabel: selections.label,
      eventKind: events.kind,
      eventTitle: events.title,
      homeAbbr: homeTeams.abbreviation,
      awayAbbr: awayTeams.abbreviation,
      startsAt: games.startsAt,
    })
    .from(betLegs)
    .innerJoin(selections, eq(betLegs.selectionId, selections.id))
    .innerJoin(markets, eq(selections.marketId, markets.id))
    .innerJoin(events, eq(markets.eventId, events.id))
    .leftJoin(games, eq(games.eventId, markets.eventId))
    .leftJoin(homeTeams, eq(homeTeams.id, games.homeTeamId))
    .leftJoin(awayTeams, eq(awayTeams.id, games.awayTeamId))
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
      {controls}
      <Section title="Pending" bets={pending} legsByBet={legsByBet} />
      <Section title="Settled" bets={settled} legsByBet={legsByBet} />
    </div>
  );
}

interface LegRow extends LegLineData {
  status: string;
  price: number;
}

function Section({
  title,
  bets: list,
  legsByBet,
}: {
  title: string;
  bets: (typeof bets.$inferSelect)[];
  legsByBet: Map<string, LegRow[]>;
}) {
  if (list.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">{title}</h2>
      {list.map((bet) => {
        const legs = legsByBet.get(bet.id) ?? [];
        // One chip per card: the bet-level StatusBadge above always renders, so a leg-level
        // one is redundant noise unless the legs actually disagree — which can only happen
        // once the bet itself is settled (a PENDING bet's legs are all PENDING by definition).
        const legsDisagree = new Set(legs.map((l) => l.status)).size > 1;
        const showLegBadges = bet.status !== 'PENDING' && legsDisagree;

        return (
          <article
            key={bet.id}
            className="flex flex-col gap-2 rounded-xl border border-line bg-surface-raised p-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">
                {bet.type === 'PARLAY' ? `${legs.length}-leg parlay` : 'Single'}
              </span>
              <StatusBadge status={bet.status} />
            </div>

            <ul className="flex flex-col gap-1">
              {legs.map((leg, i) => (
                <li key={i} className="flex items-center justify-between text-sm">
                  <span className="text-ink-secondary">
                    <LegLine leg={leg} />
                  </span>
                  <span className="flex items-center gap-2">
                    <Price american={leg.price} />
                    {showLegBadges && <StatusBadge status={leg.status} />}
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
        );
      })}
    </section>
  );
}
