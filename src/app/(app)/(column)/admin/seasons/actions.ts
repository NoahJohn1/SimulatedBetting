'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/server/auth/session';
import { consume } from '@/server/limits/consume';
import type { RateLimited } from '@/server/limits/types';
import { activateSeason, type ActivateResult } from '@/server/seasons/activate';
import { createSeason } from '@/server/seasons/service';
import { parseAmountToCents } from './parse';

export interface CreateSeasonFields {
  name: string;
  startsAt: string;
  endsAt: string;
  startingBankroll: string;
  weeklyAllowance: string;
  startingCredits: string;
  weeklyCreditAllowance: string;
  allowanceWeekday: string;
}

export async function createSeasonAction(
  fields: CreateSeasonFields,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await requireAdmin();

  const limited = await consume(admin.userId, 'ADMIN_ACTION');
  if (limited) {
    return {
      ok: false,
      error: `That went through too quickly. Try again in ${limited.retryAfterSeconds} seconds.`,
    };
  }

  const name = fields.name.trim();
  if (!name) return { ok: false, error: 'A season needs a name.' };

  const startsAt = new Date(fields.startsAt);
  const endsAt = new Date(fields.endsAt);
  if (Number.isNaN(startsAt.getTime()))
    return { ok: false, error: 'The start date is not a date.' };
  if (Number.isNaN(endsAt.getTime())) return { ok: false, error: 'The end date is not a date.' };
  if (endsAt <= startsAt) return { ok: false, error: 'The season has to end after it starts.' };

  const weekday = Number(fields.allowanceWeekday);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    return { ok: false, error: 'The allowance weekday has to be 0 (Sunday) through 6.' };
  }

  try {
    await createSeason({
      name,
      startsAt,
      endsAt,
      startingBankrollCents: parseAmountToCents(fields.startingBankroll, 'Starting bankroll'),
      weeklyAllowanceCents: parseAmountToCents(fields.weeklyAllowance, 'Weekly allowance'),
      startingCreditsCents: parseAmountToCents(fields.startingCredits, 'Starting credits'),
      weeklyCreditAllowanceCents: parseAmountToCents(
        fields.weeklyCreditAllowance,
        'Weekly credit allowance',
      ),
      allowanceWeekday: weekday,
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not create the season.',
    };
  }

  revalidatePath('/admin/seasons');
  return { ok: true };
}

/** The real gate is requireAdmin here, never the page hiding the control. */
export async function activateSeasonAction(
  seasonId: string,
): Promise<ActivateResult | ({ ok: false } & RateLimited)> {
  const admin = await requireAdmin();

  const limited = await consume(admin.userId, 'ADMIN_ACTION');
  if (limited) return { ok: false, ...limited };

  const result = await activateSeason(seasonId);
  if (result.ok) revalidatePath('/admin/seasons');
  return result;
}
