import { eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Tx } from '@/db/client';
import { db } from '@/db/client';
import { events, games, markets, selections, teams } from '@/db/schema';

const homeTeams = alias(teams, 'p2p_home_teams');
const awayTeams = alias(teams, 'p2p_away_teams');

export interface SelectionSubject {
  marketId: string;
  marketStatus: string;
  marketType: string;
  eventId: string;
  eventKind: 'GAME' | 'CUSTOM';
  eventStartsAt: Date;
  line: string | null;
  /** The rendered one-liner: "KC -3.50 vs BUF", or "Test Cup — Who wins? Falcons". */
  subject: string;
}

/**
 * Loads a selection and renders the one line that describes it.
 *
 * Joins through `events` rather than `games`, so a custom-event selection is not silently
 * dropped by an inner join that has no matching `games` row — the same kind-aware shape
 * `place.ts` uses in `loadSelections`.
 */
export async function loadSelectionSubject(
  selectionId: string,
  reader: Tx | typeof db = db,
): Promise<SelectionSubject | null> {
  const [row] = await reader
    .select({
      marketId: markets.id,
      marketStatus: markets.status,
      marketType: markets.type,
      marketTitle: markets.title,
      eventId: events.id,
      eventKind: events.kind,
      eventTitle: events.title,
      eventStartsAt: events.startsAt,
      side: selections.side,
      label: selections.label,
      line: selections.line,
      homeAbbr: homeTeams.abbreviation,
      awayAbbr: awayTeams.abbreviation,
    })
    .from(selections)
    .innerJoin(markets, eq(selections.marketId, markets.id))
    .innerJoin(events, eq(markets.eventId, events.id))
    .leftJoin(games, eq(games.eventId, events.id))
    .leftJoin(homeTeams, eq(games.homeTeamId, homeTeams.id))
    .leftJoin(awayTeams, eq(games.awayTeamId, awayTeams.id))
    .where(eq(selections.id, selectionId));

  if (!row) return null;

  return {
    marketId: row.marketId,
    marketStatus: row.marketStatus,
    marketType: row.marketType,
    eventId: row.eventId,
    eventKind: row.eventKind,
    eventStartsAt: row.eventStartsAt,
    line: row.line,
    subject: renderSubject(row),
  };
}

export function renderSubject(row: {
  eventKind: 'GAME' | 'CUSTOM';
  eventTitle: string;
  marketTitle: string | null;
  marketType: string;
  side: string | null;
  label: string | null;
  line: string | null;
  homeAbbr: string | null;
  awayAbbr: string | null;
}): string {
  if (row.eventKind === 'CUSTOM') {
    return `${row.eventTitle} — ${row.marketTitle ?? ''}: ${row.label ?? ''}`.trim();
  }

  const matchup = `${row.awayAbbr ?? '?'} @ ${row.homeAbbr ?? '?'}`;

  if (row.marketType === 'MONEYLINE') {
    const team = row.side === 'HOME' ? row.homeAbbr : row.awayAbbr;
    return `${team ?? '?'} ML — ${matchup}`;
  }
  if (row.marketType === 'SPREAD') {
    const team = row.side === 'HOME' ? row.homeAbbr : row.awayAbbr;
    return `${team ?? '?'} ${row.line ?? ''} — ${matchup}`;
  }
  // TOTAL
  return `${row.side === 'OVER' ? 'Over' : 'Under'} ${row.line ?? ''} — ${matchup}`;
}
