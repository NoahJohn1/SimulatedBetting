import { after } from 'next/server';
import { and, asc, eq, inArray, isNotNull, isNull, lt, ne } from 'drizzle-orm';
import { db } from '@/db/client';
import { notifications, users, type NotificationChannel, type NotificationType } from '@/db/schema';
import { getManyNotificationPreferences, isSuppressed } from './preferences';
import { renderDigest, renderImmediate } from './render';
import { sendEmail } from './transport';
import type { NotificationRow, RenderedEmail } from './types';

const MAX_ATTEMPTS = 5;
const ALL_CHANNELS: NotificationChannel[] = ['IMMEDIATE', 'DIGEST'];

export interface DeliverSummary {
  sent: number;
  suppressed: number;
  failed: number;
  errors: string[];
}

interface PendingRow {
  id: string;
  userId: string;
  type: NotificationType;
  channel: NotificationChannel;
  payload: unknown;
  queuedAt: Date;
  attempts: number;
  email: string;
  status: string;
}

function baseUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
}

function toRow(row: PendingRow): NotificationRow {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    channel: row.channel,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    queuedAt: row.queuedAt,
  };
}

/**
 * The only thing in this system that sends mail.
 *
 * Preferences are read here rather than at enqueue (D65), so the settle transaction pays for no
 * preferences query and a member who mutes a type mid-run leaves no half-keyed hole behind them
 * — the row exists, is not sent, and says SUPPRESSED.
 */
export async function deliverPending(
  options: { channels?: NotificationChannel[]; now?: Date } = {},
): Promise<DeliverSummary> {
  const now = options.now ?? new Date();
  const channels = options.channels ?? ALL_CHANNELS;
  const summary: DeliverSummary = { sent: 0, suppressed: 0, failed: 0, errors: [] };

  const pending: PendingRow[] = await db
    .select({
      id: notifications.id,
      userId: notifications.userId,
      type: notifications.type,
      channel: notifications.channel,
      payload: notifications.payload,
      queuedAt: notifications.queuedAt,
      attempts: notifications.attempts,
      email: users.email,
      status: users.status,
    })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .where(and(isNull(notifications.sentAt), inArray(notifications.channel, channels)))
    .orderBy(asc(notifications.queuedAt));

  if (pending.length === 0) return summary;

  const prefs = await getManyNotificationPreferences([...new Set(pending.map((r) => r.userId))]);
  const sendable: PendingRow[] = [];

  for (const row of pending) {
    // ACCOUNT_APPROVED is exempt from the status check: it IS the transition into APPROVED, and
    // a later disable must not retroactively swallow the one email that said "you are in".
    const statusOk = row.status === 'APPROVED' || row.type === 'ACCOUNT_APPROVED';

    if (!statusOk || isSuppressed(prefs.get(row.userId)!, row.type)) {
      await stamp(row.id, { outcome: 'SUPPRESSED', sentAt: now });
      summary.suppressed += 1;
      continue;
    }
    sendable.push(row);
  }

  for (const row of sendable.filter((r) => r.channel === 'IMMEDIATE')) {
    await renderAndDeliver(
      [row],
      () => renderImmediate(toRow(row), baseUrl()),
      row.email,
      now,
      summary,
    );
  }

  // One email per recipient, across types (D66).
  const byUser = new Map<string, PendingRow[]>();
  for (const row of sendable.filter((r) => r.channel === 'DIGEST')) {
    const list = byUser.get(row.userId) ?? [];
    list.push(row);
    byUser.set(row.userId, list);
  }

  for (const rows of byUser.values()) {
    await renderAndDeliver(
      rows,
      () => renderDigest(rows.map(toRow), baseUrl()),
      rows[0].email,
      now,
      summary,
    );
  }

  return summary;
}

/**
 * Rendering reads untyped, unvalidated jsonb (`notifications.payload`), so a single corrupted
 * row — e.g. a non-numeric `stakeCents` blowing up `money()`'s `BigInt(...)` — must not be able
 * to throw out of `deliverPending` and abort every other row in the same pass (design spec §5).
 * A render failure is recorded as a failure for every row in the group, exactly like a
 * `sendEmail` failure in `deliverGroup`, and the loop moves on.
 */
