import { describe, expect, it } from 'vitest';
import { isTransactionPooler } from '@/db/client';

describe('isTransactionPooler', () => {
  it('detects Supabase Supavisor on the transaction-mode port', () => {
    expect(
      isTransactionPooler('postgres://u:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres'),
    ).toBe(true);
  });

  it('detects a pooler host on any port', () => {
    expect(
      isTransactionPooler('postgres://u:p@aws-0-us-east-1.pooler.supabase.com:5432/postgres'),
    ).toBe(true);
  });

  it('treats a direct connection as unpooled', () => {
    expect(isTransactionPooler('postgres://u:p@db.abcdefgh.supabase.co:5432/postgres')).toBe(
      false,
    );
  });

  it('treats local development as unpooled', () => {
    expect(isTransactionPooler('postgres://simbet:simbet@localhost:5433/simbet')).toBe(false);
  });

  it('does not throw on a malformed url', () => {
    expect(isTransactionPooler('not a url')).toBe(false);
  });
});
