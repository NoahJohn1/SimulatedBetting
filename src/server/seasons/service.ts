import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { seasonMemberships, seasons } from '@/db/schema';
import { postEntry } from '@/server/money/ledger';
import { emitFeedEvent } from '@/server/feed/emit';
import {
  DEFAULT_ALLOWANCE_WEEKDAY,
  DEFAULT_STARTING_BANKROLL_CENTS,
  DEFAULT_STARTING_CREDITS_CENTS,
  DEFAULT_WEEKLY_ALLOWANCE_CENTS,
  DEFAULT_WEEKLY_CREDIT_ALLOWANCE_CENTS,
} from './defaults';

export interface CreateSeasonInput {
  name: string;
  startsAt: Date;
  endsAt: Date;
  startingBankrollCents?: bigint;
  weeklyAllowanceCents?: bigint;
  startingCreditsCents?: bigint;
  weeklyCreditAllowanceCents?: bigint;
  allowanceWeekday?: number;
}

export async function createSeason(input: CreateSeasonInput) {
  const [season] = await db
    .insert(seasons)
    .values({
      name: input.name,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      startingBankrollCents: input.startingBankrollCents ?? DEFAULT_STARTING_BANKROLL_CENTS,
      weeklyAllowanceCents: input.weeklyAllowanceCents ?? DEFAULT_WEEKLY_ALLOWANCE_CENTS,
      startingCreditsCents: input.startingCreditsCents ?? DEFAULT_STARTING_CREDITS_CENTS,
      weeklyCreditAllowanceCents:
        input.weeklyCreditAllowanceCents ?? DEFAULT_WEEKLY_CREDIT_ALLOWANCE_CENTS,
      allowanceWeekday: input.allowanceWeekday ?? DEFAULT_ALLOWANCE_WEEKDAY,
    })
    .returning();

  return season;
}

export interface JoinSeasonResult {
  membershipId: string;
  balanceCents: bigint;
  creditsBalanceCents: bigint;
}

export async function joinSeason(userId: string, seasonId: string): Promise<JoinSeasonResult> {
  return db.transaction(async (tx) => {
    const [season] = await tx.select().from(seasons).where(eq(seasons.id, seasonId));
    if (!season) throw new Error(`no season ${seasonId}`);

    const [existing] = await tx
      .select()
      .from(seasonMemberships)
      .where(and(eq(seasonMemberships.userId, userId), eq(seasonMemberships.seasonId, seasonId)));

    const membership =
      existing ??
      (
        await tx
          .insert(seasonMemberships)
          .values({ userId, seasonId, balanceCents: 0n })
          .returning()
      )[0];

    const result = await postEntry(tx, {
      membershipId: membership.id,
      amountCents: season.startingBankrollCents,
      type: 'SEASON_STARTING_GRANT',
      idempotencyKey: `grant:${membership.id}`,
    });

    // Credits are granted, never bought (D31). Same transaction, distinct key, so a
    // replayed join grants neither currency twice. A season with no credits configured
    // grants no credit row at all — a zero-amount row would be noise, not a grant.
    let credits: { applied: boolean; balanceCents: bigint; entryId: string | null };
    if (season.startingCreditsCents > 0n) {
      credits = await postEntry(tx, {
        membershipId: membership.id,
        amountCents: season.startingCreditsCents,
        type: 'SEASON_STARTING_GRANT',
        currency: 'CREDITS',
        idempotencyKey: `grant:${membership.id}:credits`,
      });
    } else {
      // No row to write, but the membership's real credits balance is not necessarily 0n —
      // an admin can adjust credits independently of this season's economy, and this join
      // may be a re-join. Report the true current balance, same as postEntry's own no-op
      // replay path does, rather than a hardcoded stand-in.
      const [current] = await tx
        .select({ creditsBalanceCents: seasonMemberships.creditsBalanceCents })
        .from(seasonMemberships)
        .where(eq(seasonMemberships.id, membership.id));
      credits = { applied: false, balanceCents: current.creditsBalanceCents, entryId: null };
    }

    if (result.applied) {
      await emitFeedEvent(tx, {
        seasonId,
        type: 'MEMBER_JOINED',
        subjectMembershipId: membership.id,
        dedupeKey: `membership:${membership.id}:joined`,
        payload: {
          startingBankrollCents: season.startingBankrollCents.toString(),
          startingCreditsCents: season.startingCreditsCents.toString(),
        },
        occurredAt: membership.joinedAt,
      });
    }

    return {
      membershipId: membership.id,
      balanceCents: result.balanceCents,
      creditsBalanceCents: credits.balanceCents,
    };
  });
}
