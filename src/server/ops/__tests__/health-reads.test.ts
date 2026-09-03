import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { events, jobRuns, markets } from '@/db/schema';
import { readHealth } from '@/server/ops/health';
import { resetDb } from '@/test/db';

/**
 * A sports market with no dependency on a `games` row: `markets.eventId` is a plain FK to
 * `events.id`, and neither "suspended markets" nor "newest market timestamp" reads through
 * `games` at all. Mirrors `seedCustomEvent` in custom-events-schema.test.ts, but with
 * `kind: 'GAME'` and a `MONEYLINE` market instead of a custom event.
 */
async function seedMarket() {
  const [event] = await db
    .insert(events)
    .values({
      kind: 'GAME',
      title: 'Falcons @ Ravens',
      startsAt: new Date(Date.now() + 86_400_000),
    })
    .returning();

  const [market] = await db
    .insert(markets)
    .values({ eventId: event.id, type: 'MONEYLINE', sourceBook: 'draftkings' })
    .returning();

  return { event, market };
}

beforeEach(async () => {
  await resetDb();
});

describe('readHealth', () => {
  it('reports every job as never-run on an empty database', async () => {
    const snapshot = await readHealth(new Date('2026-09-02T12:00:00Z'));

    expect(snapshot.jobs.map((j) => j.job)).toEqual([
      'SYNC_ODDS',
      'SETTLE',
      'ALLOWANCE',
      'RECONCILE',
    ]);
    expect(snapshot.jobs.every((j) => j.freshness === 'never-run')).toBe(true);
    expect(snapshot.reconcile.observedAt).toBeNull();
    expect(snapshot.suspendedMarkets).toBe(0);
    expect(snapshot.escrowHeldCents).toBe(0n);
    expect(snapshot.runRecordUnavailable).toBe(false);
  });

  it('reads the last successful run separately from the last run', async () => {
    const now = new Date('2026-09-02T12:00:00Z');
    const at = (min: number) => new Date(now.getTime() - min * 60_000);

    await db.insert(jobRuns).values([
      { job: 'SETTLE', startedAt: at(20), finishedAt: at(20), ok: true },
      { job: 'SETTLE', startedAt: at(5), finishedAt: at(5), ok: false, error: 'Error: down' },
    ]);

    const settle = (await readHealth(now)).jobs.find((j) => j.job === 'SETTLE')!;

    expect(settle.lastRunAt).toEqual(at(5));
    expect(settle.lastSuccessAt).toEqual(at(20));
    expect(settle.lastError).toBe('Error: down');
    expect(settle.freshness).toBe('fresh');
  });

  it('reads reconcile drift out of the last run’s summary', async () => {
    const observedAt = new Date('2026-09-02T08:00:00Z');
    await db.insert(jobRuns).values({
      job: 'RECONCILE',
      startedAt: observedAt,
      finishedAt: observedAt,
      ok: false,
      summary: {
        ok: false,
        discrepancies: [{ membershipId: 'a' }, { membershipId: 'b' }],
        escrowDiscrepancies: [{ wagerId: 'w' }],
      },
    });

    const { reconcile } = await readHealth(new Date('2026-09-02T12:00:00Z'));

    expect(reconcile.observedAt).toEqual(observedAt);
    expect(reconcile.balanceDiscrepancies).toBe(2);
    expect(reconcile.escrowDiscrepancies).toBe(1);
  });

  it('derives sync-odds freshness from the newest market timestamp', async () => {
    const now = new Date('2026-09-02T12:00:00Z');
    const { market } = await seedMarket();
    await db
      .update(markets)
      .set({ lastSyncedAt: new Date(now.getTime() - 10 * 60_000) })
      .where(eq(markets.id, market.id));

    const sync = (await readHealth(now)).jobs.find((j) => j.job === 'SYNC_ODDS')!;

    expect(sync.derived).toBe(true);
    expect(sync.freshness).toBe('fresh');
  });

  it('counts suspended markets', async () => {
    const { market } = await seedMarket();
    await db.update(markets).set({ status: 'SUSPENDED' }).where(eq(markets.id, market.id));

    expect((await readHealth()).suspendedMarkets).toBeGreaterThan(0);
  });
});
