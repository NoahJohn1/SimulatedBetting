import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { customEvents, events, feedEvents, markets, selections } from '@/db/schema';
import { createCustomEvent } from '@/server/events/create';
import { resetDb } from '@/test/db';
import { makeMembership } from '@/server/bets/__tests__/helpers';

const IN_A_DAY = new Date(Date.now() + 86_400_000);
const IN_A_WEEK = new Date(Date.now() + 7 * 86_400_000);

function validInput(creatorMembershipId: string) {
  return {
    creatorMembershipId,
    title: 'Jyxnzi Cup',
    description: 'Rainbow Six, best of five',
    startsAt: IN_A_DAY,
    resolvesBy: IN_A_WEEK,
    markets: [
      {
        title: 'Who wins the cup?',
        outcomes: [
          { label: 'Falcons', priceAmerican: -150 },
          { label: 'Ravens', priceAmerican: 130 },
          { label: 'Field', priceAmerican: 900 },
        ],
      },
      {
        title: 'Who wins map 1?',
        outcomes: [
          { label: 'Falcons', priceAmerican: -110 },
          { label: 'Ravens', priceAmerican: -110 },
        ],
      },
    ],
  };
}

describe('createCustomEvent', () => {
  beforeEach(resetDb);

  it('writes the event, its markets and its outcomes in one go', async () => {
    const { membership } = await makeMembership();

    const result = await createCustomEvent(validInput(membership.id));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [event] = await db.select().from(events).where(eq(events.id, result.eventId));
    expect(event.kind).toBe('CUSTOM');
    expect(event.title).toBe('Jyxnzi Cup');

    const [custom] = await db
      .select()
      .from(customEvents)
      .where(eq(customEvents.eventId, result.eventId));
    expect(custom.status).toBe('OPEN');
    expect(custom.creatorMembershipId).toBe(membership.id);

    const marketRows = await db.select().from(markets).where(eq(markets.eventId, result.eventId));
    expect(marketRows).toHaveLength(2);
    expect(marketRows.every((m) => m.type === 'CUSTOM_OUTCOME' && m.sourceBook === null)).toBe(true);

    const first = marketRows.find((m) => m.title === 'Who wins the cup?')!;
    const outcomes = await db
      .select()
      .from(selections)
      .where(eq(selections.marketId, first.id))
      .orderBy(selections.sortOrder);
    expect(outcomes.map((o) => o.label)).toEqual(['Falcons', 'Ravens', 'Field']);
    expect(outcomes.map((o) => o.sortOrder)).toEqual([0, 1, 2]);
  });

  it('posts one CUSTOM_EVENT_CREATED card', async () => {
    const { membership } = await makeMembership();
    const result = await createCustomEvent(validInput(membership.id));
    if (!result.ok) throw new Error('expected ok');

    const cards = await db
      .select()
      .from(feedEvents)
      .where(eq(feedEvents.type, 'CUSTOM_EVENT_CREATED'));

    expect(cards).toHaveLength(1);
    expect(cards[0].dedupeKey).toBe(`customevent:${result.eventId}:created`);
    expect(cards[0].subjectMembershipId).toBe(membership.id);
    expect(cards[0].payload).toMatchObject({ title: 'Jyxnzi Cup', marketCount: 2 });
  });

  it.each([
    ['blank title', { title: '   ' }, 'INVALID_TITLE'],
    ['title over 120 chars', { title: 'x'.repeat(121) }, 'INVALID_TITLE'],
    ['description over 1000 chars', { description: 'x'.repeat(1001) }, 'INVALID_DESCRIPTION'],
    ['start in the past', { startsAt: new Date(Date.now() - 1000) }, 'INVALID_SCHEDULE'],
    ['resolves before it starts', { resolvesBy: new Date(Date.now() + 1000) }, 'INVALID_SCHEDULE'],
    ['no markets', { markets: [] }, 'INVALID_MARKET_COUNT'],
  ])('rejects %s', async (_label, override, code) => {
    const { membership } = await makeMembership();
    const result = await createCustomEvent({ ...validInput(membership.id), ...override });

    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code }) });
  });

  it('rejects a market with one outcome', async () => {
    const { membership } = await makeMembership();
    const result = await createCustomEvent({
      ...validInput(membership.id),
      markets: [{ title: 'Who wins?', outcomes: [{ label: 'Falcons', priceAmerican: -110 }] }],
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'INVALID_MARKET', marketIndex: 0, reason: 'OUTCOME_COUNT' },
    });
  });

  it('rejects duplicate outcome labels within one market', async () => {
    const { membership } = await makeMembership();
    const result = await createCustomEvent({
      ...validInput(membership.id),
      markets: [
        {
          title: 'Who wins?',
          outcomes: [
            { label: 'Falcons', priceAmerican: -110 },
            { label: ' falcons ', priceAmerican: 120 },
          ],
        },
      ],
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'INVALID_MARKET', marketIndex: 0, reason: 'DUPLICATE_LABEL' },
    });
  });

  it('rejects an unparseable price', async () => {
    const { membership } = await makeMembership();
    const result = await createCustomEvent({
      ...validInput(membership.id),
      markets: [
        {
          title: 'Who wins?',
          outcomes: [
            { label: 'Falcons', priceAmerican: 0 },
            { label: 'Ravens', priceAmerican: -110 },
          ],
        },
      ],
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'INVALID_PRICE', marketIndex: 0, outcomeIndex: 0 },
    });
  });

  it('writes nothing at all when validation fails', async () => {
    const { membership } = await makeMembership();
    await createCustomEvent({ ...validInput(membership.id), markets: [] });

    expect(await db.select().from(events)).toHaveLength(0);
  });

  it('rejects a membership that does not exist', async () => {
    const result = await createCustomEvent(
      validInput('00000000-0000-4000-8000-000000000000'),
    );
    expect(result).toEqual({ ok: false, error: { code: 'NOT_A_MEMBER' } });
  });
});
