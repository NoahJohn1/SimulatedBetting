import { and, desc, eq, isNotNull, lt } from 'drizzle-orm';
import { db } from '@/db/client';
import { jobRuns, type JobName } from '@/db/schema';
import { jsonSafe } from '@/server/cron/auth';
import { shouldAlert } from './alert-policy';
import { raiseAlert, type Alert, type AlertKind } from './alerts';

export interface RunJobOptions<T> {
  /**
   * Per-item failures the job reports without throwing — settle's 207 case. A run that
   * reports any is recorded as not clean.
   */
  partialErrors?: (result: T) => string[];
  /**
   * What kind of alert a partial failure raises. `null` means the job raises its own more
   * specific alert and this wrapper should stay quiet — reconcile does that.
   */
  partialAlertKind?: AlertKind | null;
}

/**
 * Time a scheduled job, record what it did, and decide whether to shout (D58, D60).
 *
 * It observes; it does not handle. A throw is recorded, alerted and re-thrown unchanged, so the
 * route still returns whatever it returned before. Recording failure is never job failure —
 * every write here is wrapped, because a settle run that moved money correctly must not be
 * reported as a 500 because a bookkeeping row would not insert. That is also what makes this
 * safe to deploy before the migration is applied.
 *
 * Always called around a job, never inside one: job_runs is not money and must never be able to
 * roll a money transaction back.
 */
export async function runJob<T>(
  job: JobName,
  fn: () => Promise<T>,
  options: RunJobOptions<T> = {},
): Promise<T> {
  const runId = await openRun(job);

  try {
    const result = await fn();
    const errors = options.partialErrors?.(result) ?? [];
    const clean = errors.length === 0;

    await closeRun(job, runId, {
      ok: clean,
      summary: jsonSafe(result),
      error: clean ? null : summarizeErrors(errors),
      alert: clean
        ? recoveryAlert(job)
        : options.partialAlertKind === null
          ? null
          : {
              kind: options.partialAlertKind ?? 'CRON_ERRORS',
              message: `${job} completed with ${errors.length} item failure(s).`,
              context: { failures: errors.length, first: errors.slice(0, 3).join(' | ') },
            },
    });

    return result;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));

    await closeRun(job, runId, {
      ok: false,
      summary: null,
      error: `${error.name}: ${error.message}`,
      alert: {
        kind: 'CRON_FAILED',
        message: `${job} threw and did not complete.`,
        context: { error: `${error.name}: ${error.message}` },
      },
    });

    throw err;
  }
}

/** The recovery notice is only sent when the previous run failed; `decide` enforces that. */
function recoveryAlert(job: JobName): Alert {
  return { kind: 'CRON_RECOVERED', message: `${job} completed cleanly again.` };
}

function summarizeErrors(errors: string[]): string {
  const head = errors.slice(0, 3).join(' | ');
  return errors.length > 3
    ? `${errors.length} item failures: ${head} (+${errors.length - 3} more)`
    : `${errors.length} item failure(s): ${head}`;
}

async function openRun(job: JobName): Promise<string | null> {
  try {
    const [row] = await db.insert(jobRuns).values({ job }).returning({ id: jobRuns.id });
    return row.id;
  } catch (err) {
    console.error(`[job-runs] could not open a run row for ${job}`, err);
    return null;
  }
}

interface Outcome {
  ok: boolean;
  summary: unknown;
  error: string | null;
  alert: Alert | null;
}

async function closeRun(job: JobName, runId: string | null, outcome: Outcome): Promise<void> {
  const alert = await decideAlert(job, outcome);

  try {
    if (runId) {
      await db
        .update(jobRuns)
        .set({
          finishedAt: new Date(),
          ok: outcome.ok,
          summary: outcome.summary,
          error: outcome.error,
          alerted: alert !== null,
        })
        .where(eq(jobRuns.id, runId));
    }
  } catch (err) {
    console.error(`[job-runs] could not record the ${job} run`, err);
  }

  // Outside the try above on purpose: a failed bookkeeping write must not swallow the alarm.
  if (alert) await raiseAlert(alert);
}

async function decideAlert(job: JobName, outcome: Outcome): Promise<Alert | null> {
  if (!outcome.alert) return null;

  try {
    const [previous] = await db
      .select({ ok: jobRuns.ok })
      .from(jobRuns)
      .where(and(eq(jobRuns.job, job), isNotNull(jobRuns.finishedAt)))
      .orderBy(desc(jobRuns.startedAt))
      .limit(1);

    const [alerted] = await db
      .select({ startedAt: jobRuns.startedAt })
      .from(jobRuns)
      .where(and(eq(jobRuns.job, job), eq(jobRuns.alerted, true)))
      .orderBy(desc(jobRuns.startedAt))
      .limit(1);

    return shouldAlert({
      previousOk: previous?.ok ?? null,
      lastAlertedAt: alerted?.startedAt ?? null,
      ok: outcome.ok,
      now: new Date(),
    })
      ? outcome.alert
      : null;
  } catch (err) {
    // The history is unreadable — the table may not exist yet. Fail loud rather than silent:
    // a missed alert about money is worse than a duplicate one. Never send a recovery notice
    // on this path, since "recovered" is a claim about a history we just failed to read.
    console.error(`[job-runs] could not read alert history for ${job}`, err);
    return outcome.ok ? null : outcome.alert;
  }
}

/**
 * Retention. Rides the daily reconcile run rather than earning a schedule of its own, the same
 * way the overdue-event sweep rides settle (D37). At 144 settle runs a day, 30 days is roughly
 * 4,400 rows.
 */
export async function pruneJobRuns(olderThanDays = 30): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
  const deleted = await db
    .delete(jobRuns)
    .where(lt(jobRuns.startedAt, cutoff))
    .returning({ id: jobRuns.id });
  return deleted.length;
}
