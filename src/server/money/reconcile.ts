import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import type { Currency, P2PWagerStatus } from '@/db/schema';

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

export interface EscrowDiscrepancy {
  wagerId: string;
  status: P2PWagerStatus;
  /** What the wager's own status says should be locked in its pot. */
  expectedHeldCents: bigint;
  /** What the ledger has actually locked: escrows, less payouts, refunds and reversals. */
  actualHeldCents: bigint;
}

/**
 * The second half of reconciliation, added by subsystem 4 (D43).
 *
 * `reconcileBalances` compares each cached balance against that member's own ledger sum, and
 * both sides of that comparison are already net of escrow — so it stays correct and it
 * cannot see escrow drift at all. A wager that took both stakes and never paid out leaves
 * every member's cache in perfect agreement with their entries while 70,000 credits sit in
 * a pot nobody owns.
 *
 * This check closes that gap: for every wager, what the ledger has locked against it must
 * equal what its status says should be locked. One stake while OFFERED, both while ACCEPTED,
 * nothing once it has ended.
 *
 * Written with literal, table-qualified identifiers rather than drizzle's column helpers, for
 * the same reason `reconcileBalances` is — the correlated subquery would otherwise resolve
 * both sides against its own FROM (D30).
 */
export async function reconcileEscrow(): Promise<EscrowDiscrepancy[]> {
  const rows = await db.execute<{
    wager_id: string;
    status: P2PWagerStatus;
    expected_cents: string;
    actual_cents: string;
  }>(sql`
    SELECT w.id AS wager_id,
           w.status AS status,
           CASE w.status
             WHEN 'OFFERED'  THEN w.offerer_stake_cents
             WHEN 'ACCEPTED' THEN w.offerer_stake_cents + w.acceptor_stake_cents
             ELSE 0
           END AS expected_cents,
           COALESCE((
             SELECT -SUM(l.amount_cents)
             FROM ledger_entries l
             WHERE l.p2p_wager_id = w.id
           ), 0) AS actual_cents
    FROM p2p_wagers w
    WHERE CASE w.status
            WHEN 'OFFERED'  THEN w.offerer_stake_cents
            WHEN 'ACCEPTED' THEN w.offerer_stake_cents + w.acceptor_stake_cents
            ELSE 0
          END
          <> COALESCE((
            SELECT -SUM(l.amount_cents)
            FROM ledger_entries l
            WHERE l.p2p_wager_id = w.id
          ), 0)
    ORDER BY w.id
  `);

  return Array.from(rows).map((row) => ({
    wagerId: row.wager_id,
    status: row.status,
    expectedHeldCents: BigInt(row.expected_cents),
    actualHeldCents: BigInt(row.actual_cents),
  }));
}
