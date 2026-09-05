import { and, eq, gt, lt, lte } from 'drizzle-orm';
import { db } from '@/db/client';
import { customEvents, events, games, markets, p2pWagers, selections } from '@/db/schema';
import type { MarketType, Side } from '@/domain/grading';
import { gradeLeg } from '@/domain/grading';
import { gradeCustomLeg } from '@/domain/custom-grading';
import { lineToNumber } from '@/domain/line';
import { isOverdue, verdictForLegStatus } from '@/domain/p2p';
import { emitFeedEvent } from '@/server/feed/emit';
import type { P2PDisputedPayload } from '@/server/feed/payload';
import { enqueueNotification } from '@/server/notify/enqueue';
import { adminUserIds, userIdForMembership } from '@/server/notify/recipients';
import { postEntry } from '@/server/money/ledger';
import { settleWagerInTx } from './settle-wager';
import { loadSelectionSubject } from './subject';
import type { P2PVerdict } from './types';

export interface SweepP2PSummary {
  expired: number;
  settled: number;
  overdueFlagged: number;
  expiringFlagged: number;
  errors: { wagerId: string; message: string }[];
}

/**
 * Four passes over the wager table, run from the `settle` cron route.
 *
 * It rides an existing schedule rather than getting its own, and keeps no cursor, for the
 * same reason `sweepOverdueEvents` does (D37): one fewer entry to keep in sync and nothing
 * that can get stuck.
 *
 * Every wager is handled in its own transaction, so one failure cannot roll back the others
 * — the resumability `settleFinalGames` needs for the invocation limit (D3), applied here.
 */
export async function sweepP2PWagers(now: Date = new Date()): Promise<SweepP2PSummary> {
  const summary: SweepP2PSummary = {
    expired: 0,
    settled: 0,
    overdueFlagged: 0,
    expiringFlagged: 0,
    errors: [],
  };

  await expirePass(now, summary);
  await settlePass(now, summary);
  await overduePass(now, summary);
  await expiringPass(now, summary);

  return summary;
}

/** Pass 1: unaccepted offers past their date. Refund the offerer, close the offer. */
async function expirePass(now: Date, summary: SweepP2PSummary): Promise<void> {
  const stale = await db
    .select({ id: p2pWagers.id })
    .from(p2pWagers)
    .where(and(eq(p2pWagers.status, 'OFFERED'), lt(p2pWagers.expiresAt, now)));

  for (const { id } of stale) {
    try {
      await db.transaction(async (tx) => {
        const [wager] = await tx.select().from(p2pWagers).where(eq(p2pWagers.id, id)).for('update');
        // Re-read under the lock: an acceptance may have landed since the scan.
        if (!wager || wager.status !== 'OFFERED') return;

        await tx
          .update(p2pWagers)
          .set({ status: 'EXPIRED', settledAt: now })
          .where(eq(p2pWagers.id, wager.id));

        await postEntry(tx, {
          membershipId: wager.offererMembershipId,
          amountCents: wager.offererStakeCents,
          type: 'P2P_REFUND',
          currency: 'CREDITS',
          idempotencyKey: `p2p:${wager.id}:refund:expired:${wager.offererMembershipId}`,
          p2pWagerId: wager.id,
        });

        // No feed card: an ignored offer is a non-event, exactly as a withdrawn one is.
        summary.expired += 1;
      });
    } catch (err) {
      summary.errors.push({ wagerId: id, message: (err as Error).message });
    }
  }
}

/**
 * Pass 2: accepted MARKET wagers whose underlying result has arrived.
 *
 * A FREEFORM wager is never touched here. Only people settle those (D47).
 */
