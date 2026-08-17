import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import type { Currency } from '@/db/schema';

export interface Discrepancy {
  membershipId: string;
  currency: Currency;
  cachedCents: bigint;
  ledgerCents: bigint;
}

/**
 * Compares each cached balance against the sum of its own currency's ledger entries.
 *
 * The shape is a cross join of every membership against both currencies, rather than a
 * group-by over the entries: a membership with a non-zero cache and *no* entries at all in
 * that currency is exactly the drift most worth catching, and a group-by over entries
 * cannot see it.
 *
 * Written with literal, table-qualified identifiers rather than drizzle's column helpers —
 * the correlated subquery would otherwise resolve both sides against its own FROM (D30).
 */
export async function reconcileBalances(): Promise<Discrepancy[]> {
  const rows = await db.execute<{
    membership_id: string;
    currency: Currency;
    cached_cents: string;
    ledger_cents: string;
  }>(sql`
    SELECT m.id AS membership_id,
           c.currency AS currency,
           CASE c.currency
             WHEN 'CASH' THEN m.balance_cents
             ELSE m.credits_balance_cents
           END AS cached_cents,
           COALESCE((
             SELECT SUM(l.amount_cents)
             FROM ledger_entries l
             WHERE l.membership_id = m.id
               AND l.currency = c.currency
           ), 0) AS ledger_cents
    FROM season_memberships m
    CROSS JOIN (SELECT unnest(enum_range(NULL::currency)) AS currency) c
    WHERE CASE c.currency
            WHEN 'CASH' THEN m.balance_cents
            ELSE m.credits_balance_cents
          END
          <> COALESCE((
            SELECT SUM(l.amount_cents)
            FROM ledger_entries l
            WHERE l.membership_id = m.id
              AND l.currency = c.currency
          ), 0)
    ORDER BY m.id, c.currency
  `);

  return Array.from(rows).map((row) => ({
    membershipId: row.membership_id,
    currency: row.currency,
    cachedCents: BigInt(row.cached_cents),
    ledgerCents: BigInt(row.ledger_cents),
  }));
}
