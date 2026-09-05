import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { getNotificationPreferences } from '@/server/notify/preferences';
import { signUnsubscribe } from '@/server/notify/unsubscribe';
import { resetDb } from '@/test/db';
import { POST } from '@/app/api/unsubscribe/route';

async function aUser() {
  const [row] = await db
    .insert(users)
    .values({
      provider: 'GOOGLE',
      providerAccountId: 'a@example.com',
      email: 'a@example.com',
      displayName: 'A',
      status: 'APPROVED',
    })
    .returning({ id: users.id });
  return row.id;
}

function post(userId: string, scope: string, token: string) {
  const url = new URL('https://app.example/api/unsubscribe');
  url.searchParams.set('u', userId);
  url.searchParams.set('s', scope);
  url.searchParams.set('t', token);
  return new Request(url, { method: 'POST' });
}

beforeEach(async () => {
  await resetDb();
  vi.stubEnv('AUTH_SECRET', 'test-secret');
});

afterEach(() => vi.unstubAllEnvs());

describe('POST /api/unsubscribe', () => {
  it('mutes one type on a valid type-scoped token', async () => {
    const userId = await aUser();
    const token = signUnsubscribe(userId, 'BETS_SETTLED');

    const response = await POST(post(userId, 'BETS_SETTLED', token));

    expect(response.status).toBe(200);
    const prefs = await getNotificationPreferences(userId);
    expect(prefs.mutedTypes).toEqual(['BETS_SETTLED']);
    expect(prefs.emailsEnabled).toBe(true);
  });

  it('turns everything off on a valid all-scoped token', async () => {
    const userId = await aUser();
    const token = signUnsubscribe(userId, 'all');

    await POST(post(userId, 'all', token));

    expect((await getNotificationPreferences(userId)).emailsEnabled).toBe(false);
  });

  it('rejects a tampered token and changes nothing', async () => {
    const userId = await aUser();
    const token = signUnsubscribe(userId, 'BETS_SETTLED');

    const response = await POST(post(userId, 'BETS_SETTLED', `${token.slice(0, -1)}x`));

    expect(response.status).toBe(400);
    expect(await getNotificationPreferences(userId)).toEqual({
      mutedTypes: [],
      emailsEnabled: true,
    });
  });

  it('rejects a narrower token used on the global scope — a link cannot widen itself', async () => {
    const userId = await aUser();
    const token = signUnsubscribe(userId, 'BETS_SETTLED');

    const response = await POST(post(userId, 'all', token));

    expect(response.status).toBe(400);
    expect((await getNotificationPreferences(userId)).emailsEnabled).toBe(true);
  });

  it('is idempotent — a scanner POSTing twice is not an error', async () => {
    const userId = await aUser();
    const token = signUnsubscribe(userId, 'BETS_SETTLED');

    await POST(post(userId, 'BETS_SETTLED', token));
    const second = await POST(post(userId, 'BETS_SETTLED', token));

    expect(second.status).toBe(200);
    expect((await getNotificationPreferences(userId)).mutedTypes).toEqual(['BETS_SETTLED']);
  });

  it('says nothing about whether the user exists', async () => {
    const stranger = '11111111-1111-1111-1111-111111111111';
    const response = await POST(post(stranger, 'BETS_SETTLED', 'nope'));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid link' });
  });
});