async function settlePass(now: Date, summary: SweepP2PSummary): Promise<void> {
  const live = await db
    .select({
      wagerId: p2pWagers.id,
      selectionId: p2pWagers.selectionId,
      lineAtOffer: p2pWagers.lineAtOffer,
      marketType: markets.type,
      marketStatus: markets.status,
      winningSelectionId: markets.winningSelectionId,
      side: selections.side,
      eventKind: events.kind,
      gameStatus: games.status,
      homeScore: games.homeScore,
      awayScore: games.awayScore,
      customStatus: customEvents.status,
    })
    .from(p2pWagers)
    .innerJoin(selections, eq(p2pWagers.selectionId, selections.id))
    .innerJoin(markets, eq(selections.marketId, markets.id))
    .innerJoin(events, eq(markets.eventId, events.id))
    .leftJoin(games, eq(games.eventId, events.id))
    .leftJoin(customEvents, eq(customEvents.eventId, events.id))
    .where(and(eq(p2pWagers.status, 'ACCEPTED'), eq(p2pWagers.kind, 'MARKET')));

  for (const row of live) {
    try {
      const decision = decideMarketVerdict(row);
      if (decision === null) continue;

      await db.transaction(async (tx) => {
        const [wager] = await tx
          .select({ status: p2pWagers.status })
          .from(p2pWagers)
          .where(eq(p2pWagers.id, row.wagerId))
          .for('update');
        // Re-read under the lock: the two parties may have settled it themselves since.
        if (!wager || wager.status !== 'ACCEPTED') return;

        await settleWagerInTx(tx, {
          wagerId: row.wagerId,
          verdict: decision.verdict,
          settledAt: now,
          reason: decision.reason,
          byArbitration: false,
        });
        summary.settled += 1;
      });
    } catch (err) {
      summary.errors.push({ wagerId: row.wagerId, message: (err as Error).message });
    }
  }
}

/**
 * The verdict a market-backed wager has earned, or null if its result has not arrived.
 *
 * The offerer holds the selection and the acceptor holds its negation, so this is entirely
 * `gradeLeg` / `gradeCustomLeg` plus `verdictForLegStatus` — no new grading logic.
 */
function decideMarketVerdict(row: {
  selectionId: string | null;
  lineAtOffer: string | null;
  marketType: string;
  winningSelectionId: string | null;
  side: string | null;
  eventKind: 'GAME' | 'CUSTOM';
  gameStatus: string | null;
  homeScore: number | null;
  awayScore: number | null;
  customStatus: string | null;
}): { verdict: P2PVerdict; reason: 'EVENT_DEAD' } | null {
  if (row.eventKind === 'GAME') {
    if (row.gameStatus === 'POSTPONED' || row.gameStatus === 'CANCELED') {
      return { verdict: 'VOID', reason: 'EVENT_DEAD' };
    }
    if (row.gameStatus !== 'FINAL') return null;
    if (row.homeScore === null || row.awayScore === null) return null;

    const status = gradeLeg({
      marketType: row.marketType as MarketType,
      side: row.side as Side,
      // The frozen line, never the live one — a line that moved after the offer must not
      // change what was agreed (D10).
      line: lineToNumber(row.lineAtOffer),
      result: { homeScore: row.homeScore, awayScore: row.awayScore },
    });
    return { verdict: verdictForLegStatus(status), reason: 'EVENT_DEAD' };
  }

  if (row.customStatus === 'VOIDED') return { verdict: 'VOID', reason: 'EVENT_DEAD' };
  if (row.winningSelectionId === null) return null;

  const status = gradeCustomLeg({
    selectionId: row.selectionId!,
    winningSelectionId: row.winningSelectionId,
  });
  if (status === 'PENDING') return null;
  return { verdict: verdictForLegStatus(status), reason: 'EVENT_DEAD' };
}

/**
 * Pass 3: accepted wagers past their resolve-by date with no agreed verdict.
 *
 * It moves no money and changes no status — overdue is derived, not stored (D44). Its whole
 * job is to make a forgotten wager impossible to ignore; an admin then arbitrates.
 *
 * The card is a `P2P_DISPUTED` rather than a type of its own: from the season's point of
 * view "these two have not agreed" is the same announcement whether they disagreed out loud
 * or one of them went quiet, and the admin queue treats them identically.
 */
