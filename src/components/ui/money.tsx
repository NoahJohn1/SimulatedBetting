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
    <span className={`tabular-nums ${negative ? 'text-red-600 dark:text-red-400' : ''} ${className}`}>
      {formatAmount(cents, currency)}
    </span>
  );
}

/** American prices always carry an explicit sign — +150 reads differently from 150. */
export function Price({ american }: { american: number }) {
  return <span className="tabular-nums">{american > 0 ? `+${american}` : american}</span>;
}
