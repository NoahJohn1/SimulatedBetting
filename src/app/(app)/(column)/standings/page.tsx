import { desc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/db/client';
import { bets, seasonMemberships, users } from '@/db/schema';
import type { Currency } from '@/db/schema';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Money } from '@/components/ui/money';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { computeMemberStats, type BetOutcomeRow } from '@/domain/stats';
import { requireApprovedMember } from '@/server/auth/session';

export const metadata: Metadata = { title: 'Standings' };

/**
 * Won–lost per membership, split by currency. Read-only: sums bet outcomes for every member
 * in the season and hands each group to `computeMemberStats`, keeping only `.won`/`.lost` —
 * everything else that function computes (ROI, streak, biggest win) goes unused here on
 * purpose, so a later screen that wants those numbers already has the query it needs.
 */
function recordsByMembership(
  betRows: {
    membershipId: string;
    currency: Currency;
    status: BetOutcomeRow['status'];
    stakeCents: bigint;
    settledAt: Date | null;
  }[],
): Map<string, string> {
  const grouped = new Map<string, BetOutcomeRow[]>();
  for (const b of betRows) {
    const key = `${b.membershipId}:${b.currency}`;
    const outcome: BetOutcomeRow = {
      status: b.status,
      stakeCents: b.stakeCents,
      // Not needed for won/lost — real payouts would require the ledger join feed/stats.ts
      // does for a single member's profile; a season-wide record has no use for it.
      payoutCents: 0n,
      settledAt: b.settledAt,
    };
    const list = grouped.get(key);
    if (list) list.push(outcome);
    else grouped.set(key, [outcome]);
  }

  const records = new Map<string, string>();
  for (const [key, outcomeRows] of grouped) {
    const stats = computeMemberStats(outcomeRows);
    records.set(key, `${stats.won}–${stats.lost}`);
  }
  return records;
}

export default async function StandingsPage() {
  const member = await requireApprovedMember();

  const rows = await db
    .select({
      membershipId: seasonMemberships.id,
      balanceCents: seasonMemberships.balanceCents,
      creditsBalanceCents: seasonMemberships.creditsBalanceCents,
      displayName: users.displayName,
    })
    .from(seasonMemberships)
    .innerJoin(users, eq(seasonMemberships.userId, users.id))
    .where(eq(seasonMemberships.seasonId, member.seasonId))
    .orderBy(desc(seasonMemberships.balanceCents));

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nobody has joined yet"
        body="Standings show up once other members join the season."
      />
    );
  }

  const byCredits = [...rows].sort((a, b) =>
    a.creditsBalanceCents < b.creditsBalanceCents
      ? 1
      : a.creditsBalanceCents > b.creditsBalanceCents
        ? -1
        : 0,
  );

  const betRows = await db
    .select({
      membershipId: bets.membershipId,
      currency: bets.currency,
      status: bets.status,
      stakeCents: bets.stakeCents,
      settledAt: bets.settledAt,
    })
    .from(bets)
    .innerJoin(seasonMemberships, eq(bets.membershipId, seasonMemberships.id))
    .where(eq(seasonMemberships.seasonId, member.seasonId));

  const records = recordsByMembership(betRows);
  const recordFor = (membershipId: string, currency: Currency) =>
    records.get(`${membershipId}:${currency}`) ?? '0–0';

  return (
    <div className="flex flex-col gap-6 px-4 py-4">
      <ol className="flex flex-col gap-2 lg:hidden">
        {rows.map((row, i) => {
          const isMe = row.membershipId === member.membershipId;
          return (
            <li key={row.membershipId}>
              <Card emphasis={isMe} className="flex items-center gap-3 p-3">
                <span className="w-6 text-sm tabular-nums text-ink-muted">{i + 1}</span>
                <Link
                  href={`/members/${row.membershipId}`}
                  className="flex-1 truncate text-sm font-medium hover:underline"
                >
                  {row.displayName}
                </Link>
                <Money cents={row.balanceCents} className="text-sm font-semibold" />
              </Card>
            </li>
          );
        })}
      </ol>

      <Card className="hidden overflow-x-auto lg:block">
        <Table>
          <THead>
            <Tr>
              <Th>Rank</Th>
              <Th>Member</Th>
              <Th align="right">Record</Th>
              <Th align="right">Balance</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map((row, i) => {
              const isMe = row.membershipId === member.membershipId;
              return (
                <Tr key={row.membershipId} className={isMe ? 'bg-surface-muted' : ''}>
                  <Td>
                    <span className="tabular-nums text-ink-muted">{i + 1}</span>
                  </Td>
                  <Td>
                    <Link
                      href={`/members/${row.membershipId}`}
                      className="font-medium hover:underline"
                    >
                      {row.displayName}
                    </Link>
                  </Td>
                  <Td align="right">
                    <span className="tabular-nums text-ink-muted">
                      {recordFor(row.membershipId, 'CASH')}
                    </span>
                  </Td>
                  <Td align="right">
                    <Money cents={row.balanceCents} className="font-semibold" />
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      </Card>

      <section className="flex flex-col gap-2">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Credits — custom events
        </h2>
        <p className="px-1 text-xs text-ink-muted">
          Credits are granted, never converted, and do not affect the season standings above.
        </p>
        <ol className="flex flex-col gap-2 lg:hidden">
          {byCredits.map((row, i) => {
            const isMe = row.membershipId === member.membershipId;
            return (
              <li key={row.membershipId}>
                <Card emphasis={isMe} className="flex items-center gap-3 p-3">
                  <span className="w-6 text-sm tabular-nums text-ink-muted">{i + 1}</span>
                  <Link
                    href={`/members/${row.membershipId}`}
                    className="flex-1 truncate text-sm font-medium hover:underline"
                  >
                    {row.displayName}
                  </Link>
                  <Money
                    cents={row.creditsBalanceCents}
                    currency="CREDITS"
                    className="text-sm font-semibold"
                  />
                </Card>
              </li>
            );
          })}
        </ol>

        <Card className="hidden overflow-x-auto lg:block">
          <Table>
            <THead>
              <Tr>
                <Th>Rank</Th>
                <Th>Member</Th>
                <Th align="right">Record</Th>
                <Th align="right">Balance</Th>
              </Tr>
            </THead>
            <TBody>
              {byCredits.map((row, i) => {
                const isMe = row.membershipId === member.membershipId;
                return (
                  <Tr key={row.membershipId} className={isMe ? 'bg-surface-muted' : ''}>
                    <Td>
                      <span className="tabular-nums text-ink-muted">{i + 1}</span>
                    </Td>
                    <Td>
                      <Link
                        href={`/members/${row.membershipId}`}
                        className="font-medium hover:underline"
                      >
                        {row.displayName}
                      </Link>
                    </Td>
                    <Td align="right">
                      <span className="tabular-nums text-ink-muted">
                        {recordFor(row.membershipId, 'CREDITS')}
                      </span>
                    </Td>
                    <Td align="right">
                      <Money
                        cents={row.creditsBalanceCents}
                        currency="CREDITS"
                        className="font-semibold"
                      />
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </Card>
      </section>
    </div>
  );
}
