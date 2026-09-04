import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/client';
import { jobRuns, notifications, users } from '@/db/schema';
import { resetDb } from '@/test/db';

vi.mock('@/server/notify/transport', () => ({
  sendEmail: vi.fn().mockResolvedValue({ ok: true }),
  activeTransport: () => 'console',
}));
vi.mock('@/server/ops/alerts', () => ({
  raiseAlert: vi.fn().mockResolvedValue(undefined),
  formatAlert: (a: { kind: string; message: string }) => `[${a.kind}] ${a.message}`,
}));

import { GET } from '@/app/api/cron/notify/route';

function request(secret = 'shhh') {
  return new Request('https://app.example/api/cron/notify', {
    headers: { authorization: `Bearer ${secret}` },
  });
}

beforeEach(async () => {
  await resetDb();
  vi.stubEnv('CRON_SECRET', 'shhh');
  vi.stubEnv('AUTH_SECRET', 'test-secret');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://bets.example');
});

afterEach(() => vi.unstubAllEnvs());

describe('GET /api/cron/notify', () => {
  it('refuses a request without the bearer token', async () => {
    const response = await GET(request('wrong'));
    expect(response.status).toBe(401);
  });

  it('delivers what is queued and records the run', async () => {
    const [user] = await db
      .insert(users)
      .values({
        provider: 'GOOGLE',
        providerAccountId: 'a@example.com',
        email: 'a@example.com',
        displayName: 'A',
        status: 'APPROVED',
      })
      .returning({ id: users.id });

    await db.insert(notifications).values({
      userId: user.id,
      type: 'BETS_SETTLED',
      channel: 'DIGEST',
      dedupeKey: 'k1',
      payload: { outcome: 'WON', netCents: '100', subject: 'A' },
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sent: 1, suppressed: 0, failed: 0 });

    const runs = await db.select().from(jobRuns);
    expect(runs).toHaveLength(1);
    expect(runs[0].job).toBe('NOTIFY');
    expect(runs[0].ok).toBe(true);
  });

  it('returns 207 and records a failure when a send fails', async () => {
    const { sendEmail } = await import('@/server/notify/transport');
    vi.mocked(sendEmail).mockResolvedValue({ ok: false, error: 'Resend answered 401' });

    const [user] = await db
      .insert(users)
      .values({
        provider: 'GOOGLE',
        providerAccountId: 'a@example.com',
        email: 'a@example.com',
        displayName: 'A',
        status: 'APPROVED',
      })
      .returning({ id: users.id });

    await db.insert(notifications).values({
      userId: user.id,
      type: 'WAGER_OFFERED',
      channel: 'IMMEDIATE',
      dedupeKey: 'k1',
      payload: {},
    });

    const response = await GET(request());

    expect(response.status).toBe(207);
    const [run] = await db.select().from(jobRuns);
    expect(run.ok).toBe(false);
  });
});
