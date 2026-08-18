import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/db/client';
import { markets, selections } from '@/db/schema';
import { placeBet } from '@/server/bets/place';
import { editCustomEvent, setMarketStatus } from '@/server/events/manage';
import { postEntry } from '@/server/money/ledger';
import { resetDb } from '@/test/db';
import { makeCustomEvent } from '@/test/factories';
import { makeMembership } from '@/server/bets/__tests__/helpers';

async function seed() {
  const creator = await makeMembership(1_000_000n);
  const other = await makeMembership(1_000_000n, creator.seasonId);
  for (const m of [creator.membership.id, other.membership.id]) {
    await db.transaction((tx) =>
      postEntry(tx, {
        membershipId: m,
        amountCents: 100_000n,
        type: 'SEASON_STARTING_GRANT',
        currency: 'CREDITS',
        idempotencyKey: `credits:${m}`,
      }),
    );
  }
  const event = await makeCustomEvent({
    creatorMembershipId: creator.membership.id,
    seasonId: creator.seasonId,
  });
  return { creator, other, event };
}

describe('setMarketStatus', () => {
  beforeEach(resetDb);

  it('lets the creator suspend and reopen a market', async () => {
    const { creator, event } = await seed();
    const marketId = event.marketSelections[0].marketId;

    expect(
      await setMarketStatus({
        marketId,
        status: 'SUSPENDED',
        actorMembershipId: creator.membership.id,
        isAdmin: false,
      }),
    ).toEqual({ ok: true });

    const [suspended] = await db.select().from(markets).where(eq(markets.id, marketId));
    expect(suspended.status).toBe('SUSPENDED');

    await setMarketStatus({
      marketId,
      status: 'OPEN',
      actorMembershipId: creator.membership.id,
      isAdmin: false,
    });
    const [reopened] = await db.select().from(markets).where(eq(markets.id, marketId));
    expect(reopened.status).toBe('OPEN');
  });

  it('rejects a member who is neither creator nor admin', async () => {
    const { other, event } = await seed();

    expect(
      await setMarketStatus({
        marketId: event.marketSelections[0].marketId,
        status: 'SUSPENDED',
        actorMembershipId: other.membership.id,
        isAdmin: false,
      }),
    ).toEqual({ ok: false, error: { code: 'NOT_AUTHORIZED' } });
  });
});

describe('editCustomEvent', () => {
  beforeEach(resetDb);

  it('reprices an outcome while the event has no bets', async () => {
    const { creator, event } = await seed();

    const result = await editCustomEvent({
      eventId: event.eventId,
      actorMembershipId: creator.membership.id,
      title: 'Test Cup (rescheduled)',
      markets: event.marketSelections.map((m) => ({
        marketId: m.marketId,
        title: m.marketTitle,
        outcomes: m.selectionIds.map((selectionId, i) => ({
          selectionId,
          priceAmerican: i === 0 ? -200 : 160,
        })),
      })),
    });

    expect(result).toEqual({ ok: true });

    const [outcome] = await db
      .select()
      .from(selections)
      .where(eq(selections.id, event.marketSelections[0].selectionIds[0]));
    expect(outcome.priceAmerican).toBe(-200);
  });

  it('refuses once a single credit is at risk', async () => {
    const { creator, other, event } = await seed();

    await placeBet({
      userId: other.user.id,
      type: 'SINGLE',
      stakeCents: 1_000n,
      clientRequestId: randomUUID(),
      legs: [
        { selectionId: event.marketSelections[0].selectionIds[0], line: null, priceAmerican: 100 },
      ],
    });

    const result = await editCustomEvent({
      eventId: event.eventId,
      actorMembershipId: creator.membership.id,
      title: 'Too late',
      markets: [],
    });

    expect(result).toEqual({ ok: false, error: { code: 'EVENT_HAS_BETS' } });
  });
});
