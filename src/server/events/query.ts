import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '@/db/client';
import {
  betLegs,
  bets,
  customEventDisputes,
  customEvents,
  events,
  markets,
  seasonMemberships,
  selections,
  users,
  type CustomEventStatus,
  type MarketStatusValue,
} from '@/db/schema';

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

export interface CustomEventDetail {
  eventId: string;
  title: string;
  description: string | null;
  startsAt: Date;
  resolvesBy: Date;
  status: CustomEventStatus;
  overdue: boolean;
  seasonId: string;
  creator: { membershipId: string; displayName: string };
  viewerIsCreator: boolean;
  resolution: {
    note: string | null;
    resolvedAt: Date | null;
    attempt: number;
    byDisplayName: string | null;
  };
  markets: {
    marketId: string;
    title: string;
    status: MarketStatusValue;
    winningSelectionId: string | null;
    outcomes: {
      selectionId: string;
      label: string;
      priceAmerican: number;
      stakedCreditsCents: bigint;
    }[];
  }[];
  viewerPositions: { marketId: string; selectionId: string; stakeCents: bigint; status: string }[];
  creatorPositions: { marketId: string; selectionId: string; stakeCents: bigint }[];
  openDisputes: { membershipId: string; displayName: string; reason: string; createdAt: Date }[];
}

const resolvedByUsers = alias(users, 'resolved_by_users');

/**
 * Everything one event page needs, and the authorization for showing it.
 *
 * The season check lives here rather than in the page: the query takes a viewer membership,
 * resolves its season, and returns null when the event belongs to another one. A page that
 * forgets to check is then safe by construction, and another season's event is
 * indistinguishable from a missing one.
 *
 * `creatorPositions` is populated unconditionally — not gated on the viewer being an admin,
 * and not hidden from the creator's own view. A creator may bet their own event, and the
 * price of that is disclosure, on every screen the position can appear (D32).
 */
