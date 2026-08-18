import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { events, games, markets, oddsSnapshots, selections, teams } from '@/db/schema';
import { FixtureOddsProvider } from '@/fixtures/providers';
import { suspendStaleMarkets, syncOdds } from '@/server/odds/sync';
import { resetDb } from '@/test/db';

const SPREAD_GAME = 'nfl-2026-w1-sf-sea';

async function selectionFor(gameExternalId: string, side: 'HOME' | 'AWAY' | 'OVER' | 'UNDER') {
  const [row] = await db
    .select({
      id: selections.id,
      line: selections.line,
      priceAmerican: selections.priceAmerican,
    })
    .from(selections)
    .innerJoin(markets, eq(selections.marketId, markets.id))
    .innerJoin(games, eq(markets.eventId, games.eventId))
    .where(and(eq(games.externalId, gameExternalId), eq(selections.side, side)));
  return row;
}

async function snapshotCount(): Promise<number> {
  return (await db.select().from(oddsSnapshots)).length;
}

describe('syncOdds', () => {
  beforeEach(resetDb);

  it('inserts teams, games, markets and selections on a first run', async () => {
    const summary = await syncOdds({ provider: new FixtureOddsProvider() });

    expect(summary.gamesUpserted).toBeGreaterThanOrEqual(8);
    expect(summary.marketsUpserted).toBeGreaterThanOrEqual(12);
    expect(summary.selectionsUpserted).toBeGreaterThanOrEqual(24);

    expect((await db.select().from(teams)).length).toBeGreaterThanOrEqual(16);
    expect((await db.select().from(games)).length).toBeGreaterThanOrEqual(8);
  });

  it('snapshots every selection on the first sync', async () => {
    await syncOdds({ provider: new FixtureOddsProvider() });
    const selectionRows = await db.select().from(selections);

    expect(await snapshotCount()).toBe(selectionRows.length);
  });

  it('writes no new snapshots when a re-sync returns identical data', async () => {
    await syncOdds({ provider: new FixtureOddsProvider() });
    const afterFirst = await snapshotCount();

    const summary = await syncOdds({ provider: new FixtureOddsProvider() });

    expect(summary.snapshotsWritten).toBe(0);
    expect(await snapshotCount()).toBe(afterFirst);
  });

  it('does not duplicate teams or games across runs', async () => {
    await syncOdds({ provider: new FixtureOddsProvider() });
    const teamCount = (await db.select().from(teams)).length;
    const gameCount = (await db.select().from(games)).length;

    await syncOdds({ provider: new FixtureOddsProvider() });

    expect((await db.select().from(teams)).length).toBe(teamCount);
    expect((await db.select().from(games)).length).toBe(gameCount);
  });

  it('does not leak an orphan event on re-sync', async () => {
    await syncOdds({ provider: new FixtureOddsProvider() });
    const eventCount = (await db.select().from(events)).length;
    const before = await db
      .select({ eventId: games.eventId })
      .from(games)
      .where(eq(games.externalId, SPREAD_GAME));

    await syncOdds({ provider: new FixtureOddsProvider() });

    expect((await db.select().from(events)).length).toBe(eventCount);
    const after = await db
      .select({ eventId: games.eventId })
      .from(games)
      .where(eq(games.externalId, SPREAD_GAME));
    expect(after[0].eventId).toBe(before[0].eventId);
  });

  it('updates the price and snapshots it when a line moves', async () => {
    await syncOdds({ provider: new FixtureOddsProvider({ round: 0 }) });
    const before = await selectionFor(SPREAD_GAME, 'HOME');
    expect(before.line).toBe('-3.50');

    const beforeSnapshots = await snapshotCount();
    const summary = await syncOdds({ provider: new FixtureOddsProvider({ round: 1 }) });

    const after = await selectionFor(SPREAD_GAME, 'HOME');
    expect(after.id).toBe(before.id); // updated in place, not replaced
    expect(after.line).toBe('-4.50');
    expect(after.priceAmerican).toBe(-120);

    // Both sides of that market moved, and nothing else did.
    expect(summary.snapshotsWritten).toBe(2);
    expect(await snapshotCount()).toBe(beforeSnapshots + 2);
  });

  it('keeps the full snapshot history for a moved line', async () => {
    await syncOdds({ provider: new FixtureOddsProvider({ round: 0 }) });
    await syncOdds({ provider: new FixtureOddsProvider({ round: 1 }) });

    const selection = await selectionFor(SPREAD_GAME, 'HOME');
    const history = await db
      .select()
      .from(oddsSnapshots)
      .where(eq(oddsSnapshots.selectionId, selection.id));

    expect(history).toHaveLength(2);
    expect(history.map((h) => h.line).sort()).toEqual(['-3.50', '-4.50']);
  });

  it('carries the slate market status through, so a suspended market stays suspended', async () => {
    await syncOdds({ provider: new FixtureOddsProvider() });

    const [suspended] = await db
      .select({ status: markets.status })
      .from(markets)
      .innerJoin(games, eq(markets.eventId, games.eventId))
      .where(eq(games.externalId, 'ncaaf-2026-w2-bama-uga'));

    expect(suspended.status).toBe('SUSPENDED');
  });

  it('records the source book that priced each market', async () => {
    await syncOdds({ provider: new FixtureOddsProvider() });
    const rows = await db.select().from(markets);

    expect(rows.every((m) => m.sourceBook === 'draftkings')).toBe(true);
  });
});

describe('suspendStaleMarkets', () => {
  beforeEach(resetDb);

  it('suspends markets whose data is older than the staleness window', async () => {
    await syncOdds({ provider: new FixtureOddsProvider() });

    const stale = new Date(Date.now() - 31 * 60_000);
    await db.update(markets).set({ lastSyncedAt: stale });

    const suspended = await suspendStaleMarkets();

    const open = await db.select().from(markets).where(eq(markets.status, 'OPEN'));
    expect(open).toHaveLength(0);
    expect(suspended).toBeGreaterThan(0);
  });

  it('leaves freshly synced markets alone', async () => {
    await syncOdds({ provider: new FixtureOddsProvider() });

    const suspended = await suspendStaleMarkets();

    expect(suspended).toBe(0);
    const open = await db.select().from(markets).where(eq(markets.status, 'OPEN'));
    expect(open.length).toBeGreaterThan(0);
  });

  it('never reopens a settled market', async () => {
    await syncOdds({ provider: new FixtureOddsProvider() });
    await db.update(markets).set({ status: 'SETTLED', lastSyncedAt: new Date(Date.now() - 60 * 60_000) });

    await suspendStaleMarkets();

    const settled = await db.select().from(markets).where(eq(markets.status, 'SETTLED'));
    expect(settled.length).toBeGreaterThan(0);
  });
});
