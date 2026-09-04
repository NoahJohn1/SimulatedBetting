import { disableAllEmail, muteType } from '@/server/notify/preferences';
import { verifyUnsubscribe } from '@/server/notify/unsubscribe';

/**
 * The only thing that writes an unsubscribe, and it is POST-only on purpose (D67).
 *
 * Outlook Safe Links, corporate mail filters and link scanners issue a GET against every URL in
 * a message. A mutating GET means members get silently unsubscribed by their own employer's
 * spam filter, and the symptom is "email stopped working" with nothing anywhere to explain it.
 *
 * This is also the RFC 8058 target: `List-Unsubscribe-Post: List-Unsubscribe=One-Click` makes
 * Gmail and Apple Mail POST here from their own native control, which is what "one click
 * without signing in" actually means.
 *
 * Public by construction — it calls no session helper. The signed token is the authorization.
 */
export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const userId = url.searchParams.get('u') ?? '';
  const scope = url.searchParams.get('s') ?? '';
  const token = url.searchParams.get('t') ?? '';

  const verified = verifyUnsubscribe(userId, scope, token);
  // Deliberately says nothing about whether the user exists.
  if (!verified) return Response.json({ error: 'invalid link' }, { status: 400 });

  if (verified === 'all') await disableAllEmail(userId);
  else await muteType(userId, verified);

  return Response.json({ ok: true, scope: verified });
}
