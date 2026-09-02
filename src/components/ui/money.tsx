import type { Currency } from '@/db/schema';
import { formatAmount } from '@/domain/money';

/**
 * Renders cents through the domain formatter. Never format money inline in a screen.
 *
 * `currency` defaults to CASH, so every screen that predates credits is unchanged; a credits
 * amount has to say so, which is exactly the call site that knows (D31).
 */
export function Money({
  cents,
  currency = 'CASH',
  className = '',
}: {
  cents: bigint;
  currency?: Currency;
  className?: string;
}) {
  const negative = cents < 0n;
  return (
    <span className={`tabular-nums ${negative ? 'text-negative' : ''} ${className}`}>
      {formatAmount(cents, currency)}
    </span>
  );
}

/** American prices always carry an explicit sign — +150 reads differently from 150. */
export function Price({ american, className = '' }: { american: number; className?: string }) {
  return <span className={`tabular-nums ${className}`}>{american > 0 ? `+${american}` : american}</span>;
}

/**
 * The number a selection's button shows. Lifted out of games/game-card.tsx, which had its own
 * copy of this and its own copy of Price's signing rule.
 */
export function Line({ value, market }: { value: string; market: 'SPREAD' | 'TOTAL'; }) {
  const n = Number(value);
  if (market === 'TOTAL') return <span className="tabular-nums">{n}</span>;
  return <span className="tabular-nums">{n > 0 ? `+${n}` : n}</span>;
}
