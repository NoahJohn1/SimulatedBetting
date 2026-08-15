import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { ledgerEntries } from '@/db/schema';
import { createSeason, joinSeason } from '@/server/seasons/service';
import { resetDb } from '@/test/db';
import { makeUser } from '@/test/factories';

describe('season service', () => {
  beforeEach(resetDb);

  it('creates a season with the default economy settings', async () => {
    const season = await createSeason({
      name: '2026 Football',
      startsAt: new Date('2026-09-01T00:00:00Z'),
      endsAt: new Date('2027-01-31T00:00:00Z'),
    });

    expect(season.startingBankrollCents).toBe(1_000_000n);
    expect(season.weeklyAllowanceCents).toBe(50_000n);
    expect(season.allowanceWeekday).toBe(2);
    expect(season.status).toBe('UPCOMING');
  });

  it('grants the starting bankroll on join', async () => {
    const user = await makeUser();
    const season = await createSeason({
      name: '2026 Football',
      startsAt: new Date('2026-09-01T00:00:00Z'),
      endsAt: new Date('2027-01-31T00:00:00Z'),
    });

    const membership = await joinSeason(user.id, season.id);

    expect(membership.balanceCents).toBe(1_000_000n);

    const entries = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.membershipId, membership.membershipId));

    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('SEASON_STARTING_GRANT');
    expect(entries[0].amountCents).toBe(1_000_000n);
  });

  it('does not mint a second bankroll when a join is retried', async () => {
    const user = await makeUser();
    const season = await createSeason({
      name: '2026 Football',
      startsAt: new Date('2026-09-01T00:00:00Z'),
      endsAt: new Date('2027-01-31T00:00:00Z'),
    });

    const first = await joinSeason(user.id, season.id);
    const second = await joinSeason(user.id, season.id);

    expect(second.membershipId).toBe(first.membershipId);
    expect(second.balanceCents).toBe(1_000_000n);
    expect(
      await db.select().from(ledgerEntries).where(eq(ledgerEntries.membershipId, first.membershipId)),
    ).toHaveLength(1);
  });
});