async function renderAndDeliver(
  rows: PendingRow[],
  renderFn: () => RenderedEmail,
  to: string,
  now: Date,
  summary: DeliverSummary,
): Promise<void> {
  let email: RenderedEmail;
  try {
    email = renderFn();
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const message = `${error.name}: ${error.message}`;
    summary.failed += rows.length;
    summary.errors.push(message);
    for (const row of rows) {
      const attempts = row.attempts + 1;
      const exhausted = attempts >= MAX_ATTEMPTS;
      await stamp(row.id, {
        attempts,
        error: message,
        outcome: exhausted ? 'FAILED' : null,
        sentAt: exhausted ? now : null,
      });
    }
    return;
  }

  await deliverGroup(rows, email, to, now, summary);
}

async function deliverGroup(
  rows: PendingRow[],
  email: RenderedEmail,
  to: string,
  now: Date,
  summary: DeliverSummary,
): Promise<void> {
  const result = await sendEmail({ to, email });

  if (result.ok) {
    for (const row of rows) await stamp(row.id, { outcome: 'SENT', sentAt: now });
    summary.sent += rows.length;
    return;
  }

  summary.failed += rows.length;
  summary.errors.push(result.error);

  for (const row of rows) {
    const attempts = row.attempts + 1;
    // Five attempts and it stops. A permanently bad address must not be retried every day
    // forever; the alert `runJob` raises on the pass is what makes it visible instead.
    const exhausted = attempts >= MAX_ATTEMPTS;
    await stamp(row.id, {
      attempts,
      error: result.error,
      outcome: exhausted ? 'FAILED' : null,
      sentAt: exhausted ? now : null,
    });
  }
}

/**
 * Never throws. A transient DB error stamping one row's outcome must not sink the rest of the
 * pass either — the row is simply left as it was and picked up again next pass.
 */
async function stamp(
  id: string,
  set: {
    outcome?: 'SENT' | 'SUPPRESSED' | 'FAILED' | null;
    sentAt?: Date | null;
    attempts?: number;
    error?: string | null;
  },
): Promise<void> {
  try {
    await db.update(notifications).set(set).where(eq(notifications.id, id));
  } catch (err) {
    console.error('[notify] failed to stamp notification row', id, err);
  }
}

/**
 * Flush immediates once the response is out (D64). `after` runs its callback after the response
 * is finished, so nothing sends inside a transaction and nothing sits in the request path.
 *
 * Swallows everything: a mail failure must never change what an action returns. Anything this
 * drops stays unsent and is picked up by the next cron pass, which is the whole reason the row
 * is the source of truth rather than the call.
 */
export function flushSoon(): void {
  try {
    after(async () => {
      try {
        await deliverPending({ channels: ['IMMEDIATE'] });
      } catch (err) {
        console.error('[notify] immediate flush failed; the cron pass will retry', err);
      }
    });
  } catch (err) {
    // `after` throws outside a request scope — a script, or a test calling the service directly.
    console.warn('[notify] flushSoon called outside a request scope', err);
  }
}

/**
 * Retention. Rides the daily reconcile run, as `pruneJobRuns` does.
 *
 * Two conditions, not one. Filtering on `queuedAt` alone deleted rows that had never been sent,
 * which silently discards the backlog precisely when the notify cron has been failing — the one
 * time the backlog matters. And it dropped the permanent keys with the rest: `ACCOUNT_APPROVED`
 * is deliberately unversioned (`user:<id>:approved`) so that approve/disable/approve sends one
 * email ever, and that promise lasts exactly as long as its row does. Both are excluded here.
 */
export async function pruneNotifications(olderThanDays = 30): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
  const deleted = await db
    .delete(notifications)
    .where(
      and(
        lt(notifications.queuedAt, cutoff),
        isNotNull(notifications.sentAt),
        ne(notifications.type, 'ACCOUNT_APPROVED'),
      ),
    )
    .returning({ id: notifications.id });
  return deleted.length;
}
