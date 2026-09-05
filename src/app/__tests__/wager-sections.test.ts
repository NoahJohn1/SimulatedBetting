import { describe, expect, it } from 'vitest';
import { sectionFor, type WagerSectionInput } from '@/app/(app)/(column)/wagers/sections';

const VIEWER = 'membership-viewer';
const OTHER = 'membership-other';
const THIRD = 'membership-third';

/** A live, accepted wager between the viewer (offerer) and OTHER (acceptor), by default with
 * neither side having claimed yet — the shape most of these cases start from and override. */
function wager(overrides: Partial<WagerSectionInput> = {}): WagerSectionInput {
  return {
    status: 'ACCEPTED',
    offererMembershipId: VIEWER,
    acceptorMembershipId: OTHER,
    opponentMembershipId: OTHER,
    offererClaim: null,
    acceptorClaim: null,
    ...overrides,
  };
}

describe('sectionFor', () => {
  it('sends an accepted wager awaiting the viewer-as-offerer claim to AWAITING_YOUR_CALL', () => {
    expect(sectionFor(wager({ offererClaim: null }), VIEWER)).toBe('AWAITING_YOUR_CALL');
  });

  it('sends an accepted wager awaiting the viewer-as-acceptor claim to AWAITING_YOUR_CALL', () => {
    const asAcceptor = wager({
      offererMembershipId: OTHER,
      acceptorMembershipId: VIEWER,
      opponentMembershipId: null,
      acceptorClaim: null,
    });
    expect(sectionFor(asAcceptor, VIEWER)).toBe('AWAITING_YOUR_CALL');
  });

  /**
   * The walk's finding: `loadWagerBoard`'s `liveWagers` includes every accepted wager the
   * viewer is a party to, and `awaitingYourClaim` is a subset of it — so the old page, which
   * rendered both lists as separate sections, showed this exact wager twice: once under
   * "Awaiting your call" and again under "Live". `sectionFor` is the fix: first match wins,
   * so a wager that is both accepted *and* claimable lands in AWAITING_YOUR_CALL only.
   */
  it('resolves the double-listing case — accepted and claimable — to AWAITING_YOUR_CALL only', () => {
    const acceptedAndClaimable = wager({ offererClaim: null });
    const section = sectionFor(acceptedAndClaimable, VIEWER);
    expect(section).toBe('AWAITING_YOUR_CALL');
    expect(section).not.toBe('LIVE');
  });

  it('sends an accepted wager the viewer already claimed to LIVE, not AWAITING_YOUR_CALL', () => {
    expect(sectionFor(wager({ offererClaim: 'OFFERER' }), VIEWER)).toBe('LIVE');
  });

  it('sends an open, undirected offer to OPEN_TO_THE_SEASON', () => {
    const open = wager({
      status: 'OFFERED',
      offererMembershipId: OTHER,
      acceptorMembershipId: null,
      opponentMembershipId: null,
    });
    expect(sectionFor(open, VIEWER)).toBe('OPEN_TO_THE_SEASON');
  });

  it('sends an offer directed at the viewer to INVITES', () => {
    const directed = wager({
      status: 'OFFERED',
      offererMembershipId: OTHER,
      acceptorMembershipId: null,
      opponentMembershipId: VIEWER,
    });
    expect(sectionFor(directed, VIEWER)).toBe('INVITES');
  });

  it('sends the viewer’s own open offer to OPEN_TO_THE_SEASON, not INVITES', () => {
    const ownOpenOffer = wager({
      status: 'OFFERED',
      offererMembershipId: VIEWER,
      acceptorMembershipId: null,
      opponentMembershipId: null,
    });
    expect(sectionFor(ownOpenOffer, VIEWER)).toBe('OPEN_TO_THE_SEASON');
  });

  it('sends an offer directed at someone else to OPEN_TO_THE_SEASON, not INVITES', () => {
    const directedElsewhere = wager({
      status: 'OFFERED',
      offererMembershipId: VIEWER,
      acceptorMembershipId: null,
      opponentMembershipId: THIRD,
    });
    expect(sectionFor(directedElsewhere, VIEWER)).toBe('OPEN_TO_THE_SEASON');
  });

  it('sends a settled wager to SETTLED', () => {
    expect(sectionFor(wager({ status: 'SETTLED' }), VIEWER)).toBe('SETTLED');
  });

  it('sends a voided wager to SETTLED', () => {
    expect(sectionFor(wager({ status: 'VOIDED' }), VIEWER)).toBe('SETTLED');
  });
});
