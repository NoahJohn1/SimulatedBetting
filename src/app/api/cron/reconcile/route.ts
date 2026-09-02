import { authorizeCronRequest, jsonSafe } from '@/server/cron/auth';
import { reconcileBalances, reconcileEscrow } from '@/server/money/reconcile';

/**
 * Daily. Asserts every cached balance still equals the sum of its ledger entries, and that
 * every wager's pot holds exactly what its status says it should (D43).
 *
 * A discrepancy in either returns 500 on purpose: this is the alarm that says money drifted,
 * and it should be impossible to miss in the cron logs.
 */
export async function GET(request: Request): Promise<Response> {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  const discrepancies = await reconcileBalances();
  const escrowDiscrepancies = await reconcileEscrow();

  const ok = discrepancies.length === 0 && escrowDiscrepancies.length === 0;

  return Response.json(jsonSafe({ ok, discrepancies, escrowDiscrepancies }), {
    status: ok ? 200 : 500,
  });
}
