import { desc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/db/client';
import { ledgerEntries, seasonMemberships } from '@/db/schema';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Money } from '@/components/ui/money';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { formatDateTime } from '@/domain/dates';
import { signOut } from '@/server/auth/config';
import { getSessionUser, requireApprovedMember } from '@/server/auth/session';
import { LEDGER_LABELS } from './ledger-labels';

export const metadata: Metadata = { title: 'Me' };

/** The settings screen's link rows — label, one-line description, and a chevron. */
const SETTINGS_LINKS: { href: string; label: string; description: string }[] = [
  {
    href: '/me/feed-preferences',
    label: 'Feed filters',
    description: 'Choose what shows up in your feed',
  },
  { href: '/me/notifications', label: 'Email', description: 'Choose which emails you get' },
];

/** Every entry is visible to its owner, admin adjustments and their notes included (D16). */
export default async function MePage() {
  const member = await requireApprovedMember();
  const user = await getSessionUser();
  const now = new Date();

  const [membership] = await db
    .select({ creditsBalanceCents: seasonMemberships.creditsBalanceCents })
    .from(seasonMemberships)
    .where(eq(seasonMemberships.id, member.membershipId));

  const entries = await db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.membershipId, member.membershipId))
    .orderBy(desc(ledgerEntries.createdAt))
    .limit(100);

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <Card className="p-4">
        <p className="text-sm text-ink-muted">{user?.email}</p>
        <div className="mt-1 flex items-baseline gap-4">
          <p className="text-2xl font-semibold">
            <Money cents={member.balanceCents} />
          </p>
          {membership ? (
            <p className="text-sm font-medium text-ink-muted">
              <Money cents={membership.creditsBalanceCents} currency="CREDITS" /> credits
            </p>
          ) : null}
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <ul className="divide-y divide-line">
          {SETTINGS_LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-muted"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{link.label}</span>
                  <span className="block text-xs text-ink-muted">{link.description}</span>
                </span>
                <span aria-hidden="true" className="shrink-0 text-ink-muted">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      {entries.length === 0 ? (
        <EmptyState
          title="No activity yet"
          body="Bets, payouts, and adjustments will show up here."
        />
      ) : (
        <>
          <ol className="flex flex-col gap-1 lg:hidden">
            {entries.map((entry) => (
              <li key={entry.id}>
                <Card className="flex items-start justify-between gap-3 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{LEDGER_LABELS[entry.type]}</span>
                    {entry.note ? (
                      <span className="block truncate text-xs text-ink-muted">{entry.note}</span>
                    ) : null}
                    <span className="block text-xs text-ink-muted">
                      {formatDateTime(entry.createdAt, now)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <Money
                      cents={entry.amountCents}
                      currency={entry.currency}
                      className="block text-sm font-semibold"
                    />
                    <span className="block text-xs text-ink-muted">
                      <Money cents={entry.balanceAfterCents} currency={entry.currency} />
                    </span>
                  </span>
                </Card>
              </li>
            ))}
          </ol>

          <Card className="hidden overflow-x-auto lg:block">
            <Table>
              <THead>
                <Tr>
                  <Th>Date</Th>
                  <Th>Entry</Th>
                  <Th align="right">Amount</Th>
                  <Th align="right">Balance</Th>
                </Tr>
              </THead>
              <TBody>
                {entries.map((entry) => (
                  <Tr key={entry.id}>
                    <Td>
                      <span className="text-ink-muted">{formatDateTime(entry.createdAt, now)}</span>
                    </Td>
                    <Td>
                      <span className="block font-medium">{LEDGER_LABELS[entry.type]}</span>
                      {entry.note ? (
                        <span className="block text-xs text-ink-muted">{entry.note}</span>
                      ) : null}
                    </Td>
                    <Td align="right">
                      <Money
                        cents={entry.amountCents}
                        currency={entry.currency}
                        className="font-semibold"
                      />
                    </Td>
                    <Td align="right">
                      <span className="text-ink-muted">
                        <Money cents={entry.balanceAfterCents} currency={entry.currency} />
                      </span>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </Card>
        </>
      )}

      <Link href="/rules" className="text-sm font-medium text-ink-muted underline">
        House rules
      </Link>

      <form
        action={async () => {
          'use server';
          await signOut({ redirectTo: '/sign-in' });
        }}
      >
        <button type="submit" className="text-sm font-medium text-ink-muted underline">
          Sign out
        </button>
      </form>
    </div>
  );
}
