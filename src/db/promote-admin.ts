/**
 * Seeds the first admin.
 *
 * New sign-ins land PENDING and an admin approves them (D7), which leaves the very first
 * account with nobody able to approve it. This script breaks that cycle from the command
 * line, so bootstrapping never means hand-editing the database.
 *
 *   npm run admin:promote -- someone@example.com
 *
 * Safe to run repeatedly, and safe on an account that has not signed in yet — it records
 * the intent so the row is promoted the moment it exists.
 */
import { config } from 'dotenv';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { users } from './schema';

config({ path: process.env.ENV_FILE ?? '.env.local' });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

async function run() {
  const email = process.argv[2];
  if (!email) {
    console.error('usage: npm run admin:promote -- <email>');
    process.exit(1);
  }

  const client = postgres(connectionString!, { max: 1 });
  const db = drizzle(client, { schema: { users } });

  const promoted = await db
    .update(users)
    .set({ role: 'ADMIN', status: 'APPROVED' })
    .where(eq(users.email, email))
    .returning({ id: users.id, email: users.email });

  await client.end();

  if (promoted.length === 0) {
    console.error(
      `no user with email ${email}. Sign in once with that Google account, then run this again.`,
    );
    process.exit(1);
  }

  console.log(`promoted ${promoted[0].email} to ADMIN and APPROVED`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
