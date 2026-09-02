import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { p2pWagers } from '@/db/schema';
import { acceptWager } from '@/server/p2p/accept';
import { claimWinner } from '@/server/p2p/claim';
import { offerWager } from '@/server/p2p/offer';
import { postEntry } from '@/server/money/ledger';
import { reconcileBalances, reconcileEscrow } from '@/server/money/reconcile';
import { resetDb } from '@/test/db';
import { makeCreditedMembership as rawCreditedMembership } from '@/test/factories';

/**
 * `makeCreditedMembership` (Task 1) seeds its credits balance directly rather than through the
 * ledger on purpose — 101 other call sites across the P2P suite depend on that (e.g.
 * `offer.test.ts`'s "refuses a stake the offerer cannot cover" asserts zero ledger rows exist
 * after setup). That means the cached balance and the ledger sum for a raw
 * `makeCreditedMembership` member disagree by exactly the seeded amount — a constant offset
 * unrelated to escrow, and one `reconcileBalances` would report on every single test in this
 * file regardless of whether escrow is doing the right thing.
 *
 * This file specifically wants `reconcileBalances` to be a legitimate `[]` alongside
 * `reconcileEscrow`, to demonstrate that the balance check cannot see escrow drift even when
 * it has nothing else to complain about. So here — and only here — the initial grant is seeded
 * at 0 and then posted for real through `postEntry`, leaving the member with the same starting
 * credits but a ledger that actually accounts for them.
 */
async function makeCreditedMembership(creditsCents = 100_000n, seasonId?: string) {
  const credited = await rawCreditedMembership(0n, seasonId);
  await db.transaction((tx) =>
    postEntry(tx, {
      membershipId: credited.membership.id,
      amountCents: creditsCents,
      type: 'SEASON_STARTING_GRANT',
      currency: 'CREDITS',
      idempotencyKey: `test-grant:${credited.membership.id}`,
    }),
  );
  return credited;
}

async function offerOnly(actorUserId: string) {
  const result = await offerWager({
    actorUserId,
    kind: 'FREEFORM',
    offererStakeCents: 50_000n,
    acceptorStakeCents: 20_000n,
    description: 'a test wager',
    expiresAt: new Date(Date.now() + 3_600_000),
    resolvesBy: new Date(Date.now() + 7 * 86_400_000),
  });
  if (!result.ok) throw new Error('expected the offer to succeed');
  return result.wagerId;
}

describe('reconcileEscrow', () => {
  beforeEach(resetDb);

  it('reports nothing when there are no wagers at all', async () => {
    await makeCreditedMembership(100_000n);
    expect(await reconcileEscrow()).toEqual([]);
  });

  it('accepts an OFFERED wager holding exactly one stake', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    await offerOnly(offerer.user.id);

    expect(await reconcileEscrow()).toEqual([]);
    expect(await reconcileBalances()).toEqual([]);
  });

  it('accepts an ACCEPTED wager holding both stakes', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const acceptor = await makeCreditedMembership(100_000n, offerer.seasonId);
    const wagerId = await offerOnly(offerer.user.id);
    await acceptWager({ wagerId, actorUserId: acceptor.user.id });

    expect(await reconcileEscrow()).toEqual([]);
  });

  it('accepts a settled wager holding nothing', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const acceptor = await makeCreditedMembership(100_000n, offerer.seasonId);
    const wagerId = await offerOnly(offerer.user.id);
    await acceptWager({ wagerId, actorUserId: acceptor.user.id });
    await claimWinner({ wagerId, actorUserId: offerer.user.id, verdict: 'OFFERER' });
    await claimWinner({ wagerId, actorUserId: acceptor.user.id, verdict: 'OFFERER' });

    expect(await reconcileEscrow()).toEqual([]);
    expect(await reconcileBalances()).toEqual([]);
  });

  it('accepts a corrected wager, where reversals net the payouts back out', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const acceptor = await makeCreditedMembership(100_000n, offerer.seasonId);
    const admin = await makeCreditedMembership(100_000n, offerer.seasonId);
    const wagerId = await offerOnly(offerer.user.id);
    await acceptWager({ wagerId, actorUserId: acceptor.user.id });
    await claimWinner({ wagerId, actorUserId: offerer.user.id, verdict: 'OFFERER' });
    await claimWinner({ wagerId, actorUserId: acceptor.user.id, verdict: 'OFFERER' });

    const { arbitrateWager } = await import('@/server/p2p/arbitrate');
    await arbitrateWager({
      wagerId,
      actorUserId: admin.user.id,
      verdict: 'ACCEPTOR',
      note: 'corrected',
    });

    expect(await reconcileEscrow()).toEqual([]);
  });

  it('catches a wager that escrowed and never paid out', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const acceptor = await makeCreditedMembership(100_000n, offerer.seasonId);
    const wagerId = await offerOnly(offerer.user.id);
    await acceptWager({ wagerId, actorUserId: acceptor.user.id });

    // Simulate the bug this check exists for: the wager is marked settled but no payout
    // entry was ever written, so 70,000 credits are stranded in the pot forever.
    await db
      .update(p2pWagers)
      .set({ status: 'SETTLED', verdict: 'OFFERER' })
      .where(eq(p2pWagers.id, wagerId));

    const discrepancies = await reconcileEscrow();

    expect(discrepancies).toEqual([
      {
        wagerId,
        status: 'SETTLED',
        expectedHeldCents: 0n,
        actualHeldCents: 70_000n,
      },
    ]);
    // The balance check cannot see it — which is precisely why this second check exists.
    expect(await reconcileBalances()).toEqual([]);
  });

  it('catches a wager paid out while still marked live', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const acceptor = await makeCreditedMembership(100_000n, offerer.seasonId);
    const wagerId = await offerOnly(offerer.user.id);
    await acceptWager({ wagerId, actorUserId: acceptor.user.id });

    // A payout with no status change: the pot is empty but the wager says it holds both.
    await db.transaction((tx) =>
      postEntry(tx, {
        membershipId: offerer.membership.id,
        amountCents: 70_000n,
        type: 'P2P_WON',
        currency: 'CREDITS',
        idempotencyKey: `p2p:${wagerId}:settled:1:won`,
        p2pWagerId: wagerId,
      }),
    );

    expect(await reconcileEscrow()).toEqual([
      {
        wagerId,
        status: 'ACCEPTED',
        expectedHeldCents: 70_000n,
        actualHeldCents: 0n,
      },
    ]);
  });

  it('catches an offer refunded without being closed', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const wagerId = await offerOnly(offerer.user.id);

    await db.transaction((tx) =>
      postEntry(tx, {
        membershipId: offerer.membership.id,
        amountCents: 50_000n,
        type: 'P2P_REFUND',
        currency: 'CREDITS',
        idempotencyKey: `p2p:${wagerId}:refund:bogus`,
        p2pWagerId: wagerId,
      }),
    );

    expect(await reconcileEscrow()).toEqual([
      {
        wagerId,
        status: 'OFFERED',
        expectedHeldCents: 50_000n,
        actualHeldCents: 0n,
      },
    ]);
  });
});
