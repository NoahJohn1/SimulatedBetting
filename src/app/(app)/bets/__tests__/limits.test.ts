import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUCKETS } from '@/server/limits/policy';
import { resetDb } from '@/test/db';

const member = {
  ok: true as const,
  userId: '00000000-0000-4000-8000-000000000001',
  membershipId: '00000000-0000-4000-8000-0000000000a1',
  seasonId: '00000000-0000-4000-8000-0000000000b1',
  role: 'MEMBER' as const,
  balanceCents: 0n,
};

vi.mock('@/server/auth/session', () => ({
  requireApprovedMemberOrThrow: vi.fn(async () => member),
}));

vi.mock('@/server/bets/place', () => ({
  placeBet: vi.fn(async () => ({ ok: false, error: { code: 'NOT_A_MEMBER' } })),
}));

import { placeBet } from '@/server/bets/place';
import { placeBetAction } from '@/app/(app)/bets/actions';

const slip = {
  type: 'SINGLE' as const,
  stakeCents: '500',
  legs: [{ selectionId: 's1', line: null, priceAmerican: -110 }],
  clientRequestId: 'r1',
};

beforeEach(async () => {
  await resetDb();
  vi.mocked(placeBet).mockClear();
  // `decide()` reads the wall clock to compute `retryAfterSeconds`, which otherwise makes the
  // `retryAfterSeconds: 60` assertion below depend on which second of the real minute the test
  // happens to run in. Faking only `Date` (never timers) pins it to a window start without
  // touching the real DB I/O `consume` and `placeBetAction` depend on.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('placeBetAction', () => {
  it('refuses past the BET_PLACE limit without touching placeBet', async () => {
    for (let i = 0; i < BUCKETS.BET_PLACE.limit; i++) {
      await placeBetAction({ ...slip, clientRequestId: `r${i}` });
    }
    const callsBefore = vi.mocked(placeBet).mock.calls.length;

    const result = await placeBetAction({ ...slip, clientRequestId: 'last' });

    expect(result).toEqual({ ok: false, error: { code: 'RATE_LIMITED', retryAfterSeconds: 60 } });
    expect(vi.mocked(placeBet).mock.calls.length).toBe(callsBefore);
  });

  it('counts a rejected placement against the limit', async () => {
    // The service is mocked to reject every call, so this proves the counter is spent on the
    // attempt rather than on the outcome (D70).
    for (let i = 0; i <= BUCKETS.BET_PLACE.limit; i++) {
      await placeBetAction({ ...slip, clientRequestId: `x${i}` });
    }
    const result = await placeBetAction({ ...slip, clientRequestId: 'after' });
    expect(result).toMatchObject({ error: { code: 'RATE_LIMITED' } });
  });
});
