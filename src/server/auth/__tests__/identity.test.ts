import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { seasonMemberships, seasons, users } from '@/db/schema';
import { authorizeMember, upsertOAuthUser } from '@/server/auth/identity';
import { createSeason, joinSeason } from '@/server/seasons/service';
import { resetDb } from '@/test/db';

const GOOGLE_ACCOUNT = {
  provider: 'GOOGLE' as const,
  providerAccountId: 'google-12345',
  email: 'member@example.com',
  displayName: 'A Member',
};

async function activeSeason() {
  const season = await createSeason({
    name: '2026 Football',
    startsAt: new Date('2026-09-01T00:00:00Z'),
    endsAt: new Date('2027-01-31T00:00:00Z'),
  });
  await db.update(seasons).set({ status: 'ACTIVE' }).where(eq(seasons.id, season.id));
  return season;
}

describe('upsertOAuthUser', () => {
  beforeEach(resetDb);

  it('lands a first-time sign-in in PENDING, awaiting admin approval', async () => {
    const user = await upsertOAuthUser(GOOGLE_ACCOUNT);

    expect(user.status).toBe('PENDING');
    expect(user.role).toBe('USER');
    expect(user.email).toBe('member@example.com');
  });

  it('returns the same user on a repeat sign-in rather than duplicating', async () => {
    const first = await upsertOAuthUser(GOOGLE_ACCOUNT);
    const second = await upsertOAuthUser(GOOGLE_ACCOUNT);

    expect(second.id).toBe(first.id);
    expect((await db.select().from(users)).length).toBe(1);
  });

  it('refreshes the display name and avatar from the provider', async () => {
    await upsertOAuthUser(GOOGLE_ACCOUNT);
    const updated = await upsertOAuthUser({
      ...GOOGLE_ACCOUNT,
      displayName: 'Renamed Member',
      avatarUrl: 'https://example.com/a.png',
    });

    expect(updated.displayName).toBe('Renamed Member');
    expect(updated.avatarUrl).toBe('https://example.com/a.png');
  });

  it('never re-pends an already approved user', async () => {
    const first = await upsertOAuthUser(GOOGLE_ACCOUNT);
    await db.update(users).set({ status: 'APPROVED' }).where(eq(users.id, first.id));

    const returning = await upsertOAuthUser(GOOGLE_ACCOUNT);

    // A routine sign-in must not undo an admin's approval.
    expect(returning.status).toBe('APPROVED');
  });

  it('does not let a repeat sign-in silently re-enable a disabled account', async () => {
    const first = await upsertOAuthUser(GOOGLE_ACCOUNT);
    await db.update(users).set({ status: 'DISABLED' }).where(eq(users.id, first.id));

    expect((await upsertOAuthUser(GOOGLE_ACCOUNT)).status).toBe('DISABLED');
  });
});

describe('upsertOAuthUser with seeded admins', () => {
  const ORIGINAL = process.env.ADMIN_EMAILS;

  beforeEach(async () => {
    await resetDb();
    process.env.ADMIN_EMAILS = 'owner@example.com, second@example.com';
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = ORIGINAL;
  });

  it('lands a seeded address straight in as an approved admin', async () => {
    const user = await upsertOAuthUser({ ...GOOGLE_ACCOUNT, email: 'owner@example.com' });

    expect(user.role).toBe('ADMIN');
    expect(user.status).toBe('APPROVED');
  });

  it('seeds every address in the list, not just the first', async () => {
    const user = await upsertOAuthUser({
      ...GOOGLE_ACCOUNT,
      providerAccountId: 'google-second',
      email: 'second@example.com',
    });

    expect(user.role).toBe('ADMIN');
  });

  it('matches regardless of case or surrounding whitespace', async () => {
    const user = await upsertOAuthUser({ ...GOOGLE_ACCOUNT, email: '  Owner@Example.COM ' });

    expect(user.role).toBe('ADMIN');
  });

  it('promotes a seeded address that already signed in while pending', async () => {
    delete process.env.ADMIN_EMAILS;
    const first = await upsertOAuthUser({ ...GOOGLE_ACCOUNT, email: 'owner@example.com' });
    expect(first.status).toBe('PENDING');

    process.env.ADMIN_EMAILS = 'owner@example.com';
    const promoted = await upsertOAuthUser({ ...GOOGLE_ACCOUNT, email: 'owner@example.com' });

    expect(promoted.id).toBe(first.id);
    expect(promoted.role).toBe('ADMIN');
    expect(promoted.status).toBe('APPROVED');
  });

  it('leaves everyone else in the approval queue', async () => {
    const user = await upsertOAuthUser({ ...GOOGLE_ACCOUNT, email: 'stranger@example.com' });

    expect(user.role).toBe('USER');
    expect(user.status).toBe('PENDING');
  });

  it('grants nobody when the list is unset', async () => {
    delete process.env.ADMIN_EMAILS;

    const user = await upsertOAuthUser({ ...GOOGLE_ACCOUNT, email: 'owner@example.com' });

    expect(user.role).toBe('USER');
    expect(user.status).toBe('PENDING');
  });

  it('is not fooled by a substring of a seeded address', async () => {
    // "notowner@example.com" contains no seeded entry as a whole value; a naive
    // `includes` on the raw string would wrongly match it.
    const user = await upsertOAuthUser({
      ...GOOGLE_ACCOUNT,
      email: 'notowner@example.com.attacker.test',
    });

    expect(user.role).toBe('USER');
  });
});

