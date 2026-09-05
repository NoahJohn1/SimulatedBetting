import type { NotificationChannel, NotificationType } from '@/db/schema';

/**
 * What an email renders from, frozen at the moment the fact happened — the same discipline
 * `FeedEventPayload` follows, and for the same reason: identity is joined live, facts freeze.
 *
 * Money in `payload` is a decimal string, never a JSON number. `JSON.stringify` throws on a
 * bigint and a number silently loses precision past 2^53 (D25).
 */
export interface NotificationRow {
  id: string;
  userId: string;
  type: NotificationType;
  channel: NotificationChannel;
  payload: Record<string, unknown>;
  queuedAt: Date;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
  /** RFC 8058. Gmail and Apple Mail render a native control that POSTs to this. */
  headers: Record<string, string>;
}

/**
 * The channel is a property of the type, and `enqueueNotification` reads it from here rather
 * than taking it from the caller — one place to look, and no call site can queue a settlement
 * as an immediate by mistake.
 */
export const CHANNEL_FOR_TYPE: Record<NotificationType, NotificationChannel> = {
  WAGER_OFFERED: 'IMMEDIATE',
  OFFER_EXPIRING: 'IMMEDIATE',
  DISPUTE_NEEDS_RULING: 'IMMEDIATE',
  ACCOUNT_APPROVED: 'IMMEDIATE',
  BETS_SETTLED: 'DIGEST',
  ALLOWANCE_PAID: 'DIGEST',
};
