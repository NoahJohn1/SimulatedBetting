import { eq, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { notificationPreferences, type NotificationType } from '@/db/schema';

export interface NotificationPreferences {
  mutedTypes: NotificationType[];
  emailsEnabled: boolean;
}

const EVERYTHING_ON: NotificationPreferences = { mutedTypes: [], emailsEnabled: true };

/** No row means everything on, so the table stays empty until somebody changes something. */
export async function getNotificationPreferences(userId: string): Promise<NotificationPreferences> {
  const [row] = await db
    .select({
      mutedTypes: notificationPreferences.mutedTypes,
      emailsEnabled: notificationPreferences.emailsEnabled,
    })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId));

  return row ?? EVERYTHING_ON;
}

/** The same read for many users at once — the delivery pass needs one query, not N. */
export async function getManyNotificationPreferences(
  userIds: string[],
): Promise<Map<string, NotificationPreferences>> {
  const found = new Map<string, NotificationPreferences>();
  if (userIds.length === 0) return found;

  const rows = await db
    .select({
      userId: notificationPreferences.userId,
      mutedTypes: notificationPreferences.mutedTypes,
      emailsEnabled: notificationPreferences.emailsEnabled,
    })
    .from(notificationPreferences)
    .where(inArray(notificationPreferences.userId, userIds));

  for (const row of rows) {
    found.set(row.userId, { mutedTypes: row.mutedTypes, emailsEnabled: row.emailsEnabled });
  }
  // Everybody asked about gets an answer, so the caller never has to handle a missing key.
  for (const id of userIds) if (!found.has(id)) found.set(id, EVERYTHING_ON);
  return found;
}

export async function setNotificationPreferences(
  userId: string,
  next: NotificationPreferences,
): Promise<void> {
  // De-duplicated so the stored array is a set, which is what isSuppressed assumes.
  const mutedTypes = [...new Set(next.mutedTypes)];
  const values = { mutedTypes, emailsEnabled: next.emailsEnabled, updatedAt: new Date() };

  await db
    .insert(notificationPreferences)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: notificationPreferences.userId, set: values });
}

/** The per-type unsubscribe. Adds one type and leaves everything else alone. */
export async function muteType(userId: string, type: NotificationType): Promise<void> {
  const current = await getNotificationPreferences(userId);
  await setNotificationPreferences(userId, {
    ...current,
    mutedTypes: [...current.mutedTypes, type],
  });
}

/** The global unsubscribe. Does not touch mutedTypes, so turning email back on restores them. */
export async function disableAllEmail(userId: string): Promise<void> {
  const current = await getNotificationPreferences(userId);
  await setNotificationPreferences(userId, { ...current, emailsEnabled: false });
}

export function isSuppressed(prefs: NotificationPreferences, type: NotificationType): boolean {
  if (!prefs.emailsEnabled) return true;
  return prefs.mutedTypes.includes(type);
}
