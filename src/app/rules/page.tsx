import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { seasons } from '@/db/schema';
import { formatAmount } from '@/domain/money';
import {
  DEFAULT_ALLOWANCE_WEEKDAY,
  DEFAULT_STARTING_BANKROLL_CENTS,
  DEFAULT_STARTING_CREDITS_CENTS,
  DEFAULT_WEEKLY_ALLOWANCE_CENTS,
  DEFAULT_WEEKLY_CREDIT_ALLOWANCE_CENTS,
} from '@/server/seasons/defaults';

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export const metadata: Metadata = { title: 'House rules' };

function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold tracking-tight">{heading}</h2>
      <div className="flex flex-col gap-2 text-sm text-ink-muted">{children}</div>
    </section>
  );
}

export default async function RulesPage() {
  const [season] = await db.select().from(seasons).where(eq(seasons.status, 'ACTIVE'));

  const bankroll = season?.startingBankrollCents ?? DEFAULT_STARTING_BANKROLL_CENTS;
  const weekly = season?.weeklyAllowanceCents ?? DEFAULT_WEEKLY_ALLOWANCE_CENTS;
  const credits = season?.startingCreditsCents ?? DEFAULT_STARTING_CREDITS_CENTS;
  const weeklyCredits = season?.weeklyCreditAllowanceCents ?? DEFAULT_WEEKLY_CREDIT_ALLOWANCE_CENTS;
  const weekday = WEEKDAY_NAMES[season?.allowanceWeekday ?? DEFAULT_ALLOWANCE_WEEKDAY];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">House rules</h1>
        <p className="mt-2 text-sm text-ink-muted">
          How this works, in plain language. Nothing here involves real money.
        </p>
      </div>

      <Section heading="This is not real money">
        <p>
          Every balance in this app is simulated. You cannot deposit, you cannot withdraw, and there
          is no way to turn anything here into cash. That is not a missing feature — it is the
          category the project deliberately stays out of.
        </p>
      </Section>

      <Section heading="Two currencies">
        <p>
          <strong>Cash</strong> is what you bet on real games. You start a season with{' '}
          {formatAmount(bankroll)} and receive {formatAmount(weekly)} more every week.
        </p>
        <p>
          <strong>Credits</strong> are for member-made events and wagers between members. You start
          with {formatAmount(credits, 'CREDITS')} and receive{' '}
          {formatAmount(weeklyCredits, 'CREDITS')} a week.
        </p>
        <p>
          The two never mix. No bet, wager or transfer converts one into the other in either
          direction, and a parlay cannot combine a game leg with a member-made one.
        </p>
      </Section>

      <Section heading="The weekly allowance">
        <p>
          The allowance lands every {weekday}, automatically, for everyone in the season. It is not
          a reward and it is not affected by how you are doing — a member who is up and a member who
          is broke get the same amount on the same day.
        </p>
      </Section>

      <Section heading="Betting">
        <p>
          Lines come from real sportsbooks. When you place a bet the price is frozen at that moment,
          so a line that moves afterward cannot change what you were paid or what you owe. If the
          line moves while your slip is open, the slip tells you and asks again.
        </p>
        <p>
          Singles and parlays only. Finished games settle themselves — you do not need to claim a
          win, and a push returns the stake.
        </p>
      </Section>

      <Section heading="Member-made events">
        <p>
          Anyone can post an event with their own outcomes and prices. Whoever created it resolves
          it when it is decided, and everyone who bet it is paid from that resolution.
        </p>
        <p>
          If you think a resolution is wrong, you can dispute it. A dispute goes to an admin, who
          re-resolves the event — the correction is a new set of entries, not an edit of the old
          ones.
        </p>
      </Section>

      <Section heading="Wagers between members">
        <p>
          A wager is two stakes into a pot: yours and your opponent&rsquo;s, each named up front.
          Your stake is held the moment you make the offer, not when it is accepted, so you cannot
          promise the same credits to two people.
        </p>
        <p>Both sides agree on who won and it settles. If you disagree, an admin rules on it.</p>
      </Section>

      <Section heading="Who arbitrates, and how">
        <p>
          Admins do. They rule on disputed events and on wagers where the two sides disagree, and
          their ruling is what settles the money.
        </p>
        <p>
          Voiding a wager — returning both stakes and calling it off — is a verdict an admin can
          reach through arbitration. It is not a button they hold standing over every wager, and it
          cannot be used to undo something an admin simply dislikes.
        </p>
      </Section>

      <Section heading="If a number looks wrong">
        <p>
          Every balance is the sum of an append-only history of entries, checked against that
          history once a day. Nothing is ever edited after the fact — a correction is a new entry
          that reverses the old one, so the record of what happened stays intact.
        </p>
        <p>Tell an admin. The history makes it possible to say exactly what happened and when.</p>
      </Section>

      <Link href="/" className="text-sm text-ink-muted underline">
        Back to the app
      </Link>
    </main>
  );
}
