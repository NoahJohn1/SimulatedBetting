import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { seasonMemberships, seasons, users } from '@/db/schema';

export interface OAuthProfile {
  provider: 'GOOGLE' | 'APPLE';
  providerAccountId: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
}

/**
 * Records an OAuth sign-in against our own `users` table.
 *
 * New accounts land PENDING and wait for an admin (D7). A repeat sign-in refreshes only the
 * profile fields the provider owns — never `status` or `role`, so signing in again can
 * neither undo an admin's approval nor quietly re-enable a disabled account.
 *
 * Identity is keyed on (provider, providerAccountId), not email: an email can change, and
 * the same address arriving via a different provider is a different account.
 */
export async function upsertOAuthUser(profile: OAuthProfile) {
  const [user] = await db
    .insert(users)
    .values({
      provider: profile.provider,
      providerAccountId: profile.providerAccountId,
      email: profile.email,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl ?? null,
    })
    .onConflictDoUpdate({
      target: [users.provider, users.providerAccountId],
      set: {
        email: profile.email,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl ?? null,
      },
    })
    .returning();

  return user;
}

export type AuthorizeDenial =
  | 'NO_SUCH_USER'
  | 'PENDING'
  | 'DISABLED'
  | 'NO_ACTIVE_SEASON'
  | 'NOT_A_MEMBER';

export type AuthorizeResult =
  | {
      ok: true;
      userId: string;
      membershipId: string;
      seasonId: string;
      balanceCents: bigint;
      role: 'USER' | 'ADMIN';
    }
  | { ok: false; reason: AuthorizeDenial };

/**
 * The server-side authorization check every screen and action runs.
 *
 * Returns a reason rather than throwing so each caller decides what that means — a page
 * redirects a PENDING user to the holding screen, an action returns 403. Authorization is
 * always checked here on the server, never by hiding UI.
 */
export async function authorizeMember(userId: string): Promise<AuthorizeResult> {
  const [user] = await db
    .select({ id: users.id, status: users.status, role: users.role })
    .from(users)
    .where(eq(users.id, userId));

  if (!user) return { ok: false, reason: 'NO_SUCH_USER' };
  if (user.status === 'PENDING') return { ok: false, reason: 'PENDING' };
  if (user.status === 'DISABLED') return { ok: false, reason: 'DISABLED' };

  const [season] = await db
    .select({ id: seasons.id })
    .from(seasons)
    .where(eq(seasons.status, 'ACTIVE'));

  if (!season) return { ok: false, reason: 'NO_ACTIVE_SEASON' };

  const [membership] = await db
    .select({ id: seasonMemberships.id, balanceCents: seasonMemberships.balanceCents })
    .from(seasonMemberships)
    .where(
      and(eq(seasonMemberships.userId, userId), eq(seasonMemberships.seasonId, season.id)),
    );

  if (!membership) return { ok: false, reason: 'NOT_A_MEMBER' };

  return {
    ok: true,
    userId: user.id,
    membershipId: membership.id,
    seasonId: season.id,
    balanceCents: membership.balanceCents,
    role: user.role,
  };
}
