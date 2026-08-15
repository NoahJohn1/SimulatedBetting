/**
 * Shared gate for the cron routes.
 *
 * These endpoints move money, so the check fails closed: a missing or misconfigured secret
 * returns an error rather than being treated as "no auth required". Vercel Cron sends the
 * configured secret as a bearer token, which is why that is the only accepted form.
 */
export function authorizeCronRequest(request: Request): Response | null {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return Response.json({ error: 'CRON_SECRET is not configured' }, { status: 500 });
  }

  const header = request.headers.get('authorization');
  if (header !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  return null;
}

/**
 * Money is bigint everywhere, and `JSON.stringify` throws on bigint. Job summaries are
 * rendered with cents as decimal strings rather than numbers, so no amount can lose
 * precision on the way out.
 */
export function jsonSafe<T>(value: T): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, jsonSafe(v)]),
    );
  }
  return value;
}
