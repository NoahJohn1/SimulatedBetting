import { db } from '@/db/client';
import { customEvents, events, markets, seasonMemberships, seasons, selections, users } from '@/db/schema';

let counter = 0;

export async function makeUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  counter += 1;
  const [user] = await db
    .insert(users)
    .values({
      provider: 'GOOGLE',
      providerAccountId: `google-${counter}`,
      email: `user${counter}@example.com`,
      displayName: `User ${counter}`,
      status: 'APPROVED',
      ...overrides,
    })
    .returning();
  return user;
}

export async function makeSeason(overrides: Partial<typeof seasons.$inferInsert> = {}) {
  counter += 1;
  const [season] = await db
    .insert(seasons)
    .values({
      name: `Season ${counter}`,
      startsAt: new Date('2026-09-01T00:00:00Z'),
      endsAt: new Date('2027-01-31T00:00:00Z'),
      startingBankrollCents: 1_000_000n,
      weeklyAllowanceCents: 50_000n,
      allowanceWeekday: 2,
      status: 'UPCOMING',
      ...overrides,
    })
    .returning();
  return season;
}

export async function makeMembership(balanceCents = 1_000_000n) {
  const user = await makeUser();
  const season = await makeSeason();
  const [membership] = await db
    .insert(seasonMemberships)
    .values({ userId: user.id, seasonId: season.id, balanceCents })
    .returning();
  return membership;
}

export interface MadeCustomEvent {
  eventId: string;
  seasonId: string;
  creatorMembershipId: string;
  /** marketId -> ordered selection ids */
  marketSelections: { marketId: string; marketTitle: string; selectionIds: string[] }[];
}

/**
 * A two-market custom event, open for betting, priced at even money so payouts are easy to
 * assert by hand.
 */
export async function makeCustomEvent(opts: {
  creatorMembershipId: string;
  seasonId: string;
  startsAt?: Date;
  resolvesBy?: Date;
}): Promise<MadeCustomEvent> {
  const startsAt = opts.startsAt ?? new Date(Date.now() + 86_400_000);
  const resolvesBy = opts.resolvesBy ?? new Date(Date.now() + 7 * 86_400_000);

  const [event] = await db
    .insert(events)
    .values({ kind: 'CUSTOM', title: 'Test Cup', startsAt })
    .returning();

  await db.insert(customEvents).values({
    eventId: event.id,
    seasonId: opts.seasonId,
    creatorMembershipId: opts.creatorMembershipId,
    resolvesBy,
  });

  const marketSelections = [];
  for (const [title, labels] of [
    ['Who wins the cup?', ['Falcons', 'Ravens']],
    ['Who wins map 1?', ['Falcons', 'Ravens']],
  ] as const) {
    const [market] = await db
      .insert(markets)
      .values({ eventId: event.id, type: 'CUSTOM_OUTCOME', title, sourceBook: null })
      .returning();

    const rows = await db
      .insert(selections)
      .values(
        labels.map((label, i) => ({
          marketId: market.id,
          label,
          priceAmerican: 100,
          sortOrder: i,
        })),
      )
      .returning();

    marketSelections.push({
      marketId: market.id,
      marketTitle: title,
      selectionIds: rows.map((r) => r.id),
    });
  }

  return {
    eventId: event.id,
    seasonId: opts.seasonId,
    creatorMembershipId: opts.creatorMembershipId,
    marketSelections,
  };
}
