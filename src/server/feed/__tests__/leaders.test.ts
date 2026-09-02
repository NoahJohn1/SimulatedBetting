import { beforeEach, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedEvents, seasonMemberships } from '@/db/schema';
import { detectLeadChange } from '@/server/feed/leaders';
import type { LeadChangePayload } from '@/server/feed/payload';
import { resetDb } from '@/test/db';
import { makeSeason, makeUser } from '@/test/factories';

async function seedSeason(balances: bigint[]) {
  const season = await makeSeason({ status: 'ACTIVE' });
  const ids: string[] = [];
  for (const balance of balances) {
    const user = await makeUser();
    const [membership] = await db
      .insert(seasonMemberships)
      .values({ userId: user.id, seasonId: season.id, balanceCents: balance })
      .returning();
    ids.push(membership.id);
  }
  return { seasonId: season.id, membershipIds: ids };
}

async function setBalance(membershipId: string, balanceCents: bigint) {
  await db
    .update(seasonMemberships)
    .set({ balanceCents })
    .where(eq(seasonMemberships.id, membershipId));
}

async function leadEvents(seasonId: string) {
  return db
    .select()
    .from(feedEvents)
    .where(eq(feedEvents.type, 'MILESTONE_LEAD_CHANGE'))
    .orderBy(asc(feedEvents.createdAt));
}

describe('detectLeadChange', () => {
  beforeEach(resetDb);

  it('emits nothing at season start, when everyone is tied', async () => {
    const { seasonId } = await seedSeason([1_000_000n, 1_000_000n, 1_000_000n]);

    expect(await detectLeadChange(seasonId)).toEqual({ emitted: false });
    expect(await leadEvents(seasonId)).toHaveLength(0);
  });

  it('emits when someone opens a strict lead, with the margin over second', async () => {
    const { seasonId, membershipIds } = await seedSeason([1_000_000n, 1_000_000n]);
    await setBalance(membershipIds[1], 1_030_000n);

    expect(await detectLeadChange(seasonId)).toEqual({ emitted: true });

    const events = await leadEvents(seasonId);
    expect(events).toHaveLength(1);
    expect(events[0].subjectMembershipId).toBe(membershipIds[1]);
    expect(events[0].dedupeKey).toBe(`lead:${seasonId}:1`);

    const payload = events[0].payload as LeadChangePayload;
    expect(payload.sequence).toBe(1);
    expect(payload.previousLeaderMembershipId).toBeNull();
    expect(payload.balanceCents).toBe('1030000');
    expect(payload.marginCents).toBe('30000');
  });

  it('does not re-announce an unchanged leader', async () => {
    const { seasonId, membershipIds } = await seedSeason([1_000_000n, 1_030_000n]);

    await detectLeadChange(seasonId);
    await setBalance(membershipIds[1], 1_040_000n);

    expect(await detectLeadChange(seasonId)).toEqual({ emitted: false });
    expect(await leadEvents(seasonId)).toHaveLength(1);
  });

  it('announces a lead retaken by a previous leader with the next sequence number', async () => {
    const { seasonId, membershipIds } = await seedSeason([1_100_000n, 1_000_000n]);

    await detectLeadChange(seasonId); // A leads, sequence 1

    await setBalance(membershipIds[1], 1_200_000n);
    await detectLeadChange(seasonId); // B leads, sequence 2

    await setBalance(membershipIds[0], 1_300_000n);
    await detectLeadChange(seasonId); // A leads again, sequence 3

    const events = await leadEvents(seasonId);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.subjectMembershipId)).toEqual([
      membershipIds[0],
      membershipIds[1],
      membershipIds[0],
    ]);
    expect((events[2].payload as LeadChangePayload).sequence).toBe(3);
    expect((events[2].payload as LeadChangePayload).previousLeaderMembershipId).toBe(
      membershipIds[1],
    );
    expect(events[2].dedupeKey).toBe(`lead:${seasonId}:3`);
  });

  it('is safe to run twice in a row', async () => {
    const { seasonId } = await seedSeason([1_000_000n, 1_030_000n]);

    await detectLeadChange(seasonId);
    await detectLeadChange(seasonId);

    expect(await leadEvents(seasonId)).toHaveLength(1);
  });

  it('emits nothing for a season with no members', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    expect(await detectLeadChange(season.id)).toEqual({ emitted: false });
  });
});
