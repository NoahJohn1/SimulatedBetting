import { createHmac, timingSafeEqual } from 'node:crypto';
import { notificationType, type NotificationType } from '@/db/schema';

export type UnsubscribeScope = 'all' | NotificationType;

const SCOPES = new Set<string>(['all', ...notificationType.enumValues]);

/**
 * Derived, never stored (D67). No column, no lookup, no expiry — `AUTH_SECRET` already exists
 * and the token is a function of the user and the scope.
 *
 * The `v1:` prefix means the scheme can be changed later without silently honouring tokens
 * minted under the old one.
 */
function sign(secret: string, userId: string, scope: string): string {
  return createHmac('sha256', secret).update(`unsub:v1:${userId}:${scope}`).digest('base64url');
}

export function signUnsubscribe(userId: string, scope: UnsubscribeScope): string {
  const secret = process.env.AUTH_SECRET;
  // Signing without a secret would mint tokens that verify against nothing. Fail here rather
  // than shipping dead links into somebody's inbox.
  if (!secret) throw new Error('AUTH_SECRET is not set, so unsubscribe links cannot be signed');
  return sign(secret, userId, scope);
}

/** Returns the validated scope, or null. Never throws — this runs on a public route. */
export function verifyUnsubscribe(
  userId: string,
  scope: string,
  token: string,
): UnsubscribeScope | null {
  const secret = process.env.AUTH_SECRET;
  // No secret means no token can be trusted. Fail closed, as `authorizeCronRequest` does.
  if (!secret) return null;
  if (!SCOPES.has(scope)) return null;

  const expected = Buffer.from(sign(secret, userId, scope));
  const given = Buffer.from(token);
  // timingSafeEqual throws on a length mismatch, so lengths are compared first.
  if (expected.length !== given.length) return null;
  if (!timingSafeEqual(expected, given)) return null;

  return scope as UnsubscribeScope;
}

export function unsubscribeUrl(
  baseUrl: string,
  userId: string,
  scope: UnsubscribeScope,
  path = '/unsubscribe',
): string {
  const url = new URL(path, baseUrl);
  url.searchParams.set('u', userId);
  url.searchParams.set('s', scope);
  url.searchParams.set('t', signUnsubscribe(userId, scope));
  return url.toString();
}
