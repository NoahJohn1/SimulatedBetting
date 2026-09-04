import * as Sentry from '@sentry/nextjs';

export type AlertKind =
  'CRON_FAILED' | 'CRON_ERRORS' | 'CRON_RECOVERED' | 'BALANCE_DRIFT' | 'ESCROW_DRIFT';

export interface Alert {
  kind: AlertKind;
  /** One line. This is what lands in the chat channel. */
  message: string;
  /** Counts and ids only. The alert's job is to make someone open /admin/health. */
  context?: Record<string, string | number>;
}

const WEBHOOK_TIMEOUT_MS = 5_000;

export function formatAlert(alert: Alert): string {
  const lines = [`[${alert.kind}] ${alert.message}`];
  for (const [key, value] of Object.entries(alert.context ?? {})) {
    lines.push(`${key}: ${value}`);
  }
  return lines.join('\n');
}

/**
 * Raise an alert on both transports (D59). Cannot reject, ever.
 *
 * A dead webhook must not be able to fail a settle run — that would make the alarm the outage.
 * Both transports fire every time and neither is the other's fallback: Sentry hitting its
 * free-tier rate limit must not silence the money alarm, and a rotated webhook URL must not
 * lose the error history.
 */
export async function raiseAlert(alert: Alert): Promise<void> {
  const body = formatAlert(alert);
  sendToSentry(alert, body);
  await sendToWebhook(body);
}

async function sendToWebhook(body: string): Promise<void> {
  const url = process.env.ALERT_WEBHOOK_URL;

  if (!url) {
    // Inert until Noah supplies a destination. Not an error — this is the expected state in
    // CI, in the test suite, and in local development.
    console.warn(`[alert] ALERT_WEBHOOK_URL is not set, so this was not sent:\n${body}`);
    return;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Discord's incoming webhooks read `content`, Slack's read `text`, and each ignores
      // unknown keys — so one body works for either without a second config value naming
      // which service it is (D59).
      body: JSON.stringify({ content: body, text: body }),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error(`[alert] webhook answered ${response.status}; alert not delivered:\n${body}`);
    }
  } catch (err) {
    console.error(`[alert] webhook POST failed; alert not delivered:\n${body}`, err);
  }
}

function sendToSentry(alert: Alert, body: string): void {
  try {
    // A no-op when Sentry.init was never called, which is the state without a DSN (D62).
    Sentry.captureMessage(body, {
      level: 'error',
      // One issue per alert kind rather than one per occurrence.
      fingerprint: ['simbet-alert', alert.kind],
      tags: { alert_kind: alert.kind },
    });
  } catch (err) {
    console.error('[alert] Sentry capture failed', err);
  }
}
