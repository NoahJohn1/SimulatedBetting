'use server';

import { revalidatePath } from 'next/cache';
import type { NotificationType } from '@/db/schema';
import { requireApprovedMemberOrThrow } from '@/server/auth/session';
import { setNotificationPreferences } from '@/server/notify/preferences';

export async function saveNotificationPreferencesAction(next: {
  mutedTypes: NotificationType[];
  emailsEnabled: boolean;
}): Promise<void> {
  // The user comes from the session, never from the client — otherwise a crafted request
  // silences somebody else's email.
  const member = await requireApprovedMemberOrThrow();
  await setNotificationPreferences(member.userId, next);
  revalidatePath('/me/notifications');
}
