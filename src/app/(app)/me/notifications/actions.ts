'use server';

import { revalidatePath } from 'next/cache';
import type { NotificationType } from '@/db/schema';
import { requireApprovedMemberOrThrow } from '@/server/auth/session';
import { consume } from '@/server/limits/consume';
import { setNotificationPreferences } from '@/server/notify/preferences';

export type SaveNotificationPreferencesResult =
  { saved: true } | { error: 'RATE_LIMITED'; retryAfterSeconds: number };

export async function saveNotificationPreferencesAction(next: {
  mutedTypes: NotificationType[];
  emailsEnabled: boolean;
}): Promise<SaveNotificationPreferencesResult> {
  // The user comes from the session, never from the client — otherwise a crafted request
  // silences somebody else's email.
  const member = await requireApprovedMemberOrThrow();

  // `DEFAULT`, matching `saveFeedPreferencesAction` next door: a preferences write is cheap and
  // touches no money, but D69 admits no unlimited mutation and the guard test enforces it.
  const limited = await consume(member.userId, 'DEFAULT');
  if (limited) return { error: limited.code, retryAfterSeconds: limited.retryAfterSeconds };

  await setNotificationPreferences(member.userId, next);
  revalidatePath('/me/notifications');
  return { saved: true };
}
