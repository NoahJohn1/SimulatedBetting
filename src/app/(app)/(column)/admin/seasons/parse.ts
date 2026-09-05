/**
 * Amounts are entered in whole units and converted here. defaults.ts is emphatic that its
 * constants are cents and are not to be "fixed" to look like the numbers they render as; a form
 * taking cents directly is a form that creates a season with a $100.00 bankroll one day.
 *
 * Never routes through Number: the string is split and each half becomes a bigint directly.
 */
export function parseAmountToCents(raw: string, label: string): bigint {
  const text = raw.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    throw new Error(`${label} must be a whole number of dollars, like 10000 or 10000.50`);
  }
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