export async function getCustomEventDetail(
  eventId: string,
  viewerMembershipId: string,
  now: Date = new Date(),
): Promise<CustomEventDetail | null> {
  const [viewer] = await db
    .select({ seasonId: seasonMemberships.seasonId })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, viewerMembershipId));

  if (!viewer) return null;

  const [row] = await db
    .select({
      eventId: customEvents.eventId,
      title: events.title,
      startsAt: events.startsAt,
      description: customEvents.description,
      resolvesBy: customEvents.resolvesBy,
      status: customEvents.status,
      seasonId: customEvents.seasonId,
      creatorMembershipId: customEvents.creatorMembershipId,
      creatorDisplayName: users.displayName,
      resolutionNote: customEvents.resolutionNote,
      resolvedAt: customEvents.resolvedAt,
      resolutionAttempts: customEvents.resolutionAttempts,
      resolvedByDisplayName: resolvedByUsers.displayName,
    })
    .from(customEvents)
    .innerJoin(events, eq(events.id, customEvents.eventId))
    .innerJoin(seasonMemberships, eq(seasonMemberships.id, customEvents.creatorMembershipId))
    .innerJoin(users, eq(users.id, seasonMemberships.userId))
    .leftJoin(resolvedByUsers, eq(resolvedByUsers.id, customEvents.resolvedByUserId))
    .where(eq(customEvents.eventId, eventId));

  if (!row || row.seasonId !== viewer.seasonId) return null;

  const marketRows = await db
    .select({
      marketId: markets.id,
      title: markets.title,
      status: markets.status,
      winningSelectionId: markets.winningSelectionId,
    })
    .from(markets)
    .where(eq(markets.eventId, eventId))
    .orderBy(asc(markets.createdAt));

  const marketIds = marketRows.map((market) => market.marketId);

  // Aggregated here rather than per outcome in the page, and summed as numeric in Postgres
  // so it comes back as a string and becomes a bigint — never a Number (D17).
  const outcomeRows = marketIds.length
    ? await db
        .select({
          selectionId: selections.id,
          marketId: selections.marketId,
          label: selections.label,
          priceAmerican: selections.priceAmerican,
          sortOrder: selections.sortOrder,
          stakedCreditsCents: sql<string>`COALESCE(SUM(${bets.stakeCents}), 0)`,
        })
        .from(selections)
        .leftJoin(betLegs, eq(betLegs.selectionId, selections.id))
        .leftJoin(bets, eq(bets.id, betLegs.betId))
        .where(inArray(selections.marketId, marketIds))
        .groupBy(selections.id)
        .orderBy(asc(selections.sortOrder))
    : [];

  const positionRows = marketIds.length
    ? await db
        .select({
          membershipId: bets.membershipId,
          marketId: selections.marketId,
          selectionId: betLegs.selectionId,
          stakeCents: bets.stakeCents,
          status: betLegs.status,
          placedAt: bets.placedAt,
        })
        .from(betLegs)
        .innerJoin(bets, eq(bets.id, betLegs.betId))
        .innerJoin(selections, eq(selections.id, betLegs.selectionId))
        .where(
          and(
            inArray(selections.marketId, marketIds),
            inArray(bets.membershipId, [viewerMembershipId, row.creatorMembershipId]),
          ),
        )
        .orderBy(asc(bets.placedAt))
    : [];

  const disputeRows = await db
    .select({
      membershipId: customEventDisputes.membershipId,
      displayName: users.displayName,
      reason: customEventDisputes.reason,
      createdAt: customEventDisputes.createdAt,
    })
    .from(customEventDisputes)
    .innerJoin(seasonMemberships, eq(seasonMemberships.id, customEventDisputes.membershipId))
    .innerJoin(users, eq(users.id, seasonMemberships.userId))
    .where(
      and(
        eq(customEventDisputes.eventId, eventId),
        // Re-resolution and void both stamp resolved_at; only the still-unanswered ones are
        // the page's business.
        isNull(customEventDisputes.resolvedAt),
      ),
    )
    .orderBy(asc(customEventDisputes.createdAt));

  const outcomesByMarketId = new Map<string, CustomEventDetail['markets'][number]['outcomes']>();
  for (const outcome of outcomeRows) {
    const list = outcomesByMarketId.get(outcome.marketId) ?? [];
    list.push({
      selectionId: outcome.selectionId,
      label: outcome.label ?? '',
      priceAmerican: outcome.priceAmerican,
      stakedCreditsCents: BigInt(outcome.stakedCreditsCents),
    });
    outcomesByMarketId.set(outcome.marketId, list);
  }

  return {
    eventId: row.eventId,
    title: row.title,
    description: row.description,
    startsAt: row.startsAt,
    resolvesBy: row.resolvesBy,
    status: row.status,
    // Derived from the clock every time it is read, never stored (D37).
    overdue: row.status === 'OPEN' && row.resolvesBy < now,
    seasonId: row.seasonId,
    creator: {
      membershipId: row.creatorMembershipId,
      displayName: row.creatorDisplayName,
    },
    viewerIsCreator: row.creatorMembershipId === viewerMembershipId,
    resolution: {
      note: row.resolutionNote,
      resolvedAt: row.resolvedAt,
      attempt: row.resolutionAttempts,
      byDisplayName: row.resolvedByDisplayName,
    },
    markets: marketRows.map((market) => ({
      marketId: market.marketId,
      title: market.title ?? '',
      status: market.status,
      winningSelectionId: market.winningSelectionId,
      outcomes: outcomesByMarketId.get(market.marketId) ?? [],
    })),
    viewerPositions: positionRows
      .filter((position) => position.membershipId === viewerMembershipId)
      .map((position) => ({
        marketId: position.marketId,
        selectionId: position.selectionId,
        stakeCents: position.stakeCents,
        status: position.status,
      })),
    creatorPositions: positionRows
      .filter((position) => position.membershipId === row.creatorMembershipId)
      .map((position) => ({
        marketId: position.marketId,
        selectionId: position.selectionId,
        stakeCents: position.stakeCents,
      })),
    openDisputes: disputeRows,
  };
}
