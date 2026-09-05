/**
 * The one error shape every rate-limited action can return.
 *
 * Deliberately not a member of any domain error union — `PlaceBetError`, `OfferWagerError` and
 * the rest are untouched by rate limiting (D69). Actions widen their own return type with this
 * instead, which is what keeps `src/server/bets`, `src/server/p2p` and `src/server/money` free
 * of any diff from this work.
 */
export interface RateLimited {
  code: 'RATE_LIMITED';
  /** Whole seconds until the current window ends. Never zero. */
  retryAfterSeconds: number;
}

export function isRateLimited(value: unknown): value is RateLimited {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { code?: unknown }).code === 'RATE_LIMITED'
  );
}
