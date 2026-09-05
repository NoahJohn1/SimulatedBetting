import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { BUCKETS } from '@/server/limits/policy';
import { resetDb } from '@/test/db';
import { makeUser } from '@/test/factories';

// saveAccentAction revalidates the root layout's path after writing, which throws outside a
// real request's async-storage context — unrelated to what these tests check, so it is
// stubbed out rather than worked around in the action, matching feed/__tests__/limits.test.ts.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const member = {
  ok: true as const,
  userId: '00000000-0000-4000-8000-000000000001',
  membershipId: '00000000-0000-4000-8000-0000000000a1',
  seasonId: '00000000-0000-4000-8000-0000000000b1',
  role: 'USER' as const,
  balanceCents: 0n,
};

vi.mock('@/server/auth/session', () => ({
  requireApprovedMemberOrThrow: vi.fn(async () => member),
}));

import { saveAccentAction } from '../actions';

beforeEach(async () => {
  await resetDb();
  await makeUser({ id: member.userId });
});

async function currentAccent() {
  const [row] = await db
    .select({ accent: users.accent })
    .from(users)
    .where(eq(users.id, member.userId));
  return row?.accent;
}

describe('saveAccentAction', () => {
  it("updates the signed-in member's own row, keyed off the session (D75)", async () => {
    const result = await saveAccentAction('BLUE');

    expect(result).toEqual({ saved: true });
    expect(await currentAccent()).toBe('BLUE');
  });

  it('rejects a value outside the curated six without writing', async () => {
    // @ts-expect-error — exercising the runtime guard against a value the type checker would
    // already reject, since the argument crosses a server-action RPC boundary at runtime.
    await expect(saveAccentAction('MAGENTA')).rejects.toThrow();
    expect(await currentAccent()).toBe('GREEN');
  });

  it('refuses past the DEFAULT rate limit without writing', async () => {
    for (let i = 0; i < BUCKETS.DEFAULT.limit; i++) {
      await saveAccentAction('TEAL');
    }
    const before = await currentAccent();

    const result = await saveAccentAction('ORANGE');

    expect(result).toMatchObject({ error: 'RATE_LIMITED' });
    expect(await currentAccent()).toBe(before);
  });
});
