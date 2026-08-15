import { authorizeCronRequest, jsonSafe } from '@/server/cron/auth';
import { reconcileBalances } from '@/server/money/reconcile';

/**
 * Daily. Asserts every cached balance still equals the sum of its ledger entries.
 *
 * A discrepancy returns 500 on purpose: this is the alarm that says money drifted, and it
 * should be impossible to miss in the cron logs.
 */
export async function GET(request: Request): Promise<Response> {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  const discrepancies = await reconcileBalances();

  return Response.json(
    jsonSafe({ ok: discrepancies.length === 0, discrepancies }),
    { status: discrepancies.length === 0 ? 200 : 500 },
  );
}
