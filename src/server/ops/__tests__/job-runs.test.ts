import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { jobRuns } from '@/db/schema';
import { pruneJobRuns, runJob } from '@/server/ops/job-runs';
import { resetDb } from '@/test/db';

vi.mock('@/server/ops/alerts', () => ({
  raiseAlert: vi.fn().mockResolvedValue(undefined),
  formatAlert: (a: { kind: string; message: string }) => `[${a.kind}] ${a.message}`,
}));

import { raiseAlert } from '@/server/ops/alerts';

const alerts = vi.mocked(raiseAlert);

async function runsFor(job: 'SETTLE' | 'ALLOWANCE' | 'RECONCILE') {
  return db.select().from(jobRuns).where(eq(jobRuns.job, job)).orderBy(desc(jobRuns.startedAt));
}

beforeEach(async () => {
  await resetDb();
  alerts.mockClear();
});

afterEach(() => vi.restoreAllMocks());

describe('runJob', () => {
  it('records a clean run and returns the job’s own value', async () => {
    const result = await runJob('ALLOWANCE', async () => ({ credited: 3, skipped: 0 }));

    expect(result).toEqual({ credited: 3, skipped: 0 });

    const [row] = await runsFor('ALLOWANCE');
    expect(row.ok).toBe(true);
    expect(row.finishedAt).not.toBeNull();
    expect(row.error).toBeNull();
    expect(row.summary).toEqual({ credited: 3, skipped: 0 });
    expect(row.alerted).toBe(false);
    expect(alerts).not.toHaveBeenCalled();
  });

  it('records bigint amounts as decimal strings rather than throwing', async () => {
    await runJob('SETTLE', async () => ({ centsPaid: 12_345n }));

    const [row] = await runsFor('SETTLE');
    expect(row.summary).toEqual({ centsPaid: '12345' });
  });

  it('records a throw, alerts, and re-throws unchanged', async () => {
    const boom = new TypeError('cannot read properties of undefined');

    await expect(
      runJob('SETTLE', async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);

    const [row] = await runsFor('SETTLE');
    expect(row.ok).toBe(false);
    expect(row.error).toBe('TypeError: cannot read properties of undefined');
    expect(row.alerted).toBe(true);
    expect(alerts).toHaveBeenCalledTimes(1);
    expect(alerts.mock.calls[0][0].kind).toBe('CRON_FAILED');
  });

  it('treats a run that reported per-item failures as not clean', async () => {
    await runJob(
      'SETTLE',
      async () => ({ errors: [{ gameId: 'g1', message: 'no final score' }] }),
      {
        partialErrors: (r) => r.errors.map((e) => `game ${e.gameId}: ${e.message}`),
      },
    );

    const [row] = await runsFor('SETTLE');
    expect(row.ok).toBe(false);
    expect(row.error).toContain('game g1: no final score');
    expect(alerts.mock.calls[0][0].kind).toBe('CRON_ERRORS');
  });

  it('stays quiet on a second consecutive failure', async () => {
    const fail = () =>
      runJob('SETTLE', async () => {
        throw new Error('down');
      });

    await expect(fail()).rejects.toThrow('down');
    await expect(fail()).rejects.toThrow('down');

    expect(alerts).toHaveBeenCalledTimes(1);
    const rows = await runsFor('SETTLE');
    expect(rows.map((r) => r.alerted)).toEqual([false, true]);
  });

  it('sends one recovery notice on the first success after a failure', async () => {
    await expect(
      runJob('SETTLE', async () => {
        throw new Error('down');
      }),
    ).rejects.toThrow('down');
    alerts.mockClear();

    await runJob('SETTLE', async () => ({ gamesSettled: 1 }));

    expect(alerts).toHaveBeenCalledTimes(1);
    expect(alerts.mock.calls[0][0].kind).toBe('CRON_RECOVERED');
  });

  it('does not alert on a partial failure when the caller says it raises its own', async () => {
    await runJob('RECONCILE', async () => ({ drift: 2 }), {
      partialErrors: (r) => (r.drift > 0 ? [`${r.drift} discrepancies`] : []),
      partialAlertKind: null,
    });

    const [row] = await runsFor('RECONCILE');
    expect(row.ok).toBe(false);
    expect(alerts).not.toHaveBeenCalled();
  });

  it('keeps the job’s result when recording fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Stands in for the table not existing yet — the state of a deploy that lands ahead of
    // the migration. The job must still do its job.
    vi.spyOn(db, 'insert').mockImplementation(() => {
      throw new Error('relation "job_runs" does not exist');
    });

    await expect(runJob('ALLOWANCE', async () => ({ credited: 1 }))).resolves.toEqual({
      credited: 1,
    });
  });
});

describe('pruneJobRuns', () => {
  it('deletes rows past the window and keeps the rest', async () => {
    const old = new Date(Date.now() - 40 * 86_400_000);
    await db.insert(jobRuns).values([
      { job: 'SETTLE', startedAt: old, finishedAt: old, ok: true },
      { job: 'SETTLE', ok: true },
    ]);

    expect(await pruneJobRuns(30)).toBe(1);
    expect(await runsFor('SETTLE')).toHaveLength(1);
  });
});
