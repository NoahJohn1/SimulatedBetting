import type { P2PVerdict, P2PWagerStatus } from '@/db/schema';

/**
 * Pure rules for peer-to-peer wagers. No I/O, no database, no clock of its own — `now` is
 * always passed in.
 *
 * The type imports above are types only, which is why this stays a leaf: `@/db/schema`
 * contributes no runtime code to this module. `custom-grading.ts` imports `Currency` and
 * `EventKind` the same way.
 */

export interface ClaimState {
  offererClaim: P2PVerdict | null;
  acceptorClaim: P2PVerdict | null;
}

/**
 * The offerer holds the selection; the acceptor holds its negation. So a wager's verdict is
 * a total mapping over the leg status the engine already computes — `gradeLeg` for a game,
 * `gradeCustomLeg` for a custom market. No new grading logic enters the system.
 *
 * PUSHED and VOIDED both refund: in one case nobody was right, in the other the event never
 * happened. Neither is a win for either party.
 */
export function verdictForLegStatus(status: 'WON' | 'LOST' | 'PUSHED' | 'VOIDED'): P2PVerdict {
  if (status === 'WON') return 'OFFERER';
  if (status === 'LOST') return 'ACCEPTOR';
  return 'VOID';
}

/** The winner takes both stakes. Derived, never stored — one fact, one home. */
export function potCents(offererStakeCents: bigint, acceptorStakeCents: bigint): bigint {
  return offererStakeCents + acceptorStakeCents;
}

/**
 * The verdict the two parties have agreed on, or null if they have not.
 *
 * A mutual `VOID` is a real agreement: two members who decide the bet was unresolvable
 * settle it as a refund without ever involving an admin (D47).
 */
export function agreedVerdict(claims: ClaimState): P2PVerdict | null {
  if (claims.offererClaim === null || claims.acceptorClaim === null) return null;
  return claims.offererClaim === claims.acceptorClaim ? claims.offererClaim : null;
}

/**
 * Both parties have spoken and they disagree.
 *
 * Derived rather than stored (D44). A stored flag would survive a party revising their
 * claim, leaving the wager parked in an admin queue it no longer belongs in.
 */
export function isDisputed(claims: ClaimState): boolean {
  return (
    claims.offererClaim !== null &&
    claims.acceptorClaim !== null &&
    claims.offererClaim !== claims.acceptorClaim
  );
}

/**
 * Past the resolve-by date with no agreed verdict — which covers silence from one side and
 * an outright disagreement alike. Both need an admin; the queue does not care which it is.
 */
export function isOverdue(w: { resolvesBy: Date } & ClaimState, now: Date): boolean {
  return w.resolvesBy.getTime() < now.getTime() && agreedVerdict(w) === null;
}

export interface HeadToHeadRow {
  offererMembershipId: string;
  acceptorMembershipId: string | null;
  status: P2PWagerStatus;
  verdict: P2PVerdict | null;
  offererStakeCents: bigint;
  acceptorStakeCents: bigint;
}

export interface HeadToHead {
  /** Wagers that produced a winner. Voids are counted separately, not here. */
  settled: number;
  aWon: number;
  bWon: number;
  voided: number;
  /** Positive means A is up on B, in credits. */
  netCentsForA: bigint;
}

/**
 * The head-to-head record between two members (D48).
 *
 * Only `SETTLED` and `VOIDED` wagers count — a `CANCELED` or `EXPIRED` offer never happened,
 * and an `OFFERED` or `ACCEPTED` one has not happened yet. Derived at read time, with no
 * stored counter to drift out of agreement with the rows, exactly as `computeMemberStats`
 * derives profile statistics.
 */
export function computeHeadToHead(
  rows: HeadToHeadRow[],
  memberA: string,
  memberB: string,
): HeadToHead {
  const result: HeadToHead = { settled: 0, aWon: 0, bWon: 0, voided: 0, netCentsForA: 0n };

  for (const row of rows) {
    if (row.acceptorMembershipId === null) continue;

    const pair =
      (row.offererMembershipId === memberA && row.acceptorMembershipId === memberB) ||
      (row.offererMembershipId === memberB && row.acceptorMembershipId === memberA);
    if (!pair) continue;

    if (row.status === 'VOIDED') {
      result.voided += 1;
      continue;
    }
    if (row.status !== 'SETTLED') continue;
    if (row.verdict === null) continue;
    if (row.verdict === 'VOID') {
      result.voided += 1;
      continue;
    }

    const aIsOfferer = row.offererMembershipId === memberA;
    const aWon = row.verdict === (aIsOfferer ? 'OFFERER' : 'ACCEPTOR');

    result.settled += 1;
    if (aWon) {
      result.aWon += 1;
      // A takes what B put up: B's stake, on whichever side B was.
      result.netCentsForA += aIsOfferer ? row.acceptorStakeCents : row.offererStakeCents;
    } else {
      result.bWon += 1;
      // A loses what A put up.
      result.netCentsForA -= aIsOfferer ? row.offererStakeCents : row.acceptorStakeCents;
    }
  }

  return result;
}
