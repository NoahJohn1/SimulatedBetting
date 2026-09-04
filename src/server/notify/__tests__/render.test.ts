import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderDigest, renderImmediate } from '@/server/notify/render';
import type { NotificationRow } from '@/server/notify/types';

const USER = '11111111-1111-1111-1111-111111111111';
const BASE = 'https://bets.example';

beforeEach(() => vi.stubEnv('AUTH_SECRET', 'test-secret'));
afterEach(() => vi.unstubAllEnvs());

function row(over: Partial<NotificationRow>): NotificationRow {
  return {
    id: 'n1',
    userId: USER,
    type: 'WAGER_OFFERED',
    channel: 'IMMEDIATE',
    payload: {},
    queuedAt: new Date('2026-09-03T12:00:00Z'),
    ...over,
  };
}

describe('renderImmediate', () => {
  it('names the offerer, the subject and the stake', () => {
    const email = renderImmediate(
      row({
        type: 'WAGER_OFFERED',
        payload: { fromName: 'Dana', subject: 'Chiefs -3.5', stakeCents: '2500' },
      }),
      BASE,
    );

    expect(email.subject).toBe('Dana offered you a wager');
    expect(email.text).toContain('Chiefs -3.5');
    expect(email.text).toContain('25.00');
  });

  it('sets the one-click headers scoped to this email’s own type, never to all', () => {
    const email = renderImmediate(row({ type: 'WAGER_OFFERED' }), BASE);

    expect(email.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    const header = email.headers['List-Unsubscribe'];
    expect(header.startsWith('<')).toBe(true);
    expect(header.endsWith('>')).toBe(true);

    const url = new URL(header.slice(1, -1));
    expect(url.pathname).toBe('/api/unsubscribe');
    expect(url.searchParams.get('s')).toBe('WAGER_OFFERED');
  });

  it('offers both scopes in the footer', () => {
    const email = renderImmediate(row({ type: 'OFFER_EXPIRING' }), BASE);
    expect(email.text).toContain('s=OFFER_EXPIRING');
    expect(email.text).toContain('s=all');
  });

  it('escapes payload text into the HTML body', () => {
    const email = renderImmediate(
      row({ type: 'WAGER_OFFERED', payload: { fromName: '<script>x</script>' } }),
      BASE,
    );
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });

  it('renders every immediate type without throwing', () => {
    for (const type of [
      'WAGER_OFFERED',
      'OFFER_EXPIRING',
      'DISPUTE_NEEDS_RULING',
      'ACCOUNT_APPROVED',
    ] as const) {
      const email = renderImmediate(row({ type }), BASE);
      expect(email.subject.length).toBeGreaterThan(0);
      expect(email.html).toContain('<p>');
    }
  });
});

describe('renderDigest', () => {
  it('collapses bets and the allowance into one email', () => {
    const email = renderDigest(
      [
        row({ type: 'ALLOWANCE_PAID', channel: 'DIGEST', payload: { amountCents: '50000' } }),
        row({
          id: 'n2',
          type: 'BETS_SETTLED',
          channel: 'DIGEST',
          payload: { outcome: 'WON', netCents: '1500', subject: 'Chiefs -3.5' },
        }),
        row({
          id: 'n3',
          type: 'BETS_SETTLED',
          channel: 'DIGEST',
          payload: { outcome: 'LOST', netCents: '-2000', subject: 'Bills ML' },
        }),
      ],
      BASE,
    );

    expect(email.subject).toBe('2 bets settled, and your allowance landed');
    expect(email.text).toContain('Chiefs -3.5');
    expect(email.text).toContain('Bills ML');
    expect(email.text).toContain('500.00');
    expect(email.text).toContain('-20.00');
  });

  it('says only what happened when there is no allowance', () => {
    const email = renderDigest(
      [
        row({
          type: 'BETS_SETTLED',
          channel: 'DIGEST',
          payload: { outcome: 'WON', netCents: '1500', subject: 'Chiefs -3.5' },
        }),
      ],
      BASE,
    );
    expect(email.subject).toBe('1 bet settled');
  });

  it('renders money from decimal strings, never from a JSON number', () => {
    const email = renderDigest(
      [
        row({
          type: 'ALLOWANCE_PAID',
          channel: 'DIGEST',
          payload: { amountCents: '900719925474099' },
        }),
      ],
      BASE,
    );
    // Past 2^53 a JSON number would have lost digits by now.
    expect(email.text).toContain('9007199254740.99');
  });
});