describe('authorizeMember', () => {
  beforeEach(resetDb);

  it('grants an approved member of the active season', async () => {
    const user = await upsertOAuthUser(GOOGLE_ACCOUNT);
    await db.update(users).set({ status: 'APPROVED' }).where(eq(users.id, user.id));
    const season = await activeSeason();
    const membership = await joinSeason(user.id, season.id);

    const result = await authorizeMember(user.id);

    expect(result).toEqual({
      ok: true,
      userId: user.id,
      membershipId: membership.membershipId,
      seasonId: season.id,
      balanceCents: 1_000_000n,
      role: 'USER',
    });
  });

  it('denies a pending user so the UI can show the holding screen', async () => {
    const user = await upsertOAuthUser(GOOGLE_ACCOUNT);
    await activeSeason();

    expect(await authorizeMember(user.id)).toEqual({ ok: false, reason: 'PENDING' });
  });

  it('denies a disabled user', async () => {
    const user = await upsertOAuthUser(GOOGLE_ACCOUNT);
    await db.update(users).set({ status: 'DISABLED' }).where(eq(users.id, user.id));
    await activeSeason();

    expect(await authorizeMember(user.id)).toEqual({ ok: false, reason: 'DISABLED' });
  });

  it('reports when there is no active season', async () => {
    const user = await upsertOAuthUser(GOOGLE_ACCOUNT);
    await db.update(users).set({ status: 'APPROVED' }).where(eq(users.id, user.id));

    expect(await authorizeMember(user.id)).toEqual({ ok: false, reason: 'NO_ACTIVE_SEASON' });
  });

  it('reports an approved user who has not joined the season', async () => {
    const user = await upsertOAuthUser(GOOGLE_ACCOUNT);
    await db.update(users).set({ status: 'APPROVED' }).where(eq(users.id, user.id));
    await activeSeason();

    expect(await authorizeMember(user.id)).toEqual({ ok: false, reason: 'NOT_A_MEMBER' });
  });

  it('reports an unknown user', async () => {
    expect(await authorizeMember('11111111-1111-4111-8111-111111111111')).toEqual({
      ok: false,
      reason: 'NO_SUCH_USER',
    });
  });

  it('surfaces the admin role, so admin routes can check it server-side', async () => {
    const user = await upsertOAuthUser(GOOGLE_ACCOUNT);
    await db
      .update(users)
      .set({ status: 'APPROVED', role: 'ADMIN' })
      .where(eq(users.id, user.id));
    const season = await activeSeason();
    await joinSeason(user.id, season.id);

    const result = await authorizeMember(user.id);
    expect(result.ok && result.role).toBe('ADMIN');
  });

  it('leaves membership balances untouched', async () => {
    const user = await upsertOAuthUser(GOOGLE_ACCOUNT);
    await db.update(users).set({ status: 'APPROVED' }).where(eq(users.id, user.id));
    const season = await activeSeason();
    const membership = await joinSeason(user.id, season.id);

    await authorizeMember(user.id);

    const [row] = await db
      .select()
      .from(seasonMemberships)
      .where(eq(seasonMemberships.id, membership.membershipId));
    expect(row.balanceCents).toBe(1_000_000n);
  });
});
