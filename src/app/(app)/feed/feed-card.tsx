import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Money } from '@/components/ui/money';
import type { FeedEventType } from '@/db/schema';
import type {
  AdminAdjustmentPayload,
  AllowancePaidPayload,
  BetPlacedPayload,
  BetSettledPayload,
  BigWinPayload,
  FeedLegSnapshot,
  LeadChangePayload,
  MemberJoinedPayload,
  ParlayHitPayload,
} from '@/server/feed/payload';
import type { SerializedFeedCard } from './actions';

/** "KC −3.5 (−110)" for a sports leg, "{event} · {market} · {outcome} (price)" for a custom one. */
function describeLeg(leg: FeedLegSnapshot): React.ReactNode {
  const price = leg.priceAmerican > 0 ? `+${leg.priceAmerican}` : `${leg.priceAmerican}`;

  if (leg.kind === 'CUSTOM') {
    return (
      <>
        {leg.eventTitle} · {leg.marketTitle} · {leg.outcomeLabel} ({price})
        {leg.byCreator ? (
          <>
            {' '}
            <Badge status="CREATOR" />
          </>
        ) : null}
      </>
    );
  }

  if (leg.marketType === 'TOTAL') {
    const direction = leg.side === 'OVER' ? 'o' : 'u';
    return `${leg.awayAbbr}/${leg.homeAbbr} ${direction}${leg.line ?? ''} (${price})`;
  }

  const team = leg.side === 'HOME' ? leg.homeAbbr : leg.awayAbbr;
  if (leg.marketType === 'MONEYLINE') return `${team} ML (${price})`;

  const line = leg.line ? Number(leg.line) : 0;
  const signed = line > 0 ? `+${leg.line}` : `${leg.line}`;
  return `${team} ${signed} (${price})`;
}

const OUTCOME_MARK: Record<string, string> = {
  WON: '✓',
  LOST: '✗',
  PUSHED: '—',
  VOIDED: '⊘',
};

function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function Body({ type, payload }: { type: FeedEventType; payload: unknown }) {
  switch (type) {
    case 'BET_PLACED': {
      const bet = payload as BetPlacedPayload;
      return (
        <div className="flex flex-col gap-1">
          <p className="text-sm">
            bet <Money cents={BigInt(bet.stakeCents)} currency={bet.currency} className="font-semibold" /> to win{' '}
            <Money cents={BigInt(bet.potentialPayoutCents)} currency={bet.currency} className="font-semibold" />
          </p>
          <ul className="flex flex-col gap-0.5 text-sm text-zinc-600 dark:text-zinc-300">
            {bet.legs.map((leg, i) => (
              <li key={i}>{describeLeg(leg)}</li>
            ))}
          </ul>
        </div>
      );
    }

    case 'BET_SETTLED': {
      const bet = payload as BetSettledPayload;
      const net = BigInt(bet.netCents);
      const verb =
        bet.outcome === 'WON'
          ? 'won'
          : bet.outcome === 'LOST'
            ? 'lost'
            : bet.outcome === 'PUSHED'
              ? 'pushed'
              : 'had a bet voided';

      return (
        <div className="flex flex-col gap-1">
          <p className="text-sm">
            {verb}{' '}
            {bet.outcome === 'LOST' ? (
              <Money cents={BigInt(bet.stakeCents)} currency={bet.currency} className="font-semibold" />
            ) : (
              <Money cents={BigInt(bet.payoutCents)} currency={bet.currency} className="font-semibold" />
            )}
            {net !== 0n ? (
              <span className={net > 0n ? 'text-emerald-600' : 'text-rose-600'}>
                {' '}
                ({net > 0n ? '+' : ''}
                <Money cents={net} currency={bet.currency} />)
              </span>
            ) : null}
            {bet.correction ? (
              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">
                corrected
              </span>
            ) : null}
          </p>
          <ul className="flex flex-col gap-0.5 text-sm text-zinc-600 dark:text-zinc-300">
            {bet.legs.map((leg, i) => (
              <li key={i}>
                {describeLeg(leg)} {OUTCOME_MARK[bet.legOutcomes[i]] ?? ''}
              </li>
            ))}
          </ul>
        </div>
      );
    }

    case 'MEMBER_JOINED': {
      const joined = payload as MemberJoinedPayload;
      return (
        <p className="text-sm">
          joined with <Money cents={BigInt(joined.startingBankrollCents)} className="font-semibold" />
        </p>
      );
    }

    case 'ALLOWANCE_PAID': {
      const allowance = payload as AllowancePaidPayload;
      return (
        <p className="text-sm">
          Weekly allowance paid ·{' '}
          <Money cents={BigInt(allowance.amountCents)} className="font-semibold" /> to{' '}
          {allowance.memberCount} {allowance.memberCount === 1 ? 'member' : 'members'}
        </p>
      );
    }

    case 'ADMIN_ADJUSTMENT': {
      const adjustment = payload as AdminAdjustmentPayload;
      const amount = BigInt(adjustment.amountCents);
      return (
        <p className="text-sm">
          <span className={amount > 0n ? 'text-emerald-600' : 'text-rose-600'}>
            {amount > 0n ? '+' : ''}
            <Money cents={amount} className="font-semibold" />
          </span>{' '}
          by admin {adjustment.adminDisplayName} — “{adjustment.note}”
        </p>
      );
    }

    case 'MILESTONE_LEAD_CHANGE': {
      const lead = payload as LeadChangePayload;
      return (
        <p className="text-sm">
          <span className="font-semibold">takes the lead</span> ·{' '}
          <Money cents={BigInt(lead.balanceCents)} /> (+
          <Money cents={BigInt(lead.marginCents)} />
          {lead.previousLeaderDisplayName ? ` over ${lead.previousLeaderDisplayName}` : ''})
        </p>
      );
    }

    case 'MILESTONE_BIG_WIN': {
      const win = payload as BigWinPayload;
      return (
        <p className="text-sm">
          cashed <span className="font-semibold">{(win.multipleBasisPoints / 10_000).toFixed(1)}×</span>{' '}
          · <Money cents={BigInt(win.stakeCents)} /> → <Money cents={BigInt(win.payoutCents)} />
        </p>
      );
    }

    case 'MILESTONE_PARLAY_HIT': {
      const hit = payload as ParlayHitPayload;
      return (
        <p className="text-sm">
          hit a <span className="font-semibold">{hit.legCount}-leg parlay</span> ·{' '}
          <Money cents={BigInt(hit.payoutCents)} />
        </p>
      );
    }

    default:
      return null;
  }
}

export function FeedCardView({
  card,
  reactionRow,
}: {
  card: SerializedFeedCard;
  reactionRow?: React.ReactNode;
}) {
  return (
    <article className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <header className="flex items-baseline justify-between gap-2">
        {card.subject ? (
          <Link
            href={`/members/${card.subject.membershipId}`}
            className="truncate text-sm font-semibold hover:underline"
          >
            {card.subject.displayName}
          </Link>
        ) : (
          <span className="truncate text-sm font-semibold text-zinc-500">The league</span>
        )}
        <span className="shrink-0 text-xs text-zinc-400">{relativeTime(card.occurredAt)}</span>
      </header>

      <Body type={card.type} payload={card.payload} />

      <footer className="flex items-center justify-between gap-3 pt-1">
        {reactionRow ?? <span />}
        <Link href={`/feed/${card.id}`} className="text-xs text-zinc-500 hover:underline">
          {card.commentCount === 0
            ? 'Comment'
            : `${card.commentCount} ${card.commentCount === 1 ? 'comment' : 'comments'}`}
        </Link>
      </footer>
    </article>
  );
}
