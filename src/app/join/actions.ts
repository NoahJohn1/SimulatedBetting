'use server';

import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { seasons } from '@/db/schema';
import { authorizeMember } from '@/server/auth/identity';
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
 * member who is approved but has not joined, which that helper rejects. But an exported action
 * is callable directly by anyone signed in, not only by a caller who reached it through `/join`'s
 * own redirects — so this checks `authorizeMember` itself and proceeds only on `NOT_A_MEMBER`
 * (approved, an active season exists, no membership yet) or `ok: true` (already a member, a
 * harmless no-op given `joinSeason`'s idempotency). A `PENDING` or `DISABLED` account is refused
 * before anything is written — an admin who has not approved an account, or has disabled one,
 * should not have that account's own client be able to grant itself a season membership and a
 * starting bankroll regardless.
 *
 * Deliberately takes no `seasonId` argument. The inline action this replaced closed over a
 * server-computed `season.id`, which a client could never tamper with; an exported action's
 * arguments are ordinary client-suppliable values, so accepting a caller-passed season id here
 * would let anyone who still knows an old season's id (a returning member with a bookmarked
 * link, say) join and grant themselves that season's starting bankroll long after it ended. The
 * active season is always looked up fresh, exactly as `authorizeMember` does, so there is no id
 * for a caller to tamper with in the first place.
 */
export async function joinSeasonAction(): Promise<JoinActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'FAILED' };

  const authorization = await authorizeMember(user.id);
  if (authorization.ok) return { ok: true };
  if (authorization.reason === 'NO_ACTIVE_SEASON') return { ok: false, error: 'NO_SEASON' };
  if (authorization.reason !== 'NOT_A_MEMBER') return { ok: false, error: 'FAILED' };

  const limited = await consume(user.id, 'DEFAULT');
  if (limited) {
    return { ok: false, error: 'RATE_LIMITED', retryAfterSeconds: limited.retryAfterSeconds };
  }

  const [season] = await db.select().from(seasons).where(eq(seasons.status, 'ACTIVE'));
  if (!season) return { ok: false, error: 'NO_SEASON' };

  try {
    await joinSeason(user.id, season.id);
    return { ok: true };
  } catch {
    // joinSeason throws only when the season has gone — which is exactly the race this exists
    // to catch, and reads to the member as "that season is no longer running".
    return { ok: false, error: 'NO_SEASON' };
  }
}
