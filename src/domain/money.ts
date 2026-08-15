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

export function formatCents(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;

  const whole = abs / CENTS_PER_DOLLAR;
  const fraction = abs % CENTS_PER_DOLLAR;

  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = `$${grouped}.${fraction.toString().padStart(2, '0')}`;

  return negative ? `-${body}` : body;
}
