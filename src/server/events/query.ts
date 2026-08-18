import { asc, eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { customEvents, events, seasonMemberships, users, type CustomEventStatus } from '@/db/schema';

export type EventSection = 'OPEN' | 'AWAITING' | 'SETTLED';

export interface EventBoardRow {
  eventId: string;
  title: string;
  startsAt: Date;
  resolvesBy: Date;
  status: CustomEventStatus;
  overdue: boolean;
  creatorMembershipId: string;
  creatorDisplayName: string;
  marketCount: number;
  stakedCreditsCents: bigint;
  section: EventSection;
}

const SECTION_ORDER: Record<EventSection, number> = { OPEN: 0, AWAITING: 1, SETTLED: 2 };

/**
 * The events board, sectioned.
 *
 * `overdue` is computed here with exactly the expression `sweepOverdueEvents` uses —
 * `status = 'OPEN' AND resolves_by < now` — because there is only one definition of overdue
 * in the system and it is derived, never stored (D37).
 *
 * The two aggregates are correlated subqueries written with literal, table-qualified
 * identifiers rather than drizzle's `${table.column}` helpers. Interpolating a column helper
 * inside a `sql` fragment resolves it against the subquery's own FROM, which silently
 * produces a comparison that is never true (D30) — the third test below is what catches it.
 */
export async function listSeasonEvents(
  seasonId: string,
  now: Date = new Date(),
): Promise<EventBoardRow[]> {
  const rows = await db
    .select({
      eventId: customEvents.eventId,
      title: events.title,
      startsAt: events.startsAt,
      resolvesBy: customEvents.resolvesBy,
      status: customEvents.status,
      creatorMembershipId: customEvents.creatorMembershipId,
      creatorDisplayName: users.displayName,
      marketCount: sql<string>`(
        SELECT COUNT(*) FROM markets mk WHERE mk.event_id = custom_events.event_id
      )`,
      stakedCreditsCents: sql<string>`COALESCE((
        SELECT SUM(b.stake_cents)
        FROM bets b
        WHERE b.id IN (
          SELECT bl.bet_id
          FROM bet_legs bl
          JOIN selections s ON s.id = bl.selection_id
          JOIN markets mk ON mk.id = s.market_id
          WHERE mk.event_id = custom_events.event_id
        )
      ), 0)`,
    })
    .from(customEvents)
    .innerJoin(events, eq(events.id, customEvents.eventId))
    .innerJoin(seasonMemberships, eq(seasonMemberships.id, customEvents.creatorMembershipId))
    .innerJoin(users, eq(users.id, seasonMemberships.userId))
    .where(eq(customEvents.seasonId, seasonId))
    .orderBy(asc(events.startsAt));

  const mapped = rows.map((row) => {
    const open = row.status === 'OPEN';
    const section: EventSection = !open ? 'SETTLED' : row.startsAt <= now ? 'AWAITING' : 'OPEN';

    return {
      eventId: row.eventId,
      title: row.title,
      startsAt: row.startsAt,
      resolvesBy: row.resolvesBy,
      status: row.status,
      overdue: open && row.resolvesBy < now,
      creatorMembershipId: row.creatorMembershipId,
      creatorDisplayName: row.creatorDisplayName,
      marketCount: Number(row.marketCount),
      // Money is a string out of Postgres and becomes a bigint here. Never Number() (D17).
      stakedCreditsCents: BigInt(row.stakedCreditsCents),
      section,
    };
  });

  // Open events soonest-first; settled events most-recent-first.
  return mapped.sort((a, b) => {
    if (SECTION_ORDER[a.section] !== SECTION_ORDER[b.section]) {
      return SECTION_ORDER[a.section] - SECTION_ORDER[b.section];
    }
    const direction = a.section === 'SETTLED' ? -1 : 1;
    return direction * (a.startsAt.getTime() - b.startsAt.getTime());
  });
}
