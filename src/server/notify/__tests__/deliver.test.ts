import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { notifications, users, type NotificationType } from '@/db/schema';
import { setNotificationPreferences } from '@/server/notify/preferences';
import { resetDb } from '@/test/db';

vi.mock('@/server/notify/transport', () => ({
  sendEmail: vi.fn().mockResolvedValue({ ok: true }),
  activeTransport: () => 'console',
}));

import { sendEmail } from '@/server/notify/transport';
import { deliverPending } from '@/server/notify/deliver';

const sends = vi.mocked(sendEmail);

async function aUser(email: string, status: 'APPROVED' | 'DISABLED' = 'APPROVED') {
  const [row] = await db
    .insert(users)
    .values({
      provider: 'GOOGLE',
      providerAccountId: email,
      email,
      displayName: email.split('@')[0],
      status,
    })
    .returning({ id: users.id });
  return row.id;
}

const DIGEST_TYPES: NotificationType[] = ['BETS_SETTLED', 'ALLOWANCE_PAID'];

async function queue(
  userId: string,
  type: NotificationType,
  dedupeKey: string,
  payload: Record<string, unknown> = {},
) {
  await db.insert(notifications).values({
    userId,
    type,
    channel: DIGEST_TYPES.includes(type) ? 'DIGEST' : 'IMMEDIATE',
    dedupeKey,
    payload,
  });
}

beforeEach(async () => {
  await resetDb();
  sends.mockClear();
  sends.mockResolvedValue({ ok: true });
  vi.stubEnv('AUTH_SECRET', 'test-secret');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://bets.example');
});

afterEach(() => vi.unstubAllEnvs());

describe('deliverPending', () => {
  it('sends one immediate per row and stamps it SENT', async () => {
    const userId = await aUser('a@example.com');
    await queue(userId, 'WAGER_OFFERED', 'k1', { fromName: 'Dana', subject: 'Chiefs -3.5' });

    const summary = await deliverPending();

    expect(summary.sent).toBe(1);
    expect(sends).toHaveBeenCalledTimes(1);
    expect(sends.mock.calls[0][0].to).toBe('a@example.com');

    const [row] = await db.select().from(notifications);
    expect(row.outcome).toBe('SENT');
    expect(row.sentAt).not.toBeNull();
  });

  it('collapses one user’s digest rows into a single email', async () => {
    const userId = await aUser('a@example.com');
    await queue(userId, 'BETS_SETTLED', 'b1', { outcome: 'WON', netCents: '1500', subject: 'A' });
    await queue(userId, 'BETS_SETTLED', 'b2', { outcome: 'LOST', netCents: '-500', subject: 'B' });
    await queue(userId, 'ALLOWANCE_PAID', 'a1', { amountCents: '50000' });

    const summary = await deliverPending();

    expect(sends).toHaveBeenCalledTimes(1);
    expect(summary.sent).toBe(3);
    const rows = await db.select().from(notifications);
    expect(rows.every((r) => r.outcome === 'SENT')).toBe(true);
  });

  it('keeps two users’ digests apart', async () => {
    const a = await aUser('a@example.com');
    const b = await aUser('b@example.com');
    await queue(a, 'BETS_SETTLED', 'b1', { outcome: 'WON', netCents: '1', subject: 'A' });
    await queue(b, 'BETS_SETTLED', 'b2', { outcome: 'WON', netCents: '1', subject: 'B' });

    await deliverPending();

    expect(sends).toHaveBeenCalledTimes(2);
    expect(sends.mock.calls.map((c) => c[0].to).sort()).toEqual(['a@example.com', 'b@example.com']);
  });

  it('suppresses a muted type without sending, and says so on the row', async () => {
    const userId = await aUser('a@example.com');
    await setNotificationPreferences(userId, {
      mutedTypes: ['BETS_SETTLED'],
      emailsEnabled: true,
    });
    await queue(userId, 'BETS_SETTLED', 'b1', { outcome: 'WON', netCents: '1', subject: 'A' });

    const summary = await deliverPending();

    expect(summary).toMatchObject({ sent: 0, suppressed: 1 });
    expect(sends).not.toHaveBeenCalled();
    const [row] = await db.select().from(notifications);
    expect(row.outcome).toBe('SUPPRESSED');
    expect(row.sentAt).not.toBeNull();
  });

  it('suppresses every type when email is off entirely', async () => {
    const userId = await aUser('a@example.com');
    await setNotificationPreferences(userId, { mutedTypes: [], emailsEnabled: false });
    await queue(userId, 'WAGER_OFFERED', 'k1');

    const summary = await deliverPending();

    expect(summary.suppressed).toBe(1);
    expect(sends).not.toHaveBeenCalled();
  });

  it('records a failure, leaves the row unsent, and reports it', async () => {
    const userId = await aUser('a@example.com');
    await queue(userId, 'WAGER_OFFERED', 'k1');
    sends.mockResolvedValue({ ok: false, error: 'Resend answered 422: bad from' });

    const summary = await deliverPending();

    expect(summary).toMatchObject({ sent: 0, failed: 1 });
    expect(summary.errors[0]).toContain('422');
    const [row] = await db.select().from(notifications);
    expect(row.sentAt).toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.error).toContain('422');
  });

  it('gives up after five attempts rather than retrying forever', async () => {
    const userId = await aUser('a@example.com');
    await queue(userId, 'WAGER_OFFERED', 'k1');
    sends.mockResolvedValue({ ok: false, error: 'nope' });

    for (let i = 0; i < 5; i++) await deliverPending();

    const [row] = await db.select().from(notifications);
    expect(row.attempts).toBe(5);
    expect(row.outcome).toBe('FAILED');
    expect(row.sentAt).not.toBeNull();

    sends.mockClear();
    await deliverPending();
    expect(sends).not.toHaveBeenCalled();
  });

  it('never sends the same row twice', async () => {
    const userId = await aUser('a@example.com');
    await queue(userId, 'WAGER_OFFERED', 'k1');

    await deliverPending();
    await deliverPending();

    expect(sends).toHaveBeenCalledTimes(1);
  });

  it('sends only the requested channel when one is named', async () => {
    const userId = await aUser('a@example.com');
    await queue(userId, 'WAGER_OFFERED', 'k1');
    await queue(userId, 'BETS_SETTLED', 'b1', { outcome: 'WON', netCents: '1', subject: 'A' });

    await deliverPending({ channels: ['IMMEDIATE'] });

    expect(sends).toHaveBeenCalledTimes(1);
    const rows = await db.select().from(notifications);
    expect(rows.find((r) => r.type === 'BETS_SETTLED')!.sentAt).toBeNull();
  });

  it('suppresses mail to a member who is no longer approved', async () => {
    const userId = await aUser('a@example.com');
    await db.update(users).set({ status: 'DISABLED' }).where(eq(users.id, userId));
    await queue(userId, 'WAGER_OFFERED', 'k1');

    const summary = await deliverPending();

    expect(summary.suppressed).toBe(1);
    expect(sends).not.toHaveBeenCalled();
  });

  it('still delivers ACCOUNT_APPROVED, which is exempt from the status check', async () => {
    const userId = await aUser('p@example.com', 'DISABLED');
    await queue(userId, 'ACCOUNT_APPROVED', `user:${userId}:approved`);

    const summary = await deliverPending();

    expect(summary.sent).toBe(1);
  });

  it('does nothing at all, and makes no query storm, when the queue is empty', async () => {
    const summary = await deliverPending();
    expect(summary).toEqual({ sent: 0, suppressed: 0, failed: 0, errors: [] });
    expect(sends).not.toHaveBeenCalled();
  });
});
