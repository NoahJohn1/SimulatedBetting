import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedEvents, seasonMemberships } from '@/db/schema';
import { adjustBalance } from '@/server/admin/adjust';
import { isoWeekKey, payWeeklyAllowance } from '@/server/seasons/allowance';
import { joinSeason } from '@/server/seasons/service';
import type {
  AdminAdjustmentPayload,
  AllowancePaidPayload,
  MemberJoinedPayload,
} from '@/server/feed/payload';
import { resetDb } from '@/test/db';
import { makeSeason, makeUser } from '@/test/factories';

describe('money-path feed emission', () => {
  beforeEach(resetDb);

  it('announces a member joining, once', async () => {
    const user = await makeUser();
    const season = await makeSeason({ status: 'ACTIVE' });

    await joinSeason(user.id, season.id);
    await joinSeason(user.id, season.id); // idempotent re-join

    const events = await db.select().from(feedEvents).where(eq(feedEvents.type, 'MEMBER_JOINED'));
    expect(events).toHaveLength(1);
    expect((events[0].payload as MemberJoinedPayload).startingBankrollCents).toBe('1000000');
  });

  it('posts one aggregated allowance card per week, not one per member', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    for (const _ of [1, 2, 3]) {
      const user = await makeUser();
      await joinSeason(user.id, season.id);
    }

    const now = new Date('2026-09-08T12:00:00Z');
    await payWeeklyAllowance(now);
    await payWeeklyAllowance(now); // double cron fire

    const events = await db.select().from(feedEvents).where(eq(feedEvents.type, 'ALLOWANCE_PAID'));
    expect(events).toHaveLength(1);

    const payload = events[0].payload as AllowancePaidPayload;
    expect(payload.memberCount).toBe(3);
    expect(payload.amountCents).toBe('50000');
    expect(payload.weekKey).toBe(isoWeekKey(now));
    expect(events[0].subjectMembershipId).toBeNull();
  });

  it('publishes an admin adjustment with its note and the admin name', async () => {
    const user = await makeUser();
    const admin = await makeUser({ role: 'ADMIN', displayName: 'Chris' });
    const season = await makeSeason({ status: 'ACTIVE' });
    const { membershipId } = await joinSeason(user.id, season.id);

    await adjustBalance({
      membershipId,
      amountCents: 25_000n,
      note: 'won the survivor pool',
      actorUserId: admin.id,
      idempotencyKey: 'adjust:test:1',
    });

    const [event] = await db
      .select()
      .from(feedEvents)
      .where(eq(feedEvents.type, 'ADMIN_ADJUSTMENT'));
    expect(event.subjectMembershipId).toBe(membershipId);
    expect(event.ledgerEntryId).not.toBeNull();

    const payload = event.payload as AdminAdjustmentPayload;
    expect(payload.amountCents).toBe('25000');
    expect(payload.note).toBe('won the survivor pool');
    expect(payload.adminDisplayName).toBe('Chris');
  });

  it('does not re-announce an adjustment replayed under the same idempotency key', async () => {
    const user = await makeUser();
    const admin = await makeUser({ role: 'ADMIN' });
    const season = await makeSeason({ status: 'ACTIVE' });
    const { membershipId } = await joinSeason(user.id, season.id);

    const input = {
      membershipId,
      amountCents: 25_000n,
      note: 'twice',
      actorUserId: admin.id,
      idempotencyKey: 'adjust:test:2',
    };
    await adjustBalance(input);
    await adjustBalance(input);

    const events = await db
      .select()
      .from(feedEvents)
      .where(eq(feedEvents.type, 'ADMIN_ADJUSTMENT'));
    expect(events).toHaveLength(1);

    const [membership] = await db
      .select()
      .from(seasonMemberships)
      .where(eq(seasonMemberships.id, membershipId));
    expect(membership.balanceCents).toBe(1_025_000n);
  });
});
