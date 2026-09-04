import type { NotificationType } from '@/db/schema';
import { unsubscribeUrl } from './unsubscribe';
import type { NotificationRow, RenderedEmail } from './types';

/** Cents as a decimal string, in from jsonb and out to a body, never through a number. */
function money(cents: unknown): string {
  const n = BigInt(String(cents ?? '0'));
  const negative = n < 0n;
  const abs = negative ? -n : n;
  return `${negative ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}

function str(payload: Record<string, unknown>, key: string, fallback = ''): string {
  const value = payload[key];
  return typeof value === 'string' ? value : fallback;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function immediateBody(row: NotificationRow): { subject: string; lines: string[] } {
  const p = row.payload;

  switch (row.type) {
    case 'WAGER_OFFERED':
      return {
        subject: `${str(p, 'fromName', 'Someone')} offered you a wager`,
        lines: [
          `${str(p, 'fromName', 'Someone')} has offered you a wager on ${str(p, 'subject')}.`,
          `Their stake: ${money(p.stakeCents)} credits.`,
          'If nobody accepts it, it expires and the credits go back.',
        ],
      };
    case 'OFFER_EXPIRING':
      return {
        subject: `A wager offer expires soon — ${str(p, 'subject')}`,
        lines: [
          `The offer on ${str(p, 'subject')} expires ${str(p, 'expiresAt')}.`,
          'Once it lapses the escrowed credits go back to whoever offered them.',
        ],
      };
    case 'DISPUTE_NEEDS_RULING':
      return {
        subject: `A dispute needs your ruling — ${str(p, 'subject')}`,
        lines: [
          `${str(p, 'subject')} is disputed and waiting on an admin.`,
          'Nothing settles until somebody rules on it.',
        ],
      };
    case 'ACCOUNT_APPROVED':
      return {
        subject: 'Your account was approved',
        lines: ['An admin approved your account. You can join the season and start betting.'],
      };
    // BETS_SETTLED and ALLOWANCE_PAID are DIGEST types and never reach this function. The
    // default keeps that harmless if somebody edits CHANNEL_FOR_TYPE without editing this.
    default:
      return {
        subject: 'An update from the sportsbook',
        lines: ['Something happened that concerns you.'],
      };
  }
}

function footer(userId: string, scope: NotificationType | 'all', baseUrl: string): string[] {
  return [
    '',
    '—',
    `Stop these emails: ${unsubscribeUrl(baseUrl, userId, scope)}`,
    `Stop all email: ${unsubscribeUrl(baseUrl, userId, 'all')}`,
    `Change what you get: ${new URL('/me/notifications', baseUrl).toString()}`,
  ];
}

function oneClickHeaders(
  userId: string,
  scope: NotificationType | 'all',
  baseUrl: string,
): Record<string, string> {
  // RFC 8058. The scope is this email's own type, never `all`: somebody pressing Gmail's native
  // button means "stop sending me this", not "stop sending me everything" (D67).
  return {
    'List-Unsubscribe': `<${unsubscribeUrl(baseUrl, userId, scope, '/api/unsubscribe')}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

function assemble(
  subject: string,
  lines: string[],
  userId: string,
  scope: NotificationType | 'all',
  baseUrl: string,
): RenderedEmail {
  const all = [...lines, ...footer(userId, scope, baseUrl)];
  return {
    subject,
    text: all.join('\n'),
    html: all.map((line) => (line === '' ? '<p></p>' : `<p>${escapeHtml(line)}</p>`)).join('\n'),
    headers: oneClickHeaders(userId, scope, baseUrl),
  };
}

export function renderImmediate(row: NotificationRow, baseUrl: string): RenderedEmail {
  const { subject, lines } = immediateBody(row);
  return assemble(subject, lines, row.userId, row.type, baseUrl);
}

/**
 * One email per recipient, across types (D66). A Tuesday reads "your allowance landed, and here
 * is how four bets settled" rather than arriving as five separate messages.
 */
export function renderDigest(rows: NotificationRow[], baseUrl: string): RenderedEmail {
  const bets = rows.filter((r) => r.type === 'BETS_SETTLED');
  const allowances = rows.filter((r) => r.type === 'ALLOWANCE_PAID');

  const parts: string[] = [];
  if (bets.length > 0) parts.push(`${bets.length} bet${bets.length === 1 ? '' : 's'} settled`);
  if (allowances.length > 0) parts.push('your allowance landed');
  const subject = parts.length > 0 ? parts.join(', and ') : 'Your sportsbook digest';

  const lines: string[] = [];

  if (allowances.length > 0) {
    const total = allowances.reduce(
      (sum, r) => sum + BigInt(String(r.payload.amountCents ?? '0')),
      0n,
    );
    lines.push(`Your weekly allowance landed: ${money(total)}.`, '');
  }

  if (bets.length > 0) {
    lines.push('How your bets settled:');
    for (const bet of bets) {
      lines.push(
        `  ${str(bet.payload, 'outcome')} — ${str(bet.payload, 'subject')} (${money(bet.payload.netCents)})`,
      );
    }
  }

  // The digest's unsubscribe scope is BETS_SETTLED when there are bets, since that is what most
  // of the message is; a recipient who only ever gets the allowance line gets that scope.
  const scope: NotificationType = bets.length > 0 ? 'BETS_SETTLED' : 'ALLOWANCE_PAID';
  return assemble(subject, lines, rows[0].userId, scope, baseUrl);
}
