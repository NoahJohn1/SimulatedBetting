import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { customEvents, events, markets, selections } from '@/db/schema';
import { resetDb } from '@/test/db';
import { makeMembership } from '@/server/bets/__tests__/helpers';

async function seedCustomEvent() {
  const { membership } = await makeMembership();

  const [event] = await db
    .insert(events)
    .values({
      kind: 'CUSTOM',
      title: 'Jyxnzi Cup',
      startsAt: new Date(Date.now() + 86_400_000),
    })
    .returning();

  const [custom] = await db
    .insert(customEvents)
    .values({
      eventId: event.id,
      seasonId: membership.seasonId,
      creatorMembershipId: membership.id,
      resolvesBy: new Date(Date.now() + 7 * 86_400_000),
    })
    .returning();

  return { event, custom, membership };
}

describe('custom events schema', () => {
  beforeEach(resetDb);

  it('opens with status OPEN and no resolution', async () => {
    const { custom } = await seedCustomEvent();

    expect(custom.status).toBe('OPEN');
    expect(custom.resolvedAt).toBeNull();
    expect(custom.resolutionAttempts).toBe(0);
  });

  it('holds many CUSTOM_OUTCOME markets on one event', async () => {
    const { event } = await seedCustomEvent();

    await db.insert(markets).values([
      { eventId: event.id, type: 'CUSTOM_OUTCOME', title: 'Who wins the cup?' },
      { eventId: event.id, type: 'CUSTOM_OUTCOME', title: 'Who wins map 3?' },
    ]);

    const rows = await db.select().from(markets).where(eq(markets.eventId, event.id));
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.sourceBook === null)).toBe(true);
  });

  it('stores labelled outcomes with no side and no line', async () => {
    const { event } = await seedCustomEvent();

    const [market] = await db
      .insert(markets)
      .values({ eventId: event.id, type: 'CUSTOM_OUTCOME', title: 'Who wins map 3?' })
      .returning();

    await db.insert(selections).values([
      { marketId: market.id, label: 'Falcons', priceAmerican: -150, sortOrder: 0 },
      { marketId: market.id, label: 'Ravens', priceAmerican: 130, sortOrder: 1 },
    ]);

    const rows = await db
      .select()
      .from(selections)
      .where(eq(selections.marketId, market.id))
      .orderBy(selections.sortOrder);

    expect(rows.map((r) => r.label)).toEqual(['Falcons', 'Ravens']);
    expect(rows.every((r) => r.side === null && r.line === null)).toBe(true);
  });

  it('rejects two outcomes with the same label in one market', async () => {
    const { event } = await seedCustomEvent();
    const [market] = await db
      .insert(markets)
      .values({ eventId: event.id, type: 'CUSTOM_OUTCOME', title: 'Who wins?' })
      .returning();

    await db.insert(selections).values({ marketId: market.id, label: 'Falcons', priceAmerican: -150 });

    await expect(
      db.insert(selections).values({ marketId: market.id, label: 'Falcons', priceAmerican: 100 }),
    ).rejects.toThrow();
  });

  it('still rejects two sports selections on the same side of one market', async () => {
    const { event } = await seedCustomEvent();
    const [market] = await db
      .insert(markets)
      .values({ eventId: event.id, type: 'MONEYLINE', sourceBook: 'draftkings' })
      .returning();

    await db.insert(selections).values({ marketId: market.id, side: 'HOME', priceAmerican: -110 });

    await expect(
      db.insert(selections).values({ marketId: market.id, side: 'HOME', priceAmerican: -120 }),
    ).rejects.toThrow();
  });
});
