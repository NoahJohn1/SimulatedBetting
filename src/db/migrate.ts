import { config } from 'dotenv';
import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

config({ path: process.env.ENV_FILE ?? '.env.local' });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

const client = postgres(connectionString, { max: 1 });
const db = drizzle(client);

const MIGRATIONS_SCHEMA = 'drizzle';
const MIGRATIONS_TABLE = '__drizzle_migrations';

/**
 * A hand-rolled stand-in for `drizzle-orm/postgres-js/migrator`'s `migrate()`, which wraps
 * every not-yet-applied migration file in one single transaction. That is wrong for us:
 * migration 0008 does `ALTER TYPE market_type ADD VALUE 'CUSTOM_OUTCOME'` and 0009 uses that
 * value in a partial index predicate, and Postgres refuses to use a new enum value before the
 * transaction that added it has committed ("unsafe use of new value ... New enum values must
 * be committed before they can be used"). Applying migrations one-file-per-transaction — same
 * bookkeeping table, same hash/idempotency behaviour, just a narrower transaction boundary —
 * is what lets a completely fresh database run every migration in a single `db:migrate` call
 * without hitting that error.
 */
async function run() {
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS ${sql.identifier(MIGRATIONS_SCHEMA)}`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ${sql.identifier(MIGRATIONS_SCHEMA)}.${sql.identifier(MIGRATIONS_TABLE)} (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  const lastApplied = await db.execute(
    sql`select created_at from ${sql.identifier(MIGRATIONS_SCHEMA)}.${sql.identifier(MIGRATIONS_TABLE)} order by created_at desc limit 1`,
  );
  const lastAppliedAt =
    lastApplied.length > 0 ? Number((lastApplied[0] as { created_at: string }).created_at) : -1;

  const migrations = readMigrationFiles({ migrationsFolder: './drizzle' });
  const pending = migrations.filter((m) => m.folderMillis > lastAppliedAt);

  for (const migration of pending) {
    await db.transaction(async (tx) => {
      for (const statement of migration.sql) {
        await tx.execute(sql.raw(statement));
      }
      await tx.execute(
        sql`insert into ${sql.identifier(MIGRATIONS_SCHEMA)}.${sql.identifier(MIGRATIONS_TABLE)} ("hash", "created_at") values (${migration.hash}, ${migration.folderMillis})`,
      );
    });
  }

  await client.end();

  console.log('migrations applied');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
