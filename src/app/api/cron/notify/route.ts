import { authorizeCronRequest, jsonSafe } from '@/server/cron/auth';
import { deliverPending } from '@/server/notify/deliver';
import { runJob } from '@/server/ops/job-runs';

/**
 * Daily at 13:00 UTC — 9am Eastern, so Sunday's settlements arrive Monday morning rather than at
 * 4am (D66).
 *
 * It flushes the digest and sweeps whatever the in-request `after()` flush dropped: a process
 * that died, or an enqueue that came from a cron rather than a request. Both channels, because
 * an unsent immediate is exactly what this pass exists to catch.
 *
 * Daily-or-less, so it is legal on Vercel Hobby and needs no GitHub Actions job and no new
 * secret — unlike settle, whose Actions schedule is currently disabled.
 *
 * A send failure is a partial error, so `runJob` alerts through D60's transition rule: a rotated
 * API key shouts rather than being discovered by a member who stopped getting mail.
 */
export async function GET(request: Request): Promise<Response> {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  const payload = await runJob('NOTIFY', () => deliverPending(), {
    partialErrors: (p) => p.errors,
  });

  return Response.json(jsonSafe(payload), { status: payload.failed > 0 ? 207 : 200 });
}
