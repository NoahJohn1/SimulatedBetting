import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Callout } from '@/components/ui/callout';
import { Card } from '@/components/ui/card';
import { Money } from '@/components/ui/money';
import { requireAdmin } from '@/server/auth/session';
import { formatAge, readHealth, type Freshness, type JobHealth } from '@/server/ops/health';

export const metadata: Metadata = { title: 'Health' };

const JOB_LABELS: Record<JobHealth['job'], string> = {
  SYNC_ODDS: 'Odds sync',
  SETTLE: 'Settlement',
  ALLOWANCE: 'Weekly allowance',
  RECONCILE: 'Reconciliation',
};

const FRESHNESS: Record<Freshness, { tone: BadgeTone; label: string }> = {
  fresh: { tone: 'positive', label: 'Running' },
  stale: { tone: 'negative', label: 'Overdue' },
  'never-run': { tone: 'caution', label: 'Never run' },
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className="text-sm font-medium">{children}</span>
    </span>
  );
}

/**
 * One screen that answers "is it working." Read-only, deliberately: a re-run control is a money
 * operation one click from a status page opened by someone already anxious, and what it adds
 * over waiting for tomorrow's 08:00 run is small.
 */
export default async function HealthPage() {
  await requireAdmin();

  const health = await readHealth();
  const now = health.readAt;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Health</h1>
        <Link href="/admin" className="text-sm text-ink-muted underline">
          Back to admin
        </Link>
      </div>

      {health.runRecordUnavailable ? (
        <Callout tone="caution">
          The <code>job_runs</code> table could not be read, so no job below can report a run. Apply
          the outstanding migration.
        </Callout>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Scheduled jobs
        </h2>

        {health.jobs.map((job) => (
          <Card key={job.job} className="flex flex-col gap-2 p-3">
            <span className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">{JOB_LABELS[job.job]}</span>
              <Badge tone={FRESHNESS[job.freshness].tone}>{FRESHNESS[job.freshness].label}</Badge>
            </span>

            <Row label="Last clean run">
              {job.lastSuccessAt ? formatAge(now.getTime() - job.lastSuccessAt.getTime()) : 'never'}
            </Row>

            {/* Compared by value: two Date objects for the same instant are never `!==`-equal. */}
            {!job.derived &&
            job.lastRunAt &&
            job.lastRunAt.getTime() !== job.lastSuccessAt?.getTime() ? (
              <Row label="Last attempt">{formatAge(now.getTime() - job.lastRunAt.getTime())}</Row>
            ) : null}

            {job.lastError ? (
              <p className="break-words text-xs text-negative">{job.lastError}</p>
            ) : null}

            {job.derived ? (
              <p className="text-xs text-ink-muted">
                Derived from the newest market timestamp rather than a run record — it says the sync
                wrote rows, not that it returned 200.
              </p>
            ) : null}
          </Card>
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Reconciliation
        </h2>

        <Card className="flex flex-col gap-2 p-3">
          {health.reconcile.observedAt ? (
            <>
              <Row label="Balances disagreeing with the ledger">
                {health.reconcile.balanceDiscrepancies ?? 0}
              </Row>
              <Row label="Wager pots holding the wrong amount">
                {health.reconcile.escrowDiscrepancies ?? 0}
              </Row>
              <p className="text-xs text-ink-muted">
                As of {formatAge(now.getTime() - health.reconcile.observedAt.getTime())}, from the
                last reconcile run. Not recomputed on this page.
              </p>
            </>
          ) : (
            <p className="text-sm text-ink-muted">Reconciliation has not run yet.</p>
          )}
        </Card>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Markets and escrow
        </h2>

        <Card className="flex flex-col gap-2 p-3">
          <Row label="Markets suspended for stale data">{health.suspendedMarkets}</Row>
          <Row label="Credits locked in wager pots">
            <Money cents={health.escrowHeldCents} currency="CREDITS" />
          </Row>
        </Card>
      </section>
    </div>
  );
}
