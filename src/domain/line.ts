/**
 * Canonical normalization and comparison for betting lines (spreads, totals).
 *
 * Lines arrive from Postgres as decimal strings. Comparing them as floats risks
 * false mismatches (e.g. -3.5 !== -3.5000000001-style drift), so everything here
 * stays string-based: trim, validate, strip trailing fractional zeros, collapse
 * `-0` to `0`. Never route through `Number` for comparison purposes.
 *
 * `null` (no line — e.g. a moneyline leg) must never compare equal to `'0'`
 * (a real pick'em spread). Conflating them would let a moneyline selection be
 * smuggled through as a spread bet.
 */

const LINE_PATTERN = /^-?\d+(\.\d{1,2})?$/;

export function normalizeLine(line: string | number | null): string | null {
  if (line === null) {
    return null;
  }

  const trimmed = String(line).trim();

  if (!LINE_PATTERN.test(trimmed)) {
    throw new Error(`Invalid line: ${JSON.stringify(line)}`);
  }

  const [integerPart, initialFractionPart] = trimmed.split('.');
  let fractionPart = initialFractionPart;

  if (fractionPart !== undefined) {
    fractionPart = fractionPart.replace(/0+$/, '');
  }

  let normalized = fractionPart ? `${integerPart}.${fractionPart}` : integerPart;

  if (normalized === '-0') {
    normalized = '0';
  }

  return normalized;
}

export function linesEqual(a: string | number | null, b: string | number | null): boolean {
  return normalizeLine(a) === normalizeLine(b);
}

export function lineToNumber(line: string | null): number | null {
  if (line === null) {
    return null;
  }

  return Number(line);
}
