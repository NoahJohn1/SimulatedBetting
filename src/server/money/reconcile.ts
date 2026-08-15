import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

export interface Discrepancy {
  membershipId: string;
  cachedCents: bigint;
  ledgerCents: bigint;
}

export async function reconcileBalances(): Promise<Discrepancy[]> {
  const rows = await db.execute<{
    membership_id: string;
    cached_cents: string;
    ledger_cents: string;
  }>(sql`
    SELECT m.id                                   AS membership_id,
           m.balance_cents                        AS cached_cents,
           COALESCE(SUM(l.amount_cents), 0)       AS ledger_cents
    FROM season_memberships m
    LEFT JOIN ledger_entries l ON l.membership_id = m.id
    GROUP BY m.id, m.balance_cents
    HAVING m.balance_cents <> COALESCE(SUM(l.amount_cents), 0)
  `);

  return Array.from(rows).map((row) => ({
    membershipId: row.membership_id,
    cachedCents: BigInt(row.cached_cents),
    ledgerCents: BigInt(row.ledger_cents),
  }));
}
