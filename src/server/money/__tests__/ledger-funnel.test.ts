import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A source-scanning guard, not a behavioural test. It asserts the structural property the
 * money design rests on: every ledger write funnels through `postEntry`.
 *
 * D5 makes the ledger append-only and the balance a cache reconciled against it. That holds
 * only while `postEntry` is the single writer — it is what stamps the idempotency key and
 * updates `balance_cents` in the same transaction. A direct `.insert(ledgerEntries)` from
 * anywhere else silently opts out of both, and no behavioural test would notice, because the
 * entry it wrote looks fine on its own.
 *
 * The property held on 2026-08-25 and again on 2026-09-02 because nobody happened to write a
 * direct insert, not because anything stopped them. This is the thing that stops them.
 *
 * Reads files only — no database. See docs/repo-health.md section 3.3.
 */

const SRC = 'src';

/** The one file allowed to insert directly. It is the funnel. */
const LEDGER = join('src', 'server', 'money', 'ledger.ts');

/**
 * Test directories may insert directly: `src/db/__tests__/ledger-schema.test.ts` and
 * `currency-schema.test.ts` exist to test the database constraints themselves, and routing
 * them through `postEntry` would test the funnel instead of the constraint.
 */
function isTestFile(path: string): boolean {
  return path.split(sep).includes('__tests__');
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/** Matches `.insert(ledgerEntries)` across a line break, which is how Drizzle chains read. */
const INSERT = /\.insert\(\s*ledgerEntries\s*\)/;
const UPDATE = /\.update\(\s*ledgerEntries\s*\)/;
const DELETE = /\.delete\(\s*ledgerEntries\s*\)/;

function filesMatching(pattern: RegExp, includeTests: boolean): string[] {
  return sourceFiles(SRC)
    .filter((f) => includeTests || !isTestFile(f))
    .filter((f) => pattern.test(readFileSync(f, 'utf8')))
    .map((f) => relative('.', f));
}

describe('the ledger funnel', () => {
  it('has exactly one production file that inserts ledger entries: the funnel itself', () => {
    expect(filesMatching(INSERT, false)).toEqual([LEDGER]);
  });

  it('never updates a ledger entry, anywhere, including tests', () => {
    expect(filesMatching(UPDATE, true)).toEqual([]);
  });

  it('never deletes a ledger entry, anywhere, including tests', () => {
    expect(filesMatching(DELETE, true)).toEqual([]);
  });
});
