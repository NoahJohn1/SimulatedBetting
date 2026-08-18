import { desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { betLegs, bets, games, markets, selections, teams } from '@/db/schema';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Money, Price } from '@/components/ui/money';
import { requireApprovedMember } from '@/server/auth/session';

export default async function MyBetsPage() {
  const member = await requireApprovedMember();

  const rows = await db
    .select()
    .from(bets)
    .where(eq(bets.membershipId, member.membershipId))
    .orderBy(desc(bets.placedAt));

  if (rows.length === 0) {
    return (
      <EmptyState title="No bets yet" body="Pick something off the board to get started." />
    );
  }

  const legRows = await db
    .select({
      betId: betLegs.betId,
      status: betLegs.status,
      line: betLegs.lineAtPlacement,
      price: betLegs.priceAtPlacement,
      side: selections.side,
      marketType: markets.type,
      homeAbbr: teams.abbreviation,
      gameId: games.id,
    })
    .from(betLegs)
    .innerJoin(selections, eq(betLegs.selectionId, selections.id))
    .innerJoin(markets, eq(selections.marketId, markets.id))
    .innerJoin(games, eq(markets.eventId, games.eventId))
    .innerJoin(teams, eq(games.homeTeamId, teams.id))
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
      homeAbbr: string;
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
                  {leg.marketType} · {leg.side}
                  {leg.line !== null ? ` ${Number(leg.line)}` : ''}
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
              Stake <Money cents={bet.stakeCents} />
            </span>
            <span className="text-zinc-500">
              {bet.status === 'PENDING' ? 'To return ' : 'Quoted '}
              <Money cents={bet.potentialPayoutCents} />
            </span>
          </div>
        </article>
      ))}
    </section>
  );
}
