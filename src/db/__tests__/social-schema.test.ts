import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedComments, feedEvents, feedPreferences, feedReactions } from '@/db/schema';
import { resetDb } from '@/test/db';
import { makeMembership } from '@/test/factories';

describe('social schema', () => {
  beforeEach(resetDb);

  it('stores an event with a jsonb payload and a season scope', async () => {
    const membership = await makeMembership();

    const [event] = await db
      .insert(feedEvents)
      .values({
        seasonId: membership.seasonId,
        type: 'BET_PLACED',
        subjectMembershipId: membership.id,
        payload: { betType: 'SINGLE', stakeCents: '5000' },
        dedupeKey: 'bet:abc:placed',
        occurredAt: new Date('2026-09-01T17:00:00Z'),
      })
      .returning();

    expect(event.type).toBe('BET_PLACED');
    expect(event.payload).toEqual({ betType: 'SINGLE', stakeCents: '5000' });
    expect(event.subjectMembershipId).toBe(membership.id);
  });

  it('rejects a duplicate dedupe key', async () => {
    const membership = await makeMembership();
    const values = {
      seasonId: membership.seasonId,
      type: 'MEMBER_JOINED' as const,
      subjectMembershipId: membership.id,
      payload: {},
      dedupeKey: 'membership:x:joined',
      occurredAt: new Date(),
    };

    await db.insert(feedEvents).values(values);
    await expect(db.insert(feedEvents).values(values)).rejects.toThrow();
  });

  it('allows a season-wide event with no subject', async () => {
    const membership = await makeMembership();

    const [event] = await db
      .insert(feedEvents)
      .values({
        seasonId: membership.seasonId,
        type: 'ALLOWANCE_PAID',
        payload: { weekKey: '2026-W36', memberCount: 3, amountCents: '50000' },
        dedupeKey: 'allowance:s:2026-W36',
        occurredAt: new Date(),
      })
      .returning();

    expect(event.subjectMembershipId).toBeNull();
  });

  it('allows different emoji from one member but not the same one twice', async () => {
    const membership = await makeMembership();
    const [event] = await db
      .insert(feedEvents)
      .values({
        seasonId: membership.seasonId,
        type: 'BET_PLACED',
        subjectMembershipId: membership.id,
        payload: {},
        dedupeKey: 'bet:react:placed',
        occurredAt: new Date(),
      })
      .returning();

    await db.insert(feedReactions).values({ eventId: event.id, membershipId: membership.id, emoji: '🔥' });
    await db.insert(feedReactions).values({ eventId: event.id, membershipId: membership.id, emoji: '💀' });

    await expect(
      db.insert(feedReactions).values({ eventId: event.id, membershipId: membership.id, emoji: '🔥' }),
    ).rejects.toThrow();

    const rows = await db.select().from(feedReactions).where(eq(feedReactions.eventId, event.id));
    expect(rows).toHaveLength(2);
  });

  it('soft-deletes a comment, keeping the row', async () => {
    const membership = await makeMembership();
    const [event] = await db
      .insert(feedEvents)
      .values({
        seasonId: membership.seasonId,
        type: 'BET_PLACED',
        subjectMembershipId: membership.id,
        payload: {},
        dedupeKey: 'bet:comment:placed',
        occurredAt: new Date(),
      })
      .returning();

    const [comment] = await db
      .insert(feedComments)
      .values({ eventId: event.id, membershipId: membership.id, body: 'lock of the year' })
      .returning();

    expect(comment.deletedAt).toBeNull();

    await db.update(feedComments).set({ deletedAt: new Date() }).where(eq(feedComments.id, comment.id));

    const [after] = await db.select().from(feedComments).where(eq(feedComments.id, comment.id));
    expect(after.deletedAt).not.toBeNull();
    expect(after.body).toBe('lock of the year');
  });

  it('defaults muted types to an empty array', async () => {
    const membership = await makeMembership();
    const [row] = await db
      .insert(feedPreferences)
      .values({ userId: membership.userId })
      .returning();

    expect(row.mutedTypes).toEqual([]);
  });
});
