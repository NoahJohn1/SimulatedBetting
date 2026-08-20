import { and, desc, eq, inArray, or, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '@/db/client';
import { p2pWagers, seasonMemberships, users } from '@/db/schema';
import type { P2PVerdict, P2PWagerKind, P2PWagerStatus } from '@/db/schema';
import {
  agreedVerdict,
  computeHeadToHead,
  isDisputed,
  isOverdue,
  potCents,
  type HeadToHead,
} from '@/domain/p2p';
import { loadSelectionSubject } from './subject';

const offererUsers = alias(users, 'p2p_offerer_users');
const acceptorUsers = alias(users, 'p2p_acceptor_users');
const offererMemberships = alias(seasonMemberships, 'p2p_offerer_memberships');
const acceptorMemberships = alias(seasonMemberships, 'p2p_acceptor_memberships');

export interface WagerSummary {
  id: string;
  kind: P2PWagerKind;
  status: P2PWagerStatus;
  subject: string;
  offererMembershipId: string;
  offererDisplayName: string;
  acceptorMembershipId: string | null;
  acceptorDisplayName: string | null;
  opponentMembershipId: string | null;
  offererStakeCents: bigint;
  acceptorStakeCents: bigint;
  potCents: bigint;
  verdict: P2PVerdict | null;
  offererClaim: P2PVerdict | null;
  acceptorClaim: P2PVerdict | null;
  disputed: boolean;
  overdue: boolean;
  expiresAt: Date;
  resolvesBy: Date;
  createdAt: Date;
}

export interface WagerBoard {
  /** Open to the season and takeable by the viewer. */
  openOffers: WagerSummary[];
  /** Directed at the viewer. */
  offersToYou: WagerSummary[];
  /** The viewer's own offers, still unaccepted. */
  yourOffers: WagerSummary[];
  /** Accepted and not yet decided, with the viewer as a party. */
  liveWagers: WagerSummary[];
  /** Live wagers where the viewer has not yet said who won. */
  awaitingYourClaim: WagerSummary[];
  /** Finished, with the viewer as a party. */
  settledWagers: WagerSummary[];
}

/** What this viewer is allowed to do. Computed server-side; the UI only renders it. */
export interface ViewerActions {
  canAccept: boolean;
  canDecline: boolean;
  canCancel: boolean;
  canClaim: boolean;
  canProposeCancel: boolean;
}

export interface WagerDetail extends WagerSummary {
  description: string | null;
  lineAtOffer: string | null;
  selectionId: string | null;
  resolutionNote: string | null;
  settlementAttempts: number;
  offererCancelProposed: boolean;
  acceptorCancelProposed: boolean;
  settledAt: Date | null;
  actions: ViewerActions;
}

/**
 * Every wager read goes through this shape, so the subject line and the derived
 * dispute/overdue flags are computed in exactly one place.
 *
 * The two `users` joins are aliased because both sides of a wager are members, and joining
 * the same table twice unaliased silently collapses them into one.
 */
async function loadSummaries(where: SQL | undefined, now: Date): Promise<WagerSummary[]> {
  const rows = await db
    .select({
      wager: p2pWagers,
      offererDisplayName: offererUsers.displayName,
      acceptorDisplayName: acceptorUsers.displayName,
    })
    .from(p2pWagers)
    .innerJoin(offererMemberships, eq(p2pWagers.offererMembershipId, offererMemberships.id))
    .innerJoin(offererUsers, eq(offererMemberships.userId, offererUsers.id))
    .leftJoin(acceptorMemberships, eq(p2pWagers.acceptorMembershipId, acceptorMemberships.id))
    .leftJoin(acceptorUsers, eq(acceptorMemberships.userId, acceptorUsers.id))
    .where(where)
    .orderBy(desc(p2pWagers.createdAt));

  // Subjects for market-backed wagers need a second read each. The board is a handful of
  // rows in a private league, so a per-row lookup is the right trade against a fourth join.
  return Promise.all(
    rows.map(async ({ wager, offererDisplayName, acceptorDisplayName }) => {
      const subject =
        wager.kind === 'FREEFORM'
          ? (wager.description ?? '')
          : ((await loadSelectionSubject(wager.selectionId!))?.subject ?? '');

      return {
        id: wager.id,
        kind: wager.kind,
        status: wager.status,
        subject,
        offererMembershipId: wager.offererMembershipId,
        offererDisplayName,
        acceptorMembershipId: wager.acceptorMembershipId,
        acceptorDisplayName,
        opponentMembershipId: wager.opponentMembershipId,
        offererStakeCents: wager.offererStakeCents,
        acceptorStakeCents: wager.acceptorStakeCents,
        potCents: potCents(wager.offererStakeCents, wager.acceptorStakeCents),
        verdict: wager.verdict,
        offererClaim: wager.offererClaim,
        acceptorClaim: wager.acceptorClaim,
        disputed: wager.status === 'ACCEPTED' && isDisputed(wager),
        overdue: wager.status === 'ACCEPTED' && isOverdue(wager, now),
        expiresAt: wager.expiresAt,
        resolvesBy: wager.resolvesBy,
        createdAt: wager.createdAt,
      };
    }),
  );
}

export async function loadWagerBoard(
  membershipId: string,
  seasonId: string,
  now: Date = new Date(),
): Promise<WagerBoard> {
  const all = await loadSummaries(eq(p2pWagers.seasonId, seasonId), now);

  const isParty = (w: WagerSummary) =>
    w.offererMembershipId === membershipId || w.acceptorMembershipId === membershipId;

  const live = all.filter((w) => w.status === 'ACCEPTED' && isParty(w));

  return {
    openOffers: all.filter(
      (w) =>
        w.status === 'OFFERED' &&
        w.opponentMembershipId === null &&
        w.offererMembershipId !== membershipId &&
        w.expiresAt.getTime() > now.getTime(),
    ),
    offersToYou: all.filter(
      (w) =>
        w.status === 'OFFERED' &&
        w.opponentMembershipId === membershipId &&
        w.expiresAt.getTime() > now.getTime(),
    ),
    yourOffers: all.filter(
      (w) => w.status === 'OFFERED' && w.offererMembershipId === membershipId,
    ),
    liveWagers: live,
    awaitingYourClaim: live.filter((w) =>
      w.offererMembershipId === membershipId ? w.offererClaim === null : w.acceptorClaim === null,
    ),
    settledWagers: all.filter(
      (w) => (w.status === 'SETTLED' || w.status === 'VOIDED') && isParty(w),
    ),
  };
}

export async function loadWagerDetail(
  wagerId: string,
  viewerMembershipId: string,
  now: Date = new Date(),
): Promise<WagerDetail | null> {
  const [summary] = await loadSummaries(eq(p2pWagers.id, wagerId), now);
  if (!summary) return null;

  const [wager] = await db.select().from(p2pWagers).where(eq(p2pWagers.id, wagerId));

  const isOfferer = summary.offererMembershipId === viewerMembershipId;
  const isAcceptor = summary.acceptorMembershipId === viewerMembershipId;
  const open = summary.status === 'OFFERED' && summary.expiresAt.getTime() > now.getTime();
  const invited =
    summary.opponentMembershipId === null || summary.opponentMembershipId === viewerMembershipId;

  const actions: ViewerActions = {
    canAccept: open && !isOfferer && invited,
    // Only a directed offer can be declined — nobody has standing to refuse an open one.
    canDecline: open && !isOfferer && summary.opponentMembershipId === viewerMembershipId,
    canCancel: open && isOfferer,
    // A dispute does not take away either party's ability to concede.
    canClaim: summary.status === 'ACCEPTED' && (isOfferer || isAcceptor),
    canProposeCancel: summary.status === 'ACCEPTED' && (isOfferer || isAcceptor),
  };

  return {
    ...summary,
    description: wager.description,
    lineAtOffer: wager.lineAtOffer,
    selectionId: wager.selectionId,
    resolutionNote: wager.resolutionNote,
    settlementAttempts: wager.settlementAttempts,
    offererCancelProposed: wager.offererCancelProposed,
    acceptorCancelProposed: wager.acceptorCancelProposed,
    settledAt: wager.settledAt,
    actions,
  };
}

/**
 * The head-to-head record between two members (D48).
 *
 * Derived from the rows at read time with no stored counter, so it can never disagree with
 * the wagers it summarizes. The aggregation itself is the pure `computeHeadToHead`; this
 * function's only job is fetching the rows it operates on.
 */
export async function loadHeadToHead(
  seasonId: string,
  memberA: string,
  memberB: string,
): Promise<HeadToHead> {
  const rows = await db
    .select({
      offererMembershipId: p2pWagers.offererMembershipId,
      acceptorMembershipId: p2pWagers.acceptorMembershipId,
      status: p2pWagers.status,
      verdict: p2pWagers.verdict,
      offererStakeCents: p2pWagers.offererStakeCents,
      acceptorStakeCents: p2pWagers.acceptorStakeCents,
    })
    .from(p2pWagers)
    .where(
      and(
        eq(p2pWagers.seasonId, seasonId),
        inArray(p2pWagers.status, ['SETTLED', 'VOIDED']),
        or(
          and(
            eq(p2pWagers.offererMembershipId, memberA),
            eq(p2pWagers.acceptorMembershipId, memberB),
          ),
          and(
            eq(p2pWagers.offererMembershipId, memberB),
            eq(p2pWagers.acceptorMembershipId, memberA),
          ),
        ),
      ),
    );

  return computeHeadToHead(rows, memberA, memberB);
}

/**
 * What an admin has to rule on: wagers where the two parties have not agreed and cannot be
 * left to sort it out.
 *
 * Both conditions are derived from the claim columns and the clock rather than read from a
 * status (D44), so a wager leaves this queue the moment one party concedes — no job has to
 * remember to take it out.
 */
export async function loadArbitrationQueue(
  seasonId: string,
  now: Date = new Date(),
): Promise<WagerSummary[]> {
  const accepted = await loadSummaries(
    and(eq(p2pWagers.seasonId, seasonId), eq(p2pWagers.status, 'ACCEPTED')),
    now,
  );

  return accepted.filter(
    (w) =>
      w.disputed ||
      (w.overdue && agreedVerdict({ offererClaim: w.offererClaim, acceptorClaim: w.acceptorClaim }) === null),
  );
}
