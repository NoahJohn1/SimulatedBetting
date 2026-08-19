export const DEFAULT_STARTING_BANKROLL_CENTS = 1_000_000n; // $10,000.00
export const DEFAULT_WEEKLY_ALLOWANCE_CENTS = 50_000n; // $500.00
export const DEFAULT_ALLOWANCE_WEEKDAY = 2; // Tuesday, matching the NFL week rollover

/**
 * Credits are a smaller economy than cash on purpose — a custom market is a side bet.
 *
 * These are CENTS, like every other amount in this codebase (D17). A member starts a season
 * with 1,000.00 credits against a 10,000.00 cash bankroll, and is dripped 100.00 credits a
 * week against 500.00 cash. Do not "fix" these to look like the numbers they render as.
 */
export const DEFAULT_STARTING_CREDITS_CENTS = 100_000n; // 1,000.00 credits
export const DEFAULT_WEEKLY_CREDIT_ALLOWANCE_CENTS = 10_000n; // 100.00 credits
