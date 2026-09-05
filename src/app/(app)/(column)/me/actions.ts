'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { requireApprovedMemberOrThrow } from '@/server/auth/session';
import { consume } from '@/server/limits/consume';

export type Theme = 'system' | 'light' | 'dark';

const THEME_COOKIE = 'theme';
// 365 days. `httpOnly` is left at its default (false) — nothing client-side reads this back,
// but nothing needs to keep it from doing so either; it carries no secret.
const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export type SaveThemeResult =
  { saved: true } | { error: 'RATE_LIMITED'; retryAfterSeconds: number };

/**
 * The dark-mode toggle (Task 17). Theme is a device property, not an account one (D75's
 * rejected-alternative note) — it lives in a cookie, not a column, so a signed-out visitor
 * still gets to pick before there is any account to attach it to.
 *
 * "System" is stored by deleting the cookie rather than writing the literal string: the root
 * layout only ever looks for `light`/`dark` and treats anything else as absent, so a missing
 * cookie and an explicit "system" choice collapse to the same one code path there.
 */
export async function saveThemeAction(theme: Theme): Promise<SaveThemeResult> {
  const member = await requireApprovedMemberOrThrow();

  const limited = await consume(member.userId, 'DEFAULT');
  if (limited) return { error: limited.code, retryAfterSeconds: limited.retryAfterSeconds };

  const store = await cookies();
  if (theme === 'system') {
    store.delete(THEME_COOKIE);
  } else {
    store.set(THEME_COOKIE, theme, {
      maxAge: THEME_COOKIE_MAX_AGE_SECONDS,
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
    });
  }

  // The root layout reads this cookie on every request; without a revalidation the router
  // cache keeps serving the previous <html data-theme> until an unrelated navigation.
  revalidatePath('/', 'layout');
  return { saved: true };
}
