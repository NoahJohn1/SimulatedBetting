import type { Currency } from '@/db/schema';

export const CENTS_PER_DOLLAR = 100n;

/** Parse a dollar amount into integer cents. Rejects anything finer than a cent. */
export function dollarsToCents(input: string | number): bigint {
  const text = typeof input === 'number' ? input.toString() : input.trim();

  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) {
    throw new Error(`not a valid dollar amount: ${input}`);
  }

  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  const cents = BigInt(whole) * CENTS_PER_DOLLAR + BigInt(fraction.padEnd(2, '0'));

  return negative ? -cents : cents;
}

/**
 * Cash is `$`; credits are `©`.
 *
 * The credits mark sits in the same position as the dollar sign on purpose — the two
 * currencies share every tabular-nums column in the UI, so a prefix that changed side or
 * width would break the alignment cash betting already has.
 */
const SYMBOL: Record<Currency, string> = { CASH: '$', CREDITS: '©' };

/** Cash. Unchanged, and still the default everywhere money is shown without a currency. */
export function formatCents(cents: bigint): string {
  return formatAmount(cents, 'CASH');
}

/** The same formatter, told which denomination it is printing (D31). */
export function formatAmount(cents: bigint, currency: Currency = 'CASH'): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;

  const whole = abs / CENTS_PER_DOLLAR;
  const fraction = abs % CENTS_PER_DOLLAR;

  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = `${SYMBOL[currency]}${grouped}.${fraction.toString().padStart(2, '0')}`;

  return negative ? `-${body}` : body;
}
