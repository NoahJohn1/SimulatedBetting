import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { events, games, markets } from '@/db/schema';
import { resetDb } from '@/test/db';
import { makeGame, makeMarket, seedBettableGame } from '@/server/bets/__tests__/helpers';

describe('events supertype', () => {
  beforeEach(resetDb);

  it('gives every game exactly one GAME event', async () => {
    const { game } = await seedBettableGame();

    const [row] = await db.select().from(games).where(eq(games.id, game.id));
    expect(row.eventId).toBeTruthy();

    const [event] = await db.select().from(events).where(eq(events.id, row.eventId));
    expect(event.kind).toBe('GAME');
    expect(event.startsAt.getTime()).toBe(game.startsAt.getTime());
    expect(event.title).toMatch(/ @ /);
  });

  it('points a market at the same event as its game', async () => {
    // seedBettableGame already creates a MONEYLINE market for this game, so use a game
    // that has no markets yet to avoid colliding with the pre-existing
    // markets_event_type_idx unique constraint on (event_id, type).
    const game = await makeGame();
    const market = await makeMarket(game.id, 'MONEYLINE');

    const [gameRow] = await db.select().from(games).where(eq(games.id, game.id));
    const [marketRow] = await db.select().from(markets).where(eq(markets.id, market.id));

    expect(marketRow.eventId).toBe(gameRow.eventId);
  });
});
