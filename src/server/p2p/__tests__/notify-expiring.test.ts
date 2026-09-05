import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { notifications } from '@/db/schema';
import { sweepP2PWagers } from '@/server/p2p/sweep';
import { makeCreditedMembership, makeWager } from '@/test/factories';
import { resetDb } from '@/test/db';

const HOURS = 3_600_000;
const NOW = new Date('2026-09-03T12:00:00Z');

async function twoMembers() {
  const offerer = await makeCreditedMembership();
  const opponent = await makeCreditedMembership(100_000n, offerer.seasonId);
  return { offerer, opponent };
}

async function expiringRows() {
  return db.select().from(notifications).where(eq(notifications.type, 'OFFER_EXPIRING'));
}

beforeEach(resetDb);

describe('the expiring pass', () => {
  it('warns both parties on a directed offer inside the window', async () => {
    const { offerer, opponent } = await twoMembers();
    const wager = await makeWager({
      seasonId: offerer.seasonId,
      offererMembershipId: offerer.membership.id,
      opponentMembershipId: opponent.membership.id,
      expiresAt: new Date(NOW.getTime() + 6 * HOURS),
      resolvesBy: new Date(NOW.getTime() + 7 * 24 * HOURS),
    });

    const summary = await sweepP2PWagers(NOW);

    expect(summary.expiringFlagged).toBe(2);
    const rows = await expiringRows();
    expect(rows.map((r) => r.userId).sort()).toEqual([offerer.user.id, opponent.user.id].sort());
    expect(rows.map((r) => r.dedupeKey).sort()).toEqual(
      [
        `p2p:${wager.id}:expiring:${offerer.user.id}`,
        `p2p:${wager.id}:expiring:${opponent.user.id}`,
      ].sort(),
    );
  });

  it('warns only the offerer on an open offer — there is no opponent to warn', async () => {
    const { offerer } = await twoMembers();
    await makeWager({
      seasonId: offerer.seasonId,
      offererMembershipId: offerer.membership.id,
      expiresAt: new Date(NOW.getTime() + 6 * HOURS),
      resolvesBy: new Date(NOW.getTime() + 7 * 24 * HOURS),
    });

    await sweepP2PWagers(NOW);

    const rows = await expiringRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(offerer.user.id);
  });

  it('says nothing about an offer more than a day out', async () => {
    const { offerer, opponent } = await twoMembers();
    await makeWager({
      seasonId: offerer.seasonId,
      offererMembershipId: offerer.membership.id,
      opponentMembershipId: opponent.membership.id,
      expiresAt: new Date(NOW.getTime() + 48 * HOURS),
      resolvesBy: new Date(NOW.getTime() + 7 * 24 * HOURS),
    });

    await sweepP2PWagers(NOW);

    expect(await expiringRows()).toHaveLength(0);
  });

  it('warns once, not once per sweep', async () => {
    const { offerer, opponent } = await twoMembers();
    await makeWager({
      seasonId: offerer.seasonId,
      offererMembershipId: offerer.membership.id,
      opponentMembershipId: opponent.membership.id,
      expiresAt: new Date(NOW.getTime() + 6 * HOURS),
      resolvesBy: new Date(NOW.getTime() + 7 * 24 * HOURS),
    });

    await sweepP2PWagers(NOW);
    const second = await sweepP2PWagers(new Date(NOW.getTime() + 10 * 60_000));

    expect(second.expiringFlagged).toBe(0);
    expect(await expiringRows()).toHaveLength(2);
  });

  it('says nothing about an offer that has already lapsed', async () => {
    const { offerer, opponent } = await twoMembers();
    await makeWager({
      seasonId: offerer.seasonId,
      offererMembershipId: offerer.membership.id,
      opponentMembershipId: opponent.membership.id,
      expiresAt: new Date(NOW.getTime() - 1 * HOURS),
      resolvesBy: new Date(NOW.getTime() + 7 * 24 * HOURS),
    });

    await sweepP2PWagers(NOW);

    // expirePass ran first and closed it, so it is no longer OFFERED and cannot be warned about.
    expect(await expiringRows()).toHaveLength(0);
  });

  it('says nothing about an offer somebody already accepted', async () => {
    const { offerer, opponent } = await twoMembers();
    await makeWager({
      seasonId: offerer.seasonId,
      offererMembershipId: offerer.membership.id,
      acceptorMembershipId: opponent.membership.id,
      status: 'ACCEPTED',
      expiresAt: new Date(NOW.getTime() + 6 * HOURS),
      resolvesBy: new Date(NOW.getTime() + 7 * 24 * HOURS),
    });

    await sweepP2PWagers(NOW);

    expect(await expiringRows()).toHaveLength(0);
  });
});
