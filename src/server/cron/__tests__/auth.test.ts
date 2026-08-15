import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authorizeCronRequest, jsonSafe } from '@/server/cron/auth';

const ORIGINAL = process.env.CRON_SECRET;

function request(headers: Record<string, string> = {}): Request {
  return new Request('https://example.com/api/cron/allowance', { headers });
}

describe('authorizeCronRequest', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret';
  });

  afterEach(() => {
    process.env.CRON_SECRET = ORIGINAL;
  });

  it('accepts the shared secret as a bearer token', () => {
    expect(authorizeCronRequest(request({ authorization: 'Bearer test-secret' }))).toBeNull();
  });

  it('rejects a missing authorization header with 401', () => {
    const denied = authorizeCronRequest(request());
    expect(denied?.status).toBe(401);
  });

  it('rejects a wrong secret with 401', () => {
    const denied = authorizeCronRequest(request({ authorization: 'Bearer nope' }));
    expect(denied?.status).toBe(401);
  });

  it('refuses everything when no secret is configured', () => {
    delete process.env.CRON_SECRET;
    const denied = authorizeCronRequest(request({ authorization: 'Bearer anything' }));
    // Failing closed matters: these endpoints move money, so a missing secret must never
    // read as "no auth required".
    expect(denied?.status).toBe(500);
  });
});

describe('jsonSafe', () => {
  it('renders bigint cents as strings so JSON.stringify cannot throw', () => {
    expect(jsonSafe({ centsPaid: 19_091n, count: 2 })).toEqual({
      centsPaid: '19091',
      count: 2,
    });
  });

  it('walks nested structures', () => {
    expect(jsonSafe({ runs: [{ paid: 5n }], nested: { deep: { value: 7n } } })).toEqual({
      runs: [{ paid: '5' }],
      nested: { deep: { value: '7' } },
    });
  });

  it('leaves ordinary values alone', () => {
    expect(jsonSafe({ a: 'x', b: null, c: true })).toEqual({ a: 'x', b: null, c: true });
  });
});
