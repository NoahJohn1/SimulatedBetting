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
  CustomEventCreatedPayload,
  CustomEventDisputedPayload,
  CustomEventOverduePayload,
  CustomEventResolvedPayload,
  CustomEventVoidedPayload,
  FeedLegSnapshot,
  LeadChangePayload,
  MemberJoinedPayload,
  ParlayHitPayload,
  P2PAcceptedPayload,
  P2PDisputedPayload,
  P2POfferedPayload,
  P2PSettledPayload,
  P2PVoidedPayload,
} from '@/server/feed/payload';
import type { SerializedFeedCard } from './actions';

/** "Fri 8pm" — a compact close/resolve-by time, matching the copy in the brief's feed table. */
function formatDeadline(iso: string): string {
  const date = new Date(iso);
  const weekday = date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/New_York' });
  const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', timeZone: 'America/New_York' };
  if (date.getMinutes() !== 0) timeOpts.minute = '2-digit';
  const time = date.toLocaleTimeString('en-US', timeOpts).replace(' ', '').toLowerCase();
  return `${weekday} ${time}`;
}

function EventTitleLink({ eventId, title }: { eventId: string; title: string }) {
  return (
    <Link href={`/events/${eventId}`} className="font-semibold hover:underline">
      {title}
    </Link>
  );
}

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
            <Money cents={amount} currency={adjustment.currency} className="font-semibold" />
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
      // Cards written before credits existed carry no currency, and every one of them was a
      // cash bet — so the fallback is the truth for old rows, not a guess.
      const currency = win.currency ?? 'CASH';
      return (
        <p className="text-sm">
          cashed <span className="font-semibold">{(win.multipleBasisPoints / 10_000).toFixed(1)}×</span>{' '}
          · <Money cents={BigInt(win.stakeCents)} currency={currency} /> →{' '}
          <Money cents={BigInt(win.payoutCents)} currency={currency} />
        </p>
      );
    }

    case 'MILESTONE_PARLAY_HIT': {
      const hit = payload as ParlayHitPayload;
      return (
        <p className="text-sm">
          hit a <span className="font-semibold">{hit.legCount}-leg parlay</span> ·{' '}
          <Money cents={BigInt(hit.payoutCents)} currency={hit.currency ?? 'CASH'} />
        </p>
      );
    }

    case 'CUSTOM_EVENT_CREATED': {
      const created = payload as CustomEventCreatedPayload;
      return (
        <p className="text-sm">
          opened <EventTitleLink eventId={created.eventId} title={created.title} /> ·{' '}
          {created.marketCount} {created.marketCount === 1 ? 'market' : 'markets'} · closes{' '}
          {formatDeadline(created.resolvesBy)}
        </p>
      );
    }

    case 'CUSTOM_EVENT_RESOLVED': {
      const resolved = payload as CustomEventResolvedPayload;
      const winners = resolved.outcomes.map((o) => o.winningLabel).join(', ');
      return (
        <p className="text-sm">
          <EventTitleLink eventId={resolved.eventId} title={resolved.title} /> resolved by{' '}
          <span className="italic">{resolved.resolvedByDisplayName}</span> · {winners} win
          {resolved.correction ? (
            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">
              correction
            </span>
          ) : null}
        </p>
      );
    }

    case 'CUSTOM_EVENT_DISPUTED': {
      const disputed = payload as CustomEventDisputedPayload;
      return (
        <p className="text-sm">
          disputed <EventTitleLink eventId={disputed.eventId} title={disputed.title} /> — “
          {disputed.reason}”
        </p>
      );
    }

    case 'CUSTOM_EVENT_VOIDED': {
      const voided = payload as CustomEventVoidedPayload;
      return (
        <p className="text-sm">
          <EventTitleLink eventId={voided.eventId} title={voided.title} /> voided by admin{' '}
          <span className="italic">{voided.adminDisplayName}</span> · {voided.refundedBetCount}{' '}
          {voided.refundedBetCount === 1 ? 'bet' : 'bets'} refunded
        </p>
      );
    }

    case 'CUSTOM_EVENT_OVERDUE': {
      const overdue = payload as CustomEventOverduePayload;
      return (
        <p className="text-sm">
          <EventTitleLink eventId={overdue.eventId} title={overdue.title} /> is past its
          resolve-by date · {overdue.openBetCount} {overdue.openBetCount === 1 ? 'bet' : 'bets'}{' '}
          open
        </p>
      );
    }

    case 'P2P_OFFERED': {
      const offered = payload as P2POfferedPayload;
      return (
        <p className="text-sm">
          is offering{' '}
          <Money cents={BigInt(offered.offererStakeCents)} currency="CREDITS" className="font-semibold" />{' '}
          against{' '}
          <Money cents={BigInt(offered.acceptorStakeCents)} currency="CREDITS" className="font-semibold" />{' '}
          credits — {offered.directed ? 'a direct challenge' : 'open to the season'}:{' '}
          {offered.description ?? offered.subject}
        </p>
      );
    }

    case 'P2P_ACCEPTED': {
      const accepted = payload as P2PAcceptedPayload;
      return (
        <p className="text-sm">
          took it. <Money cents={BigInt(accepted.potCents)} currency="CREDITS" className="font-semibold" />{' '}
          credits on the line: {accepted.subject}
        </p>
      );
    }

    case 'P2P_SETTLED': {
      const settled = payload as P2PSettledPayload;
      return (
        <p className="text-sm">
          {settled.correction ? (
            <span className="mr-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">
              Corrected
            </span>
          ) : null}
          took the <Money cents={BigInt(settled.potCents)} currency="CREDITS" className="font-semibold" />{' '}
          pot: {settled.subject}
          {settled.byArbitration ? <span className="italic"> — settled by an admin</span> : null}
        </p>
      );
    }

    case 'P2P_DISPUTED': {
      const disputed = payload as P2PDisputedPayload;
      return (
        <p className="text-sm">
          and their opponent disagree on {disputed.subject}. An admin will settle it.
        </p>
      );
    }

    case 'P2P_VOIDED': {
      const voided = payload as P2PVoidedPayload;
      const reasonText =
        voided.reason === 'MUTUAL_CANCEL'
          ? 'they both agreed to call it off'
          : voided.reason === 'AGREED_VOID'
            ? 'they agreed nobody won'
            : voided.reason === 'EVENT_DEAD'
              ? 'the event never happened'
              : `${voided.adminDisplayName ?? 'an admin'} refunded both sides — “${voided.note ?? ''}”`;
      return (
        <p className="text-sm">
          {voided.subject} was called off — {reasonText};{' '}
          <Money cents={BigInt(voided.refundedCents)} currency="CREDITS" className="font-semibold" /> credits
          went back
          {voided.attempt > 1 ? (
            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">
              correction
            </span>
          ) : null}
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
