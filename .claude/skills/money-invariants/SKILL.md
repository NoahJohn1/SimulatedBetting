---
name: money-invariants
description: Review a change against this project's four money invariants — append-only ledger, deterministic idempotency keys, same-transaction balance cache, and separate escrow reconciliation. Use before committing anything under src/server/money, src/server/bets, src/server/p2p, src/server/events/resolve.ts, or src/db/schema/money.ts, and whenever reviewing a diff that touches balances, escrow, settlement, or ledger entry types.
---

# Money invariants

The ledger is the highest-stakes code here and the easiest to break subtly. Four invariants
hold today. A change that breaks one will usually still pass the test suite.

## What is already enforced mechanically — do not re-check by hand

`src/server/money/__tests__/ledger-funnel.test.ts` proves, by reading the source, that no code
outside `src/server/money/ledger.ts` inserts into `ledgerEntries`, and that nothing anywhere
updates or deletes one. If that test passes, invariant 1 and the funnel are intact. Spend your
attention on what follows instead.

## The four invariants

**1. The ledger is append-only.** Corrections write reversing entries; history is never edited
([D5](../../../docs/decisions.md)). The guard test covers the mechanical half. The judgment half:
does a correction path actually reverse, or does it recompute a number and write it as if it
were original?

**2. Every write carries a deterministic idempotency key.** The unique index on
`ledger_entries.idempotency_key` turns a repeated write into a rejection rather than a double
payment — but only if the key is genuinely deterministic. Ask:

- Does the key close over anything that varies between runs? `Date.now()`, a random id, an
  array index, or iteration order all silently defeat it.
- Is it derived from the identity of the event (bet id, wager id, week number) rather than from
  when the code happened to run?
- Can two *different* events collide on it? A correction must not reuse the original's key —
  see the comments in `src/db/schema/betting.ts` and `src/db/schema/p2p.ts`.

**3. The balance cache is written in the same transaction as its entry.** `balance_cents` is a
cache over the ledger ([D5](../../../docs/decisions.md)). If a new path writes an entry in one
transaction and updates the balance in another, a crash between them leaves them disagreeing,
and the daily `reconcileBalances` will find it a day later. Check that the `tx` handle passed to
`postEntry` is the same one the balance update runs on.

**4. Escrow needs its own reconciliation.** `reconcileBalances` cannot see credits sitting in a
pot — escrowed credits have left a balance and arrived nowhere
([D43](../../../docs/decisions.md)). Any new path that escrows must be visible to
`reconcileEscrow` in `src/server/money/reconcile.ts`. A wager that escrows and never pays out is
exactly the bug balance reconciliation is blind to.

## Currency correctness

Cash and credits are one ledger with a currency dimension
([D34](../../../docs/decisions.md)), not two ledgers. Credits are non-convertible
([D31](../../../docs/decisions.md)) — no path may turn credits into cash or the reverse. Custom
events and every peer-to-peer wager move credits only. Check that a new path does not mix them
in one bet, one wager, or one balance comparison.

## How to review

1. Get the diff: `git diff main...HEAD -- src/server/money src/server/bets src/server/p2p src/server/events src/db/schema`
2. For each new or changed `postEntry` call, answer invariant 2 and 3 explicitly.
3. For each new escrow or payout path, answer invariant 4.
4. Run `npx vitest run src/server/money src/db/__tests__` and confirm the guard and schema tests pass.
5. Report what you checked, not just what you found. "Idempotency key derives from wager id and
   status, deterministic" is a useful finding; silence is not.
