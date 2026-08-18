/**
 * Track A's own test factories.
 *
 * `resetDb` is imported from `@/test/db` and never extended here — B owns that file.
 * Everything below builds only the sports and betting rows Track A's tests need.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  events,
  games,
  markets,
  seasonMemberships,
  seasons,
  selections,
  teams,
  users,
} from '@/db/schema';
import type { MarketTypeValue, SelectionSide } from '@/db/schema';

let counter = 0;

function next(): number {
  counter += 1;
  return counter;
}

export async function makeUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const n = next();
  const [user] = await db
    .insert(users)
    .values({
      provider: 'GOOGLE',
      providerAccountId: `google-a-${n}`,
      email: `a-user${n}@example.com`,
      displayName: `A User ${n}`,
      status: 'APPROVED',
      ...overrides,
    })
    .returning();
  return user;
}

export async function makeSeason(overrides: Partial<typeof seasons.$inferInsert> = {}) {
  const n = next();
  const [season] = await db
    .insert(seasons)
    .values({
      name: `A Season ${n}`,
      startsAt: new Date('2026-09-01T00:00:00Z'),
      endsAt: new Date('2027-01-31T00:00:00Z'),
      startingBankrollCents: 1_000_000n,
      weeklyAllowanceCents: 50_000n,
      allowanceWeekday: 2,
      status: 'ACTIVE',
      ...overrides,
    })
    .returning();
  return season;
}

/**
 * A membership in an ACTIVE season, since that is what placement requires. The balance is
 * set directly rather than through the ledger — these tests are about placement, and the
 * grant path already has its own coverage in Track B.
 */
export async function makeMembership(balanceCents = 1_000_000n, seasonId?: string) {
  const user = await makeUser();
  const season = seasonId ? { id: seasonId } : await makeSeason();
  const [membership] = await db
    .insert(seasonMemberships)
    .values({ userId: user.id, seasonId: season.id, balanceCents })
    .returning();
  return { membership, user, seasonId: season.id };
}

export async function makeTeam(overrides: Partial<typeof teams.$inferInsert> = {}) {
  const n = next();
  const [team] = await db
    .insert(teams)
    .values({
      sport: 'NFL',
      externalId: `team-${n}`,
      name: `Team ${n}`,
      abbreviation: `T${n}`,
      ...overrides,
    })
    .returning();
  return team;
}

export async function makeGame(overrides: Partial<typeof games.$inferInsert> = {}) {
  const n = next();
  const home = await makeTeam();
  const away = await makeTeam();
  const startsAt = overrides.startsAt ?? new Date(Date.now() + 86_400_000);

  const [event] = await db
    .insert(events)
    .values({
      kind: 'GAME',
      title: `${away.abbreviation} @ ${home.abbreviation}`,
      startsAt,
    })
    .returning();

  const [game] = await db
    .insert(games)
    .values({
      sport: 'NFL',
      externalId: `game-${n}`,
      homeTeamId: home.id,
      awayTeamId: away.id,
      seasonYear: 2026,
      week: 1,
      status: 'SCHEDULED',
      ...overrides,
      startsAt,
      eventId: event.id,
    })
    .returning();
  return game;
}

export async function makeMarket(
  gameId: string,
  type: MarketTypeValue = 'MONEYLINE',
  overrides: Partial<typeof markets.$inferInsert> = {},
) {
  const [game] = await db.select({ eventId: games.eventId }).from(games).where(eq(games.id, gameId));
  const [market] = await db
    .insert(markets)
    .values({
      gameId,
      eventId: game.eventId,
      type,
      sourceBook: 'draftkings',
      status: 'OPEN',
      ...overrides,
    })
    .returning();
  return market;
}

export async function makeSelection(
  marketId: string,
  side: SelectionSide,
  priceAmerican: number,
  line: string | null = null,
) {
  const [selection] = await db
    .insert(selections)
    .values({ marketId, side, priceAmerican, line })
    .returning();
  return selection;
}

export interface BettableGame {
  game: Awaited<ReturnType<typeof makeGame>>;
  moneyline: { home: string; away: string };
  spread: { home: string; away: string };
  total: { over: string; under: string };
}

/** A scheduled game with all three market types priced, ready to bet against. */
export async function seedBettableGame(
  overrides: Partial<typeof games.$inferInsert> = {},
): Promise<BettableGame> {
  const game = await makeGame(overrides);

  const mlMarket = await makeMarket(game.id, 'MONEYLINE');
  const mlHome = await makeSelection(mlMarket.id, 'HOME', -110);
  const mlAway = await makeSelection(mlMarket.id, 'AWAY', -110);

  const spreadMarket = await makeMarket(game.id, 'SPREAD');
  const spreadHome = await makeSelection(spreadMarket.id, 'HOME', -110, '-3.50');
  const spreadAway = await makeSelection(spreadMarket.id, 'AWAY', -110, '3.50');

  const totalMarket = await makeMarket(game.id, 'TOTAL');
  const totalOver = await makeSelection(totalMarket.id, 'OVER', -110, '44.50');
  const totalUnder = await makeSelection(totalMarket.id, 'UNDER', -110, '44.50');

  return {
    game,
    moneyline: { home: mlHome.id, away: mlAway.id },
    spread: { home: spreadHome.id, away: spreadAway.id },
    total: { over: totalOver.id, under: totalUnder.id },
  };
}

export async function setSelectionPrice(
  selectionId: string,
  priceAmerican: number,
  line?: string | null,
): Promise<void> {
  await db
    .update(selections)
    .set(line === undefined ? { priceAmerican } : { priceAmerican, line })
    .where(eq(selections.id, selectionId));
}
