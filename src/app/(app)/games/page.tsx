import type { Metadata } from 'next';
import { eq } from 'drizzle-orm';
import { SlipRail } from '@/components/bet-slip/slip-rail';
import { EmptyState } from '@/components/ui/empty-state';
import { SegmentedControl } from '@/components/ui/segmented-control';
import type { Segment } from '@/components/ui/segmented-control';
import { db } from '@/db/client';
import { seasonMemberships } from '@/db/schema';
import { formatDayHeading } from '@/domain/dates';
import { getSlate } from '@/server/odds/board';
import type { BoardGame } from '@/server/odds/board';
import { requireApprovedMember } from '@/server/auth/session';
import { DaySection } from './day-section';
import { GameRow } from './game-row';

export const metadata: Metadata = { title: 'Games' };

const LEAGUES = ['NFL', 'NCAAF'] as const;
const ET = 'America/New_York';

/** `YYYY-MM-DD` in ET — the `day` search param's format and the day-grouping key (D77). */
function dayKey(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: ET });
}

/** A `/games` link carrying whichever of `league`/`day` are set — never both cleared at once. */
function href(params: { league?: string; day?: string }): string {
  const query = new URLSearchParams();
  if (params.league) query.set('league', params.league);
  if (params.day) query.set('day', params.day);
  const qs = query.toString();
  return qs ? `/games?${qs}` : '/games';
}

/**
 * The odds board (D77): compact two-line rows in collapsible day sections, replacing the old
 * card-per-game layout. Filters are server-rendered links carrying `league`/`day` search
 * params — not client state — so the page stays a server component and every filter change is
 * a real navigation the server re-queries against.
 */
export default async function GamesPage({ searchParams }: PageProps<'/games'>) {
  const member = await requireApprovedMember();
  const params = await searchParams;

  const rawLeague = typeof params.league === 'string' ? params.league : undefined;
  const league = (LEAGUES as readonly string[]).includes(rawLeague ?? '')
    ? (rawLeague as (typeof LEAGUES)[number])
    : null;
  const day = typeof params.day === 'string' ? params.day : null;

  const slate = await getSlate();

  // The rail (lg+) needs the same two balances the layout shell already fetches for the
  // collapsed bar (<lg) — the session carries cash, but a credits slip has to check itself
  // against the credits balance and never against cash (D31). Queried again here rather than
  // threaded down from the layout, since the rail is this page's own concern, not the shell's.
  const [balances] = await db
    .select({ creditsBalanceCents: seasonMemberships.creditsBalanceCents })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, member.membershipId));

  const rail = (
    <SlipRail
      balanceCents={member.balanceCents.toString()}
      creditsBalanceCents={(balances?.creditsBalanceCents ?? 0n).toString()}
    />
  );

  if (slate.length === 0) {
    return (
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-6 lg:px-6">
        <EmptyState
          title="No games on the board"
          body="Nothing is open for betting right now. The odds sync runs every 15 minutes."
        />
        {rail}
      </div>
    );
  }

  const leagueFiltered = league ? slate.filter((game) => game.sport === league) : slate;

  // getSlate() orders by startsAt ascending, so grouping preserves chronological order — the
  // first bucket is the earliest day with a game still open to bet on, i.e. "today" for this
  // board even on a Monday holiday slate where the next kickoff is Thursday.
  const byDay = new Map<string, BoardGame[]>();
  for (const game of leagueFiltered) {
    const key = dayKey(game.startsAt);
    byDay.set(key, [...(byDay.get(key) ?? []), game]);
  }
  const days = [...byDay.entries()];
  const visibleDays = day ? days.filter(([key]) => key === day) : days;

  const leagueSegments: Segment[] = [
    { href: href({ day: day ?? undefined }), label: 'All', active: !league },
    ...LEAGUES.map((l) => ({
      href: href({ league: l, day: day ?? undefined }),
      label: l,
      active: league === l,
    })),
  ];

  const daySegments: Segment[] = [
    { href: href({ league: league ?? undefined }), label: 'All', active: !day },
    ...days.map(([key, games]) => ({
      href: href({ league: league ?? undefined, day: key }),
      label: `${formatDayHeading(games[0].startsAt)} · ${games.length}`,
      active: day === key,
    })),
  ];

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-6 lg:px-6">
      <div className="flex flex-col gap-3 px-4 py-4 lg:px-0">
        <SegmentedControl label="League" segments={leagueSegments} />
        <div className="overflow-x-auto">
          <SegmentedControl label="Day" segments={daySegments} />
        </div>

        {visibleDays.length === 0 ? (
          <EmptyState
            title="No games"
            body="No games match this filter."
            action={{ href: '/games', label: 'Clear filters' }}
          />
        ) : (
          visibleDays.map(([key, games], i) => (
            <DaySection
              key={key}
              heading={formatDayHeading(games[0].startsAt)}
              count={games.length}
              defaultOpen={i === 0}
            >
              {games.map((game) => (
                <GameRow key={game.id} game={game} />
              ))}
            </DaySection>
          ))
        )}
      </div>
      {rail}
    </div>
  );
}
