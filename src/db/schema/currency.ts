import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Cash is the season bankroll the standings rank. Credits are the separate, granted,
 * non-convertible currency custom events are bet in (D31).
 *
 * This lives in its own file rather than in money.ts because betting.ts needs it too, and
 * money.ts already imports betting.ts — a shared leaf module avoids the cycle.
 */
export const currency = pgEnum('currency', ['CASH', 'CREDITS']);

export type Currency = (typeof currency.enumValues)[number];
