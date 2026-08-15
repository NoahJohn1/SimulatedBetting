import { describe, expect, it } from 'vitest';
import { CENTS_PER_DOLLAR } from '@/domain/money';

describe('scaffold', () => {
  it('resolves the @/ path alias', () => {
    expect(CENTS_PER_DOLLAR).toBe(100n);
  });
});
