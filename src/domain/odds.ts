/**
 * A price expressed as an exact rational total-return multiplier.
 * `num / den` includes the stake: -110 is 210/110, so a $100 stake returns $190.91.
 */
export interface Rational {
  num: bigint;
  den: bigint;
}

/** Divide with half-up rounding. Both arguments must be positive. */
function roundHalfUpDiv(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

export function americanToRational(price: number): Rational {
  if (!Number.isInteger(price)) {
    throw new Error(`American price must be an integer: ${price}`);
  }
  if (price > -100 && price < 100) {
    throw new Error(`American price must be <= -100 or >= 100: ${price}`);
  }

  if (price > 0) {
    return { num: BigInt(price) + 100n, den: 100n };
  }

  const magnitude = BigInt(-price);
  return { num: 100n + magnitude, den: magnitude };
}

export function combine(rationals: Rational[]): Rational {
  return rationals.reduce<Rational>((acc, r) => ({ num: acc.num * r.num, den: acc.den * r.den }), {
    num: 1n,
    den: 1n,
  });
}

/** Total return (stake included) for a stake at the given price. Rounds exactly once. */
export function payoutCents(stakeCents: bigint, r: Rational): bigint {
  if (stakeCents < 0n) throw new Error('stake must not be negative');
  return roundHalfUpDiv(stakeCents * r.num, r.den);
}

export function rationalToAmerican(r: Rational): number {
  const profitNum = r.num - r.den;
  if (profitNum <= 0n) {
    throw new Error('price must pay more than the stake');
  }

  // Decimal odds >= 2 means profit multiplier >= 1, i.e. profitNum >= den.
  if (profitNum >= r.den) {
    return Number(roundHalfUpDiv(profitNum * 100n, r.den));
  }
  return -Number(roundHalfUpDiv(r.den * 100n, profitNum));
}
