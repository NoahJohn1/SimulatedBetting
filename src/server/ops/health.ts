import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { jobRuns, type JobName } from '@/db/schema';
import { activeTransport } from '@/server/notify/transport';

export type Freshness = 'fresh' | 'stale' | 'never-run';

/** The three recorded jobs, plus sync-odds, whose health is derived rather than recorded (D58). */
export type HealthJob = JobName | 'SYNC_ODDS';

/**
 * Roughly three times each job's own interval, so one missed fire is not an alarm and two are.
 */
export const STALE_AFTER_MS: Record<HealthJob, number> = {
  SYNC_ODDS: 45 * 60_000, // every 15 min
  SETTLE: 30 * 60_000, // every 10 min
  RECONCILE: 26 * 60 * 60_000, // daily at 08:00
  ALLOWANCE: 8 * 24 * 60 * 60_000, // weekly, Tuesday
  // The `/api/cron/notify` route (daily at 13:00 UTC) now writes job_runs rows under this job
  // name, but NOTIFY is deliberately not in RECORDED_JOBS below — this screen already reports
  // whether mail is being sent at all via `emailTransport`, and a per-run staleness card for a
  // once-a-day digest sweep was judged not worth the extra card. This entry stays so the
  // `Record<HealthJob, ...>` below stays exhaustive if that judgement changes.
  NOTIFY: 26 * 60 * 60_000, // daily at 13:00, same grace as RECONCILE's daily 08:00
};

/**
 * Pure on purpose. It is the one part of this screen a cloud session can prove, and pushing the
 * judgement out of the query and into a function is what makes that possible.
 */
export function cronStaleness(job: HealthJob, lastSuccessAt: Date | null, now: Date): Freshness {
  if (lastSuccessAt === null) return 'never-run';
  return now.getTime() - lastSuccessAt.getTime() > STALE_AFTER_MS[job] ? 'stale' : 'fresh';
}

/** Coarse by design: the question this screen answers is "recently?", never "exactly when?". */
export function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

export interface JobHealth {
  job: HealthJob;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  freshness: Freshness;
  /** True for sync-odds, whose reading comes from market freshness rather than a run record. */
  derived: boolean;
}

export interface ReconcileHealth {
  observedAt: Date | null;
  balanceDiscrepancies: number | null;
  escrowDiscrepancies: number | null;
}

export interface HealthSnapshot {
  jobs: JobHealth[];
  reconcile: ReconcileHealth;
  suspendedMarkets: number;
  escrowHeldCents: bigint;
  readAt: Date;
  /** True when job_runs could not be read at all — the migration has not been applied yet. */
  runRecordUnavailable: boolean;
  /** 'console' means RESEND_API_KEY is unset and nothing is actually being sent (D68). */
  emailTransport: 'resend' | 'console';
}

const RECORDED_JOBS: JobName[] = ['SETTLE', 'ALLOWANCE', 'RECONCILE'];

type RunRow = {
  job: JobName;
  last_run_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
};

/**
 * One snapshot for /admin/health.
 *
 * Reconciliation drift is read from the last recorded run rather than recomputed: recomputing
 * means two cross-join queries over every membership and every wager on each page load, and the
 * page is refreshed by whoever is worried. Reading the record also lets the screen state its
 * observation time honestly instead of implying a number is live.
 */
export async function readHealth(now: Date = new Date()): Promise<HealthSnapshot> {
  const [runs, reconcile] = await Promise.all([readRunRows(), readLastReconcile()]);

  const jobs: JobHealth[] = RECORDED_JOBS.map((job) => {
    const row = runs?.find((r) => r.job === job);
    const lastSuccessAt = row?.last_success_at ? new Date(row.last_success_at) : null;
    return {
      job,
      lastRunAt: row?.last_run_at ? new Date(row.last_run_at) : null,
      lastSuccessAt,
      lastError: row?.last_error ?? null,
      freshness: cronStaleness(job, lastSuccessAt, now),
      derived: false,
    };
  });

  const syncedAt = await readLastMarketSync();
  jobs.unshift({
    job: 'SYNC_ODDS',
    lastRunAt: syncedAt,
    lastSuccessAt: syncedAt,
    lastError: null,
    freshness: cronStaleness('SYNC_ODDS', syncedAt, now),
    derived: true,
  });

  return {
    jobs,
    reconcile,
    suspendedMarkets: await countSuspendedMarkets(),
    escrowHeldCents: await readEscrowHeld(),
    readAt: now,
    runRecordUnavailable: runs === null,
    emailTransport: activeTransport(),
  };
}

/** Returns null rather than throwing when job_runs does not exist — see the spec's §9. */
async function readRunRows(): Promise<RunRow[] | null> {
  try {
    const rows = await db.execute<RunRow>(sql`
      SELECT job,
             MAX(started_at) AS last_run_at,
             MAX(started_at) FILTER (WHERE ok) AS last_success_at,
             (ARRAY_AGG(error ORDER BY started_at DESC))[1] AS last_error
      FROM job_runs
      WHERE finished_at IS NOT NULL
      GROUP BY job
    `);
    return Array.from(rows);
  } catch (err) {
    console.error('[health] job_runs is unreadable; reporting every job as never-run', err);
    return null;
  }
}

async function readLastReconcile(): Promise<ReconcileHealth> {
  const empty: ReconcileHealth = {
    observedAt: null,
    balanceDiscrepancies: null,
    escrowDiscrepancies: null,
  };

  try {
    const [row] = await db
      .select({ finishedAt: jobRuns.finishedAt, summary: jobRuns.summary })
      .from(jobRuns)
      .where(and(eq(jobRuns.job, 'RECONCILE'), isNotNull(jobRuns.finishedAt)))
      .orderBy(desc(jobRuns.startedAt))
      .limit(1);

    if (!row?.summary) return empty;

    const summary = row.summary as {
      discrepancies?: unknown[];
      escrowDiscrepancies?: unknown[];
    };

    return {
      observedAt: row.finishedAt,
      balanceDiscrepancies: summary.discrepancies?.length ?? null,
      escrowDiscrepancies: summary.escrowDiscrepancies?.length ?? null,
    };
  } catch (err) {
    console.error('[health] could not read the last reconcile run', err);
    return empty;
  }
}

/**
 * sync-odds is not instrumented (D58). The freshest market timestamp is the better evidence
 * anyway: it says the sync wrote rows, not that a handler returned 200.
 */
async function readLastMarketSync(): Promise<Date | null> {
  const rows = await db.execute<{ last_synced_at: string | null }>(
    sql`SELECT MAX(last_synced_at) AS last_synced_at FROM markets WHERE source_book IS NOT NULL`,
  );
  const value = Array.from(rows)[0]?.last_synced_at;
  return value ? new Date(value) : null;
}

async function countSuspendedMarkets(): Promise<number> {
  const rows = await db.execute<{ count: number }>(
    sql`SELECT COUNT(*)::int AS count FROM markets WHERE status = 'SUSPENDED'`,
  );
  return Array.from(rows)[0]?.count ?? 0;
}

/**
 * From the ledger, not from the wagers' stake columns. The stakes say what should be held; the
 * ledger says what is. reconcileEscrow already exists to compare the two (D43), so this shows
 * the real number and lets the reconciler own the comparison.
 */
async function readEscrowHeld(): Promise<bigint> {
  const rows = await db.execute<{ held: string }>(
    sql`SELECT COALESCE(-SUM(amount_cents), 0) AS held
        FROM ledger_entries
        WHERE p2p_wager_id IS NOT NULL`,
  );
  return BigInt(Array.from(rows)[0]?.held ?? '0');
}
