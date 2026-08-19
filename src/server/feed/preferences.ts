import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedPreferences, type FeedEventType } from '@/db/schema';

/** No row means nothing muted, so the table stays empty until somebody changes something. */
export async function getMutedTypes(userId: string): Promise<FeedEventType[]> {
  const [row] = await db
    .select({ mutedTypes: feedPreferences.mutedTypes })
    .from(feedPreferences)
    .where(eq(feedPreferences.userId, userId));

  return row?.mutedTypes ?? [];
}

export async function setMutedTypes(userId: string, types: FeedEventType[]): Promise<void> {
  // De-duplicated so the stored array is a set, which is what the read filter assumes.
  const mutedTypes = [...new Set(types)];

  await db
    .insert(feedPreferences)
    .values({ userId, mutedTypes, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: feedPreferences.userId,
      set: { mutedTypes, updatedAt: new Date() },
    });
}
