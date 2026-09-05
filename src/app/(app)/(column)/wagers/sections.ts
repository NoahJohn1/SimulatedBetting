import type { WagerSummary } from '@/server/p2p/query';

export type WagerSection =
  'AWAITING_YOUR_CALL' | 'INVITES' | 'OPEN_TO_THE_SEASON' | 'LIVE' | 'SETTLED';

/** The subset of `WagerSummary` `sectionFor` reads — kept narrow so a unit test can build one
 * without a whole board row. */
export type WagerSectionInput = Pick<
  WagerSummary,
  | 'status'
  | 'offererMembershipId'
  | 'acceptorMembershipId'
  | 'opponentMembershipId'
  | 'offererClaim'
  | 'acceptorClaim'
>;

/**
 * One section per wager, first match wins (Task 9). The walk found a wager double-listed:
 * `loadWagerBoard`'s `liveWagers` and `awaitingYourClaim` overlap by construction — every
 * wager awaiting the viewer's claim is also accepted, hence also in `liveWagers` — and the old
 * page rendered both lists as separate sections. This function is the single place that picks
 * one home for a wager; the page buckets its pooled rows through it instead of rendering the
 * board's lists directly.
 *
 * `now`-based filters (an offer's `expiresAt`, an accepted wager's overdue window) stay in
 * `loadWagerBoard` — this function only re-derives which section a wager the board already
 * decided to show the viewer belongs in, never whether to show it at all.
 */
export function sectionFor(wager: WagerSectionInput, viewerMembershipId: string): WagerSection {
  const isOfferer = wager.offererMembershipId === viewerMembershipId;
  const isAcceptor = wager.acceptorMembershipId === viewerMembershipId;

  const needsYourVerdict =
    wager.status === 'ACCEPTED' &&
    (isOfferer || isAcceptor) &&
    (isOfferer ? wager.offererClaim === null : wager.acceptorClaim === null);
  if (needsYourVerdict) return 'AWAITING_YOUR_CALL';

  if (wager.status === 'OFFERED') {
    return wager.opponentMembershipId === viewerMembershipId ? 'INVITES' : 'OPEN_TO_THE_SEASON';
  }

  if (wager.status === 'ACCEPTED') return 'LIVE';

  return 'SETTLED';
}
