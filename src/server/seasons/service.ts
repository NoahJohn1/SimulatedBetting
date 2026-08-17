import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { seasonMemberships, seasons } from '@/db/schema';
import { postEntry } from '@/server/money/ledger';
import { emitFeedEvent } from '@/server/feed/emit';
import {
  DEFAULT_ALLOWANCE_WEEKDAY,
  DEFAULT_STARTING_BANKROLL_CENTS,
  DEFAULT_WEEKLY_ALLOWANCE_CENTS,
} from './defaults';

export interface CreateSeasonInput {
  name: string;
  startsAt: Date;
  endsAt: Date;
  startingBankrollCents?: bigint;
  weeklyAllowanceCents?: bigint;
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
      allowanceWeekday: input.allowanceWeekday ?? DEFAULT_ALLOWANCE_WEEKDAY,
    })
    .returning();

  return season;
}

export interface JoinSeasonResult {
  membershipId: string;
  balanceCents: bigint;
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

    if (result.applied) {
      await emitFeedEvent(tx, {
        seasonId,
        type: 'MEMBER_JOINED',
        subjectMembershipId: membership.id,
        dedupeKey: `membership:${membership.id}:joined`,
        payload: { startingBankrollCents: season.startingBankrollCents.toString() },
        occurredAt: membership.joinedAt,
      });
    }

    return { membershipId: membership.id, balanceCents: result.balanceCents };
  });
}
