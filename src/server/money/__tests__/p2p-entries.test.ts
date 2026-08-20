import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { ledgerEntries, seasonMemberships } from '@/db/schema';
import { postEntry } from '@/server/money/ledger';
import { resetDb } from '@/test/db';
import { makeCreditedMembership, makeWager } from '@/test/factories';

async function credits(membershipId: string) {
  const [row] = await db
    .select({ credits: seasonMemberships.creditsBalanceCents })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, membershipId));
  return row.credits;
}

describe('p2p ledger entries', () => {
  beforeEach(resetDb);

  it('escrows credits and attributes the entry to the wager', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const wager = await makeWager({
      seasonId: offerer.seasonId,
      offererMembershipId: offerer.membership.id,
    });

    const posted = await db.transaction((tx) =>
      postEntry(tx, {
        membershipId: offerer.membership.id,
        amountCents: -10_000n,
        type: 'P2P_ESCROW',
        currency: 'CREDITS',
        idempotencyKey: `p2p:${wager.id}:escrow:offerer`,
        p2pWagerId: wager.id,
      }),
    );

    expect(posted.applied).toBe(true);
    expect(posted.balanceCents).toBe(90_000n);
    expect(await credits(offerer.membership.id)).toBe(90_000n);

    const [entry] = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.p2pWagerId, wager.id));
    expect(entry.type).toBe('P2P_ESCROW');
    expect(entry.currency).toBe('CREDITS');
    expect(entry.betId).toBeNull();
  });

  it('pays the pot with P2P_WON and refunds with P2P_REFUND', async () => {
    const winner = await makeCreditedMembership(100_000n);
    const wager = await makeWager({
      seasonId: winner.seasonId,
      offererMembershipId: winner.membership.id,
    });

    await db.transaction((tx) =>
      postEntry(tx, {
        membershipId: winner.membership.id,
        amountCents: 30_000n,
        type: 'P2P_WON',
        currency: 'CREDITS',
        idempotencyKey: `p2p:${wager.id}:settled:1:won`,
        p2pWagerId: wager.id,
      }),
    );

    await db.transaction((tx) =>
      postEntry(tx, {
        membershipId: winner.membership.id,
        amountCents: 5_000n,
        type: 'P2P_REFUND',
        currency: 'CREDITS',
        idempotencyKey: `p2p:${wager.id}:settled:1:refund:${winner.membership.id}`,
        p2pWagerId: wager.id,
      }),
    );

    expect(await credits(winner.membership.id)).toBe(135_000n);

    const types = await db
      .select({ type: ledgerEntries.type })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.p2pWagerId, wager.id));
    expect(types.map((t) => t.type).sort()).toEqual(['P2P_REFUND', 'P2P_WON']);
  });

  it('is idempotent: replaying an escrow key moves nothing', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const wager = await makeWager({
      seasonId: offerer.seasonId,
      offererMembershipId: offerer.membership.id,
    });

    const key = `p2p:${wager.id}:escrow:offerer`;
    const input = {
      membershipId: offerer.membership.id,
      amountCents: -10_000n,
      type: 'P2P_ESCROW' as const,
      currency: 'CREDITS' as const,
      idempotencyKey: key,
      p2pWagerId: wager.id,
    };

    await db.transaction((tx) => postEntry(tx, input));
    const second = await db.transaction((tx) => postEntry(tx, input));

    expect(second.applied).toBe(false);
    expect(await credits(offerer.membership.id)).toBe(90_000n);

    const rows = await db
      .select()
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.p2pWagerId, wager.id), eq(ledgerEntries.idempotencyKey, key)));
    expect(rows).toHaveLength(1);
  });

  it('refuses an escrow larger than the credits balance', async () => {
    const offerer = await makeCreditedMembership(5_000n);
    const wager = await makeWager({
      seasonId: offerer.seasonId,
      offererMembershipId: offerer.membership.id,
    });

    await expect(
      db.transaction((tx) =>
        postEntry(tx, {
          membershipId: offerer.membership.id,
          amountCents: -10_000n,
          type: 'P2P_ESCROW',
          currency: 'CREDITS',
          idempotencyKey: `p2p:${wager.id}:escrow:offerer`,
          p2pWagerId: wager.id,
        }),
      ),
    ).rejects.toThrow(/INSUFFICIENT_FUNDS|cannot absorb/);

    expect(await credits(offerer.membership.id)).toBe(5_000n);
  });
});
