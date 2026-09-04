import { boolean, index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const jobName = pgEnum('job_name', ['SETTLE', 'ALLOWANCE', 'RECONCILE']);

export type JobName = (typeof jobName.enumValues)[number];

/**
 * One row per scheduled-job invocation, written by `runJob` (D58).
 *
 * It exists because `reconcile` leaves no other trace: a passing run writes no ledger entry,
 * changes no status and touches no timestamp, so its silence is indistinguishable from its
 * absence. `sync-odds` is deliberately not in the `job_name` enum — its health is read from
 * `max(markets.last_synced_at)`, which proves the sync wrote rows rather than that a handler
 * returned 200.
 *
 * `ok` means the run was CLEAN: it completed without throwing *and* reported no per-item
 * failures. A settle pass that could not grade one game is not a successful settle pass.
 *
 * `error` is `"Name: message"` and never a stack — this table is read by a web page, and the
 * stack belongs in Sentry.
 */
export const jobRuns = pgTable(
  'job_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    job: jobName('job').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    ok: boolean('ok').notNull().default(false),
    /** The object the route already returns, through `jsonSafe` so bigint cents survive. */
    summary: jsonb('summary'),
    error: text('error'),
    /** Whether this run raised an alert. The suppression rule in `alert-policy.ts` reads it. */
    alerted: boolean('alerted').notNull().default(false),
  },
  (t) => [index('job_runs_job_started_idx').on(t.job, t.startedAt.desc())],
);
