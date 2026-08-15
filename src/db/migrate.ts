import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

config({ path: process.env.ENV_FILE ?? '.env.local' });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

const client = postgres(connectionString, { max: 1 });

async function run() {
  await migrate(drizzle(client), { migrationsFolder: './drizzle' });
  await client.end();

  console.log('migrations applied');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
