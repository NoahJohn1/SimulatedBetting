import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { seasons, users } from '@/db/schema';
import { resetDb } from '@/test/db';

describe('identity schema', () => {
  beforeEach(resetDb);

  it('stores a user defaulting to PENDING', async () => {
    const [user] = await db
      .insert(users)
      .values({
        provider: 'GOOGLE',
        providerAccountId: 'google-1',
        email: 'a@example.com',
        displayName: 'Conner',
      })
      .returning();

    expect(user.status).toBe('PENDING');
    expect(user.role).toBe('USER');
  });

  it('allows only one ACTIVE season', async () => {
    const base = {
      startsAt: new Date('2026-09-01'),
      endsAt: new Date('2027-01-31'),
      startingBankrollCents: 1_000_000n,
      weeklyAllowanceCents: 50_000n,
      allowanceWeekday: 2,
      status: 'ACTIVE' as const,
    };

    await db.insert(seasons).values({ ...base, name: 'First' });

    await expect(db.insert(seasons).values({ ...base, name: 'Second' })).rejects.toThrow();
  });
});
