import { authorizeCronRequest, jsonSafe } from '@/server/cron/auth';
import { reconcileBalances, reconcileEscrow } from '@/server/money/reconcile';
import { raiseAlert } from '@/server/ops/alerts';
import { pruneJobRuns, runJob } from '@/server/ops/job-runs';

const abs = (n: bigint) => (n < 0n ? -n : n);

/**
 * Daily. Asserts every cached balance still equals the sum of its ledger entries, and that
 * every wager's pot holds exactly what its status says it should (D43).
 *
 * A discrepancy in either returns 500 on purpose: this is the alarm that says money drifted,
 * and it should be impossible to miss in the cron logs. Since 2026-09 it also shouts — the
 * status code was never going to be read by anyone at 08:00 on a Sunday.
 *
 * Drift alerts are not suppressed the way cron-failure alerts are (D60). This runs daily, and
 * one message a day about money that does not add up is the correct volume rather than noise.
 */
export async function GET(request: Request): Promise<Response> {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  const payload = await runJob(
    'RECONCILE',
    async () => {
      const discrepancies = await reconcileBalances();
      const escrowDiscrepancies = await reconcileEscrow();

      if (discrepancies.length > 0) {
        await raiseAlert({
          kind: 'BALANCE_DRIFT',
          message: `${discrepancies.length} cached balance(s) disagree with the ledger.`,
          context: {
            pairs: discrepancies.length,
            totalDriftCents: discrepancies
              .reduce((sum, d) => sum + abs(d.cachedCents - d.ledgerCents), 0n)
              .toString(),
          },
        });
      }

      if (escrowDiscrepancies.length > 0) {
        await raiseAlert({
          kind: 'ESCROW_DRIFT',
          message: `${escrowDiscrepancies.length} wager pot(s) hold the wrong amount.`,
          context: {
            wagers: escrowDiscrepancies.length,
            firstIds: escrowDiscrepancies
              .slice(0, 5)
              .map((d) => d.wagerId)
              .join(', '),
          },
        });
      }

      // Retention rides this job rather than earning a schedule of its own. Its own try/catch:
      // a failed prune is housekeeping and must not fail a reconciliation run.
      try {
        await pruneJobRuns();
      } catch (err) {
        console.error('[reconcile] pruning job_runs failed', err);
      }

      const ok = discrepancies.length === 0 && escrowDiscrepancies.length === 0;
      return { ok, discrepancies, escrowDiscrepancies };
    },
    {
      // Drift makes the run not clean, so the health page reports it — but the two alerts above
      // are more specific than CRON_ERRORS would be, so the wrapper stays quiet.
      partialErrors: (p) =>
        p.ok ? [] : [`${p.discrepancies.length} balance, ${p.escrowDiscrepancies.length} escrow`],
      partialAlertKind: null,
    },
  );

  return Response.json(jsonSafe(payload), { status: payload.ok ? 200 : 500 });
}
