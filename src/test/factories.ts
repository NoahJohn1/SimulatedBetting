import { db } from '@/db/client';
import { seasonMemberships, seasons, users } from '@/db/schema';

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
