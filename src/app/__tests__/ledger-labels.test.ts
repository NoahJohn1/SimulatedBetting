import { describe, expect, it } from 'vitest';
import { ledgerEntryType } from '@/db/schema/money';
import { LEDGER_LABELS } from '../(app)/(column)/me/ledger-labels';

/**
 * A raw enum value reaching the screen is a bug (Task 11). This pins the ledger label map to
 * the schema's enum: every `ledger_entry_type` value must have English copy, and the map may
 * not carry a stray key the enum no longer has.
 */
describe('ledger labels', () => {
  it('covers every ledger_entry_type value', () => {
    const enumKeys = new Set(ledgerEntryType.enumValues);
    const labelKeys = new Set(Object.keys(LEDGER_LABELS));
    expect(labelKeys).toEqual(enumKeys);
  });

  it('gives every value non-empty copy', () => {
    for (const value of ledgerEntryType.enumValues) {
      expect(LEDGER_LABELS[value].trim().length).toBeGreaterThan(0);
    }
  });
});
