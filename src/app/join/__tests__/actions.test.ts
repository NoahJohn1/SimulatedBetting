import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { seasonMemberships } from '@/db/schema';
import { makeSeason, makeUser } from '@/test/factories';
import { resetDb } from '@/test/db';

vi.mock('@/server/auth/session', () => ({
  getSessionUser: vi.fn(),
}));

import { getSessionUser } from '@/server/auth/session';
import { joinSeasonAction } from '@/app/join/actions';

beforeEach(async () => {
  await resetDb();
});

describe('joinSeasonAction', () => {
  it('joins the currently active season, never a season id supplied by the caller', async () => {
    const user = await makeUser();
    vi.mocked(getSessionUser).mockResolvedValue({ id: user.id, email: user.email });

    const active = await makeSeason({ status: 'ACTIVE' });
    // A season the caller should not be able to name their way into — e.g. one they
    // played in last year, and whose id they still have lying around in an old bookmark.
    const other = await makeSeason({ status: 'COMPLETED' });

    const result = await joinSeasonAction();

    expect(result).toEqual({ ok: true });

    const memberships = await db
      .select()
      .from(seasonMemberships)
      .where(eq(seasonMemberships.userId, user.id));
    expect(memberships).toHaveLength(1);
    expect(memberships[0].seasonId).toBe(active.id);
    expect(memberships[0].seasonId).not.toBe(other.id);
  });

  it('returns NO_SEASON when nothing is active, even if a seasonId is supplied', async () => {
    const user = await makeUser();
    vi.mocked(getSessionUser).mockResolvedValue({ id: user.id, email: user.email });

    const other = await makeSeason({ status: 'COMPLETED' });

    const result = await joinSeasonAction();

    expect(result).toEqual({ ok: false, error: 'NO_SEASON' });

    const memberships = await db
      .select()
      .from(seasonMemberships)
      .where(eq(seasonMemberships.seasonId, other.id));
    expect(memberships).toHaveLength(0);
  });
});
