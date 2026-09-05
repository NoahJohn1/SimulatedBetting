import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signUnsubscribe, unsubscribeUrl, verifyUnsubscribe } from '@/server/notify/unsubscribe';

const USER = '11111111-1111-1111-1111-111111111111';

beforeEach(() => vi.stubEnv('AUTH_SECRET', 'test-secret'));
afterEach(() => vi.unstubAllEnvs());

describe('signUnsubscribe / verifyUnsubscribe', () => {
  it('round-trips a type scope', () => {
    const token = signUnsubscribe(USER, 'BETS_SETTLED');
    expect(verifyUnsubscribe(USER, 'BETS_SETTLED', token)).toBe('BETS_SETTLED');
  });

  it('round-trips the global scope', () => {
    const token = signUnsubscribe(USER, 'all');
    expect(verifyUnsubscribe(USER, 'all', token)).toBe('all');
  });

  it('rejects a tampered token', () => {
    const token = signUnsubscribe(USER, 'BETS_SETTLED');
    expect(verifyUnsubscribe(USER, 'BETS_SETTLED', `${token.slice(0, -1)}x`)).toBeNull();
  });

  it('rejects a token minted for another user', () => {
    const token = signUnsubscribe(USER, 'BETS_SETTLED');
    expect(
      verifyUnsubscribe('22222222-2222-2222-2222-222222222222', 'BETS_SETTLED', token),
    ).toBeNull();
  });

  it('rejects a token minted for a narrower scope — one link cannot widen itself', () => {
    const token = signUnsubscribe(USER, 'BETS_SETTLED');
    expect(verifyUnsubscribe(USER, 'all', token)).toBeNull();
  });

  it('rejects a scope that is not a notification type', () => {
    const token = signUnsubscribe(USER, 'BETS_SETTLED');
    expect(verifyUnsubscribe(USER, 'DROP TABLE users', token)).toBeNull();
  });

  it('rejects a token of the wrong length without throwing', () => {
    expect(verifyUnsubscribe(USER, 'all', 'short')).toBeNull();
  });

  it('rejects everything when AUTH_SECRET is unset, rather than accepting everything', () => {
    const token = signUnsubscribe(USER, 'all');
    vi.stubEnv('AUTH_SECRET', '');
    expect(verifyUnsubscribe(USER, 'all', token)).toBeNull();
  });

  it('builds a URL carrying user, scope and token', () => {
    const url = new URL(unsubscribeUrl('https://bets.example', USER, 'ALLOWANCE_PAID'));
    expect(url.pathname).toBe('/unsubscribe');
    expect(url.searchParams.get('u')).toBe(USER);
    expect(url.searchParams.get('s')).toBe('ALLOWANCE_PAID');
    expect(verifyUnsubscribe(USER, 'ALLOWANCE_PAID', url.searchParams.get('t')!)).toBe(
      'ALLOWANCE_PAID',
    );
  });

  it('points at the POST route when asked, for the RFC 8058 header', () => {
    const url = new URL(
      unsubscribeUrl('https://bets.example', USER, 'BETS_SETTLED', '/api/unsubscribe'),
    );
    expect(url.pathname).toBe('/api/unsubscribe');
  });
});