async function overduePass(now: Date, summary: SweepP2PSummary): Promise<void> {
  const live = await db
    .select()
    .from(p2pWagers)
    .where(and(eq(p2pWagers.status, 'ACCEPTED'), lt(p2pWagers.resolvesBy, now)));

  for (const wager of live) {
    if (!isOverdue(wager, now)) continue;

    try {
      const subject =
        wager.kind === 'FREEFORM'
          ? (wager.description ?? '')
          : ((await loadSelectionSubject(wager.selectionId!))?.subject ?? '');

      const payload: P2PDisputedPayload = {
        wagerId: wager.id,
        subject,
        attempt: wager.settlementAttempts + 1,
      };

      const emitted = await db.transaction(async (tx) => {
        const result = await emitFeedEvent(tx, {
          seasonId: wager.seasonId,
          type: 'P2P_DISPUTED',
          subjectMembershipId: wager.offererMembershipId,
          dedupeKey: `p2p:${wager.id}:overdue:${wager.settlementAttempts + 1}`,
          payload,
          occurredAt: now,
        });

        // An overdue wager is a dispute nobody filed. The admin queue treats the two
        // identically, so the notification does too.
        for (const adminUserId of await adminUserIds(tx)) {
          await enqueueNotification(tx, {
            userId: adminUserId,
            type: 'DISPUTE_NEEDS_RULING',
            dedupeKey: `p2p:${wager.id}:overdue:${wager.settlementAttempts + 1}:${adminUserId}`,
            payload: { wagerId: wager.id, subject, kind: 'P2P_OVERDUE' },
          });
        }

        return result;
      });

      if (emitted.applied) summary.overdueFlagged += 1;
    } catch (err) {
      summary.errors.push({ wagerId: wager.id, message: (err as Error).message });
    }
  }
}

const EXPIRING_WINDOW_MS = 24 * 3_600_000;

/**
 * Pass 4: offers about to lapse.
 *
 * One of the two notifications with no feed event to ride (D63). `expirePass` writes no card on
 * purpose — an ignored offer is a non-event to the season — but it is very much an event to the
 * two people involved, which is the reason this phase exists at all.
 *
 * Both parties are warned. Read literally it is the offerer's offer and the offerer's escrowed
 * credits about to come back; but the person who can PREVENT the expiry is the opponent.
 *
 * There is no fixed lead time to rely on: an offer written with a two-hour window is inside this
 * query the moment it is created, and gets its warning on the first sweep rather than a day
 * ahead. The dedupe key makes that happen once, not once per sweep.
 */
async function expiringPass(now: Date, summary: SweepP2PSummary): Promise<void> {
  const soon = new Date(now.getTime() + EXPIRING_WINDOW_MS);

  const closing = await db
    .select()
    .from(p2pWagers)
    .where(
      and(
        eq(p2pWagers.status, 'OFFERED'),
        gt(p2pWagers.expiresAt, now),
        lte(p2pWagers.expiresAt, soon),
      ),
    );

  for (const wager of closing) {
    try {
      const subject =
        wager.kind === 'FREEFORM'
          ? (wager.description ?? '')
          : ((await loadSelectionSubject(wager.selectionId!))?.subject ?? '');

      let flagged = 0;
      await db.transaction(async (tx) => {
        const memberships = [wager.offererMembershipId, wager.opponentMembershipId].filter(
          (id): id is string => id !== null,
        );

        for (const membershipId of memberships) {
          const userId = await userIdForMembership(tx, membershipId);
          if (!userId) continue;

          const { applied } = await enqueueNotification(tx, {
            userId,
            type: 'OFFER_EXPIRING',
            dedupeKey: `p2p:${wager.id}:expiring:${userId}`,
            payload: {
              wagerId: wager.id,
              subject,
              expiresAt: wager.expiresAt.toISOString(),
            },
          });
          if (applied) flagged += 1;
        }
      });
      // Counted only once the transaction that queued the rows has committed — incrementing
      // inside it reported warnings that a later throw had rolled back.
      summary.expiringFlagged += flagged;
    } catch (err) {
      summary.errors.push({ wagerId: wager.id, message: (err as Error).message });
    }
  }
}
