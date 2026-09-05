import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { seasonMemberships, seasons } from '@/db/schema';
import { postEntry } from '@/server/money/ledger';
import { emitFeedEvent } from '@/server/feed/emit';
import { enqueueNotification } from '@/server/notify/enqueue';
import { seasonMemberUserIds } from '@/server/notify/recipients';

const LEAGUE_TIMEZONE = 'America/New_York';

/** ISO-8601 week key (e.g. "2026-W36") for the given instant, in league time. */
export function isoWeekKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: LEAGUE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const local = new Date(Date.UTC(get('year'), get('month') - 1, get('day')));

  // Shift to the Thursday of this ISO week, which always sits in the ISO year.
  const dayOfWeek = (local.getUTCDay() + 6) % 7; // Monday = 0
  local.setUTCDate(local.getUTCDate() - dayOfWeek + 3);

  const isoYear = local.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayOfWeek = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayOfWeek + 3);

  const week = 1 + Math.round((local.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

export interface AllowanceRunResult {
  credited: number;
  skipped: number;
}

export async function payWeeklyAllowance(now: Date = new Date()): Promise<AllowanceRunResult> {
  const [season] = await db.select().from(seasons).where(eq(seasons.status, 'ACTIVE'));
  if (!season) return { credited: 0, skipped: 0 };

  const memberships = await db
    .select({ id: seasonMemberships.id })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.seasonId, season.id));

  const weekKey = isoWeekKey(now);
  let credited = 0;
  let skipped = 0;

  for (const membership of memberships) {
    const result = await db.transaction(async (tx) => {
      const cash = await postEntry(tx, {
        membershipId: membership.id,
        amountCents: season.weeklyAllowanceCents,
        type: 'WEEKLY_ALLOWANCE',
        idempotencyKey: `allowance:${membership.id}:${weekKey}`,
      });
      // A zero-credit season drips no credit row at all — same guard as the join grant.
      if (season.weeklyCreditAllowanceCents > 0n) {
        await postEntry(tx, {
          membershipId: membership.id,
          amountCents: season.weeklyCreditAllowanceCents,
          type: 'WEEKLY_ALLOWANCE',
          currency: 'CREDITS',
          idempotencyKey: `allowance:${membership.id}:${weekKey}:credits`,
        });
      }
      return cash;
    });
    if (result.applied) credited += 1;
    else skipped += 1;
  }

  // One card for the whole run (D26). Twelve members would otherwise post twelve identical
  // cards every Tuesday, which is how a feed dies. Emitted unconditionally — the week-scoped
  // dedupe key already makes a repeat run a no-op, so there is nothing to branch on.
  await db.transaction((tx) =>
    emitFeedEvent(tx, {
      seasonId: season.id,
      type: 'ALLOWANCE_PAID',
      dedupeKey: `allowance:${season.id}:${weekKey}`,
      payload: {
        weekKey,
        memberCount: memberships.length,
        amountCents: season.weeklyAllowanceCents.toString(),
        creditAmountCents: season.weeklyCreditAllowanceCents.toString(),
      },
      occurredAt: now,
    }),
  );

  // The feed gets one card for the whole run (D26); the mail gets one row per person, because
  // an email is addressed and a feed card is broadcast. Same fact, different fan-out (D63).
  //
  // A separate transaction from the per-member postEntry loop above, on purpose: those money
  // writes are already committed member by member, and a notification failure must not be able
  // to roll any of them back.
  await db.transaction(async (tx) => {
    for (const { userId } of await seasonMemberUserIds(tx, season.id)) {
      await enqueueNotification(tx, {
        userId,
        type: 'ALLOWANCE_PAID',
        dedupeKey: `allowance:${season.id}:${weekKey}:${userId}`,
        payload: {
          weekKey,
          amountCents: season.weeklyAllowanceCents.toString(),
          creditAmountCents: season.weeklyCreditAllowanceCents.toString(),
        },
      });
    }
  });

  return { credited, skipped };
}
