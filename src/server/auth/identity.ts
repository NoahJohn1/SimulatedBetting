import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { seasonMemberships, seasons, users } from '@/db/schema';

export interface OAuthProfile {
  provider: 'GOOGLE';
  providerAccountId: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
}

/**
 * Seeded admins, from `ADMIN_EMAILS` (comma-separated).
 *
 * These accounts arrive APPROVED with the ADMIN role instead of waiting in the D7 queue,
 * which is what solves the bootstrap problem: the first admin has nobody to approve them.
 * It is an explicit allowlist of known people rather than a blanket rule, so it stays
 * correct in production too.
 *
 * Read per call rather than cached at module load so a changed env var takes effect on the
 * next sign-in without a rebuild.
 */
function isSeededAdmin(email: string): boolean {
  const configured = process.env.ADMIN_EMAILS;
  if (!configured || !email) return false;

  return configured
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.trim().toLowerCase());
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
  // Only seeded admins carry an elevation; for everyone else role and status are left
  // untouched on a repeat sign-in, so signing in cannot undo an admin's decision.
  const elevation = isSeededAdmin(profile.email)
    ? { role: 'ADMIN' as const, status: 'APPROVED' as const }
    : {};

  const [user] = await db
    .insert(users)
    .values({
      provider: profile.provider,
      providerAccountId: profile.providerAccountId,
      email: profile.email,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl ?? null,
      ...elevation,
    })
    .onConflictDoUpdate({
      target: [users.provider, users.providerAccountId],
      set: {
        email: profile.email,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl ?? null,
        ...elevation,
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
