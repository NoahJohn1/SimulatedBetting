import { desc } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/db/client';
import { seasons } from '@/db/schema';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { requireAdmin } from '@/server/auth/session';
import {
  DEFAULT_ALLOWANCE_WEEKDAY,
  DEFAULT_STARTING_BANKROLL_CENTS,
  DEFAULT_STARTING_CREDITS_CENTS,
  DEFAULT_WEEKLY_ALLOWANCE_CENTS,
  DEFAULT_WEEKLY_CREDIT_ALLOWANCE_CENTS,
} from '@/server/seasons/defaults';
import { ActivateForm } from './activate-form';
import { SeasonForm } from './season-form';

export const metadata: Metadata = { title: 'Seasons' };

const STATUS_TONES: Record<string, BadgeTone> = {
  ACTIVE: 'positive',
  UPCOMING: 'caution',
  COMPLETED: 'neutral',
};

/** Cents to the whole-unit string the form edits. The form converts back on submit. */
function toUnits(cents: bigint): string {
  return (Number(cents) / 100).toFixed(2);
}

function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Starting a season used to require shell access to the production database, which is not a
 * thing you want to discover in September. createSeason is unchanged — this screen and
 * bootstrap-season.ts are the same operation, not two implementations that can diverge.
 */
export default async function SeasonsPage() {
  await requireAdmin();

  const rows = await db.select().from(seasons).orderBy(desc(seasons.createdAt));

  const nextYear = new Date();
  nextYear.setFullYear(nextYear.getFullYear() + 1);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Seasons</h1>
        <Link href="/admin" className="text-sm text-ink-muted underline">
          Back to admin
        </Link>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Every season
        </h2>

        {rows.length === 0 ? (
          <EmptyState title="No seasons yet" />
        ) : (
          rows.map((season) => (
            <Card key={season.id} className="flex items-center justify-between gap-3 p-3">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{season.name}</span>
                <span className="block truncate text-xs text-ink-muted">
                  {toDateInput(season.startsAt)} → {toDateInput(season.endsAt)}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge tone={STATUS_TONES[season.status] ?? 'neutral'}>{season.status}</Badge>
                {season.status === 'UPCOMING' ? <ActivateForm seasonId={season.id} /> : null}
              </span>
            </Card>
          ))
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Create a season
        </h2>
        <p className="text-xs text-ink-muted">
          A new season is created upcoming — nobody can join it and nothing changes until you
          activate it.
        </p>

        <Card className="p-3">
          <SeasonForm
            defaults={{
              name: '',
              startsAt: toDateInput(new Date()),
              endsAt: toDateInput(nextYear),
              startingBankroll: toUnits(DEFAULT_STARTING_BANKROLL_CENTS),
              weeklyAllowance: toUnits(DEFAULT_WEEKLY_ALLOWANCE_CENTS),
              startingCredits: toUnits(DEFAULT_STARTING_CREDITS_CENTS),
              weeklyCreditAllowance: toUnits(DEFAULT_WEEKLY_CREDIT_ALLOWANCE_CENTS),
              allowanceWeekday: String(DEFAULT_ALLOWANCE_WEEKDAY),
            }}
          />
        </Card>
      </section>
    </div>
  );
}
