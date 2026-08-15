import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

export async function resetDb(): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE season_memberships, seasons, users RESTART IDENTITY CASCADE`,
  );
}
