'use server';

import { getSessionUser } from '@/server/auth/session';
import { consume } from '@/server/limits/consume';
import { joinSeason } from '@/server/seasons/service';

export type JoinActionResult =
  | { ok: true }
  | { ok: false; error: 'NO_SEASON' | 'FAILED' | 'RATE_LIMITED'; retryAfterSeconds?: number };

/**
 * `/join`'s submit was an inline server action with no try/catch and no pending state. The
 * money side was never at risk — `joinSeason` is idempotent, reusing an existing membership and
 * posting on the deterministic key `grant:<membershipId>` — but a season that ended between
 * render and submit threw into `app/error.tsx` with no way back. This is that path, typed.
 *
 * `requireApprovedMemberOrThrow` is deliberately NOT used: the whole point of this screen is a
 * member who is approved but has not joined, which that helper rejects.
 */
export async function joinSeasonAction(seasonId: string): Promise<JoinActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'FAILED' };

  const limited = await consume(user.id, 'DEFAULT');
  if (limited) {
    return { ok: false, error: 'RATE_LIMITED', retryAfterSeconds: limited.retryAfterSeconds };
  }

  try {
    await joinSeason(user.id, seasonId);
    return { ok: true };
  } catch {
    // joinSeason throws only when the season has gone — which is exactly the race this exists
    // to catch, and reads to the member as "that season is no longer running".
    return { ok: false, error: 'NO_SEASON' };
  }
}
