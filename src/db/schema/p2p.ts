import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { seasonMemberships, seasons, users } from './identity';
import { selections } from './sports';

export const p2pWagerKind = pgEnum('p2p_wager_kind', ['MARKET', 'FREEFORM']);
export const p2pWagerStatus = pgEnum('p2p_wager_status', [
  'OFFERED',
  'ACCEPTED',
  'SETTLED',
  'VOIDED',
  'CANCELED',
  'EXPIRED',
]);
export const p2pVerdict = pgEnum('p2p_verdict', ['OFFERER', 'ACCEPTOR', 'VOID']);

export type P2PWagerKind = (typeof p2pWagerKind.enumValues)[number];
export type P2PWagerStatus = (typeof p2pWagerStatus.enumValues)[number];
export type P2PVerdict = (typeof p2pVerdict.enumValues)[number];

/**
 * A direct wager between two members (D42).
 *
 * Deliberately not two rows in `bets`: a bet carries a price and a potential payout, and a
 * wager has neither — its terms are two explicit stakes and the pot is their sum (D41).
 * Keeping it separate is also what stops `settleGame`'s pending-leg sweep from ever finding
 * a wager and trying to pay it from the house's side of the table.
 *
 * `opponentMembershipId` null means the offer is open to the season; set means it is a
 * challenge only that member may accept.
 *
 * `settlementAttempts` is `bets.settlement_attempts` under another name and for the same
 * reason: an admin correction must write idempotency keys that cannot collide with the
 * payout it is correcting (D15).
 *
 * There is no `DISPUTED` or `OVERDUE` status and no `pot_cents` column. Disputed is *both
 * claims set and unequal*, overdue is *past `resolvesBy` with no agreed verdict*, and the pot
 * is the sum of the two stakes — all three are derived, because a stored copy is a second
 * place for the same fact to live and disagree from (D44).
 */
export const p2pWagers = pgTable(
  'p2p_wagers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => seasons.id),
    kind: p2pWagerKind('kind').notNull(),
    status: p2pWagerStatus('status').notNull().default('OFFERED'),

    offererMembershipId: uuid('offerer_membership_id')
      .notNull()
      .references(() => seasonMemberships.id),
    acceptorMembershipId: uuid('acceptor_membership_id').references(() => seasonMemberships.id),
    /** Null = open to the season. Set = a directed challenge. */
    opponentMembershipId: uuid('opponent_membership_id').references(() => seasonMemberships.id),

    offererStakeCents: bigint('offerer_stake_cents', { mode: 'bigint' }).notNull(),
    acceptorStakeCents: bigint('acceptor_stake_cents', { mode: 'bigint' }).notNull(),

    /** MARKET only. The offerer holds this selection; the acceptor holds its negation. */
    selectionId: uuid('selection_id').references(() => selections.id),
    /** Frozen at offer, exactly as bet_legs.line_at_placement is frozen at placement (D10). */
    lineAtOffer: numeric('line_at_offer', { precision: 5, scale: 2 }),
    /** FREEFORM only. */
    description: text('description'),

    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    resolvesBy: timestamp('resolves_by', { withTimezone: true }).notNull(),

    offererClaim: p2pVerdict('offerer_claim'),
    acceptorClaim: p2pVerdict('acceptor_claim'),
    offererCancelProposed: boolean('offerer_cancel_proposed').notNull().default(false),
    acceptorCancelProposed: boolean('acceptor_cancel_proposed').notNull().default(false),

    verdict: p2pVerdict('verdict'),
    settlementAttempts: integer('settlement_attempts').notNull().default(0),
    resolvedByUserId: uuid('resolved_by_user_id').references(() => users.id),
    resolutionNote: text('resolution_note'),

    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'p2p_wagers_kind_shape',
      sql`(${t.kind} = 'MARKET' AND ${t.selectionId} IS NOT NULL AND ${t.description} IS NULL)
       OR (${t.kind} = 'FREEFORM' AND ${t.selectionId} IS NULL AND ${t.description} IS NOT NULL)`,
    ),
    check(
      'p2p_wagers_positive_stakes',
      sql`${t.offererStakeCents} > 0 AND ${t.acceptorStakeCents} > 0`,
    ),
    index('p2p_wagers_season_status_idx').on(t.seasonId, t.status),
    index('p2p_wagers_offerer_idx').on(t.offererMembershipId),
    index('p2p_wagers_acceptor_idx').on(t.acceptorMembershipId),
    index('p2p_wagers_selection_idx').on(t.selectionId),
    // Both sweeps run every ten minutes forever; the partial indexes keep them off the
    // settled bulk of the table, exactly as bet_legs_pending_idx does for settlement.
    index('p2p_wagers_open_idx')
      .on(t.expiresAt)
      .where(sql`${t.status} = 'OFFERED'`),
    index('p2p_wagers_live_idx')
      .on(t.resolvesBy)
      .where(sql`${t.status} = 'ACCEPTED'`),
  ],
);
