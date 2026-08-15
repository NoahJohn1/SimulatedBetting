import { redirect } from 'next/navigation';
import { auth } from './config';
import { authorizeMember, type AuthorizeResult } from './identity';

export interface SessionUser {
  id: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    image: session.user.image,
  };
}

/** The raw check, without redirecting — for server actions and route handlers. */
export async function currentMember(): Promise<AuthorizeResult | null> {
  const user = await getSessionUser();
  if (!user) return null;
  return authorizeMember(user.id);
}

export type ApprovedMember = Extract<AuthorizeResult, { ok: true }>;

/**
 * Called at the top of every members-only screen.
 *
 * Redirects rather than returning a denial, because a page has nothing useful to render for
 * a signed-out or unapproved visitor. Server actions use `requireApprovedMemberOrThrow`,
 * which throws instead — a redirect mid-action would be swallowed.
 */
export async function requireApprovedMember(): Promise<ApprovedMember> {
  const result = await currentMember();

  if (!result) redirect('/sign-in');
  if (result.ok) return result;

  switch (result.reason) {
    case 'PENDING':
      redirect('/pending');
    case 'DISABLED':
      redirect('/disabled');
    case 'NO_ACTIVE_SEASON':
      redirect('/no-season');
    case 'NOT_A_MEMBER':
      redirect('/join');
    default:
      redirect('/sign-in');
  }
}

export class NotAuthorizedError extends Error {
  constructor(readonly reason: string) {
    super(`not authorized: ${reason}`);
    this.name = 'NotAuthorizedError';
  }
}

/** Authorization for server actions: throws 403-shaped errors instead of redirecting. */
export async function requireApprovedMemberOrThrow(): Promise<ApprovedMember> {
  const result = await currentMember();
  if (!result) throw new NotAuthorizedError('SIGNED_OUT');
  if (!result.ok) throw new NotAuthorizedError(result.reason);
  return result;
}

/** Admin routes are gated server-side, never by hiding UI. */
export async function requireAdmin(): Promise<ApprovedMember> {
  const member = await requireApprovedMember();
  if (member.role !== 'ADMIN') redirect('/');
  return member;
}
