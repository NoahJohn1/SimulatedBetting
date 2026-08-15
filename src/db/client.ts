import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

/**
 * Whether this URL points at a transaction-mode connection pooler (Supabase's Supavisor on
 * port 6543, per the hosting spec).
 *
 * It matters because transaction pooling hands a different backend connection to each
 * statement, so prepared statements — which postgres.js uses by default — are not there the
 * second time and every query fails. Migrations therefore run against the direct
 * connection, and the app runtime against the pooler with preparation off.
 */
export function isTransactionPooler(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.port === '6543' || parsed.hostname.includes('pooler');
  } catch {
    return false;
  }
}

const pooled = isTransactionPooler(connectionString);

export const pgClient = postgres(connectionString, {
  // Each serverless invocation is short-lived and the pooler is doing the real pooling, so
  // holding a wide local pool per instance just burns Postgres connections.
  max: pooled ? 1 : 10,
  prepare: !pooled,
});

export const db = drizzle(pgClient, { schema });

export type Database = typeof db;
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
