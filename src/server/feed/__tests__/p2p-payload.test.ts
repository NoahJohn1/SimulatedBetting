import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { feedEvents } from '@/db/schema';
import { emitFeedEvent } from '@/server/feed/emit';
import type {
  P2PAcceptedPayload,
  P2PDisputedPayload,
  P2POfferedPayload,
  P2PSettledPayload,
  P2PVoidedPayload,
} from '@/server/feed/payload';
import { resetDb } from '@/test/db';
import { makeCreditedMembership, makeWager } from '@/test/factories';

describe('p2p feed payloads', () => {
  beforeEach(resetDb);

  it('round-trips an offered card with money as strings', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const wager = await makeWager({
      seasonId: offerer.seasonId,
      offererMembershipId: offerer.membership.id,
    });

    const payload: P2POfferedPayload = {
      wagerId: wager.id,
      kind: 'FREEFORM',
      offererStakeCents: '50000',
      acceptorStakeCents: '20000',
      potCents: '70000',
      description: 'Jake cannot name ten starting quarterbacks',
      subject: null,
      directed: false,
      expiresAt: '2026-09-01T00:00:00.000Z',
    };

    await db.transaction((tx) =>
      emitFeedEvent(tx, {
        seasonId: offerer.seasonId,
        type: 'P2P_OFFERED',
        subjectMembershipId: offerer.membership.id,
        dedupeKey: `p2p:${wager.id}:offered`,
        payload,
        occurredAt: new Date('2026-08-20T00:00:00Z'),
      }),
    );

    const [card] = await db.select().from(feedEvents).where(eq(feedEvents.type, 'P2P_OFFERED'));

    expect(card.dedupeKey).toBe(`p2p:${wager.id}:offered`);
    expect(card.payload).toMatchObject({ potCents: '70000', directed: false });
    expect(typeof (card.payload as P2POfferedPayload).potCents).toBe('string');
  });

  it('is deduped: emitting the same offered key twice writes one row', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const wager = await makeWager({
      seasonId: offerer.seasonId,
      offererMembershipId: offerer.membership.id,
    });

    const payload: P2POfferedPayload = {
      wagerId: wager.id,
      kind: 'FREEFORM',
      offererStakeCents: '10000',
      acceptorStakeCents: '10000',
      potCents: '20000',
      description: 'a test wager',
      subject: null,
      directed: false,
      expiresAt: '2026-09-01T00:00:00.000Z',
    };

    const emit = () =>
      db.transaction((tx) =>
        emitFeedEvent(tx, {
          seasonId: offerer.seasonId,
          type: 'P2P_OFFERED',
          subjectMembershipId: offerer.membership.id,
          dedupeKey: `p2p:${wager.id}:offered`,
          payload,
        }),
      );

    const first = await emit();
    const second = await emit();

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(await db.select().from(feedEvents)).toHaveLength(1);
  });

  it('accepts every one of the five new types', async () => {
    const offerer = await makeCreditedMembership(100_000n);
    const acceptor = await makeCreditedMembership(100_000n, offerer.seasonId);
    const wager = await makeWager({
      seasonId: offerer.seasonId,
      offererMembershipId: offerer.membership.id,
      acceptorMembershipId: acceptor.membership.id,
      status: 'ACCEPTED',
    });

    const accepted: P2PAcceptedPayload = {
      wagerId: wager.id,
      kind: 'FREEFORM',
      potCents: '20000',
      offererStakeCents: '10000',
      acceptorStakeCents: '10000',
      subject: 'a test wager',
    };
    const settled: P2PSettledPayload = {
      wagerId: wager.id,
      kind: 'FREEFORM',
      verdict: 'OFFERER',
      potCents: '20000',
      subject: 'a test wager',
      attempt: 1,
      correction: false,
      byArbitration: false,
    };
    const disputed: P2PDisputedPayload = {
      wagerId: wager.id,
      subject: 'a test wager',
      attempt: 1,
    };
    const voided: P2PVoidedPayload = {
      wagerId: wager.id,
      subject: 'a test wager',
      reason: 'MUTUAL_CANCEL',
      refundedCents: '20000',
      attempt: 1,
      note: null,
      adminDisplayName: null,
    };

    await db.transaction(async (tx) => {
      await emitFeedEvent(tx, {
        seasonId: offerer.seasonId,
        type: 'P2P_ACCEPTED',
        subjectMembershipId: acceptor.membership.id,
        dedupeKey: `p2p:${wager.id}:accepted`,
        payload: accepted,
      });
      await emitFeedEvent(tx, {
        seasonId: offerer.seasonId,
        type: 'P2P_SETTLED',
        subjectMembershipId: offerer.membership.id,
        dedupeKey: `p2p:${wager.id}:settled:1`,
        payload: settled,
      });
      await emitFeedEvent(tx, {
        seasonId: offerer.seasonId,
        type: 'P2P_DISPUTED',
        subjectMembershipId: acceptor.membership.id,
        dedupeKey: `p2p:${wager.id}:disputed:1`,
        payload: disputed,
      });
      await emitFeedEvent(tx, {
        seasonId: offerer.seasonId,
        type: 'P2P_VOIDED',
        dedupeKey: `p2p:${wager.id}:voided:1`,
        payload: voided,
      });
    });

    const rows = await db.select().from(feedEvents);
    expect(rows.map((r) => r.type).sort()).toEqual([
      'P2P_ACCEPTED',
      'P2P_DISPUTED',
      'P2P_SETTLED',
      'P2P_VOIDED',
    ]);
    // A void belongs to the wager, not to either member.
    expect(rows.find((r) => r.type === 'P2P_VOIDED')!.subjectMembershipId).toBeNull();
  });
});
