import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/client';
import { jobRuns } from '@/db/schema';
import { resetDb } from '@/test/db';

vi.mock('@/server/ops/alerts', () => ({
  raiseAlert: vi.fn().mockResolvedValue(undefined),
  formatAlert: (a: { kind: string; message: string }) => `[${a.kind}] ${a.message}`,
}));

vi.mock('@/server/odds/sync', async () => {
  const actual = await vi.importActual<typeof import('@/server/odds/sync')>('@/server/odds/sync');
  return { ...actual, syncOdds: vi.fn(actual.syncOdds) };
});

import { raiseAlert } from '@/server/ops/alerts';
import { syncOdds } from '@/server/odds/sync';
import { GET } from '@/app/api/cron/sync-odds/route';

const alerts = vi.mocked(raiseAlert);
const mockedSyncOdds = vi.mocked(syncOdds);

function request(secret = 'shhh') {
  return new Request('https://app.example/api/cron/sync-odds', {
    headers: { authorization: `Bearer ${secret}` },
  });
}

beforeEach(async () => {
  await resetDb();
  vi.stubEnv('CRON_SECRET', 'shhh');
  alerts.mockClear();
});

afterEach(() => vi.unstubAllEnvs());

describe('GET /api/cron/sync-odds', () => {
  it('refuses a request without the bearer token', async () => {
    const response = await GET(request('wrong'));
    expect(response.status).toBe(401);
  });

  it('syncs the fixture slate and records a clean SYNC_ODDS run', async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.odds.gamesUpserted).toBeGreaterThan(0);
    expect(body).toHaveProperty('results');
    expect(body).toHaveProperty('suspended');

    const [run] = await db.select().from(jobRuns);
    expect(run.job).toBe('SYNC_ODDS');
    expect(run.ok).toBe(true);
    expect(run.finishedAt).not.toBeNull();
    expect(alerts).not.toHaveBeenCalled();
  });

  it('records a failure, alerts, and still throws when the sync fails', async () => {
    mockedSyncOdds.mockRejectedValueOnce(new Error('ESPN is down'));

    await expect(GET(request())).rejects.toThrow('ESPN is down');

    const [run] = await db.select().from(jobRuns);
    expect(run.job).toBe('SYNC_ODDS');
    expect(run.ok).toBe(false);
    expect(run.error).toBe('Error: ESPN is down');
    expect(alerts.mock.calls[0][0].kind).toBe('CRON_FAILED');
  });
});
