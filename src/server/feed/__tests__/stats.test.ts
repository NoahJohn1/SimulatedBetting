import { beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { games, seasonMemberships } from '@/db/schema';
import { placeBet } from '@/server/bets/place';
import { settleGame } from '@/server/bets/settle';
import { getMemberProfile } from '@/server/feed/stats';
import { resetDb } from '@/test/db';
import { makeMembership, makeSeason, seedBettableGame } from '@/server/bets/__tests__/helpers';
import { makeUser } from '@/test/factories';

describe('getMemberProfile', () => {
  beforeEach(resetDb);

  it('reports a settled win in the stats block', async () => {
    const { membership, user, seasonId } = await makeMembership();
    const game = await seedBettableGame();

    await placeBet({
      userId: user.id,
      type: 'SINGLE',
      stakeCents: 10_000n,
      legs: [{ selectionId: game.moneyline.home, line: null, priceAmerican: -110 }],
      clientRequestId: randomUUID(),
    });

    await db
      .update(games)
      .set({ status: 'FINAL', homeScore: 27, awayScore: 20 })
      .where(eq(games.id, game.game.id));
    await settleGame(game.game.id);

    const profile = await getMemberProfile({ membershipId: membership.id, seasonId });

    expect(profile?.displayName).toBe(user.displayName);
    expect(profile?.stats.won).toBe(1);
    expect(profile?.stats.netCents).toBe(9_091n);
    expect(profile?.stats.currentStreak).toEqual({ kind: 'W', length: 1 });
    expect(profile?.rank).toBe(1);
  });

  it('ranks by balance within the season', async () => {
    const { membership, seasonId } = await makeMembership(1_000_000n);
    const richer = await makeUser();
    await db
      .insert(seasonMemberships)
      .values({ userId: richer.id, seasonId, balanceCents: 2_000_000n });

    const profile = await getMemberProfile({ membershipId: membership.id, seasonId });
    expect(profile?.rank).toBe(2);
  });

  it('returns null for a membership in another season', async () => {
    const { membership } = await makeMembership();
    // Only one ACTIVE season may exist at a time (seasons_one_active_idx), so the second
    // season here has to be a real, distinct, non-active one rather than another default.
    const otherSeason = await makeSeason({ status: 'UPCOMING' });
    const other = await makeMembership(1_000_000n, otherSeason.id);

    const profile = await getMemberProfile({
      membershipId: membership.id,
      seasonId: other.seasonId,
    });
    expect(profile).toBeNull();
  });
});
