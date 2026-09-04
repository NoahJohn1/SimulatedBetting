import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUCKETS } from '@/server/limits/policy';
import { resetDb } from '@/test/db';

// The action calls `revalidatePath` after the service resolves, which throws outside a real
// request's async-storage context. Unrelated to what this test is verifying (the rate limit),
// so it is stubbed out rather than worked around in the action.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

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

vi.mock('@/server/feed/social', async () => {
  const actual =
    await vi.importActual<typeof import('@/server/feed/social')>('@/server/feed/social');
  return { ...actual, addComment: vi.fn(async () => ({ commentId: 'c1' })) };
});

import { addComment } from '@/server/feed/social';
import { addCommentAction } from '@/app/(app)/feed/actions';

beforeEach(async () => {
  await resetDb();
  vi.mocked(addComment).mockClear();
});

describe('addCommentAction', () => {
  it('refuses past the COMMENT limit without calling the service', async () => {
    for (let i = 0; i < BUCKETS.COMMENT.limit; i++) {
      await addCommentAction('e1', 'hello');
    }
    const callsBefore = vi.mocked(addComment).mock.calls.length;

    const result = await addCommentAction('e1', 'hello');

    expect(result).toMatchObject({ error: 'RATE_LIMITED' });
    expect(vi.mocked(addComment).mock.calls.length).toBe(callsBefore);
  });
});
