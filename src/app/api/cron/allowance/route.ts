import { authorizeCronRequest, jsonSafe } from '@/server/cron/auth';
import { payWeeklyAllowance } from '@/server/seasons/allowance';

/** Weekly. The idempotency key is the ISO week, so a double run is harmless. */
export async function GET(request: Request): Promise<Response> {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  return Response.json(jsonSafe(await payWeeklyAllowance()));
}
