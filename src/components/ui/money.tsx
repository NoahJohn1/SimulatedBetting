import { formatCents } from '@/domain/money';

/** Renders cents through the domain formatter. Never format money inline in a screen. */
export function Money({ cents, className = '' }: { cents: bigint; className?: string }) {
  const negative = cents < 0n;
  return (
    <span className={`tabular-nums ${negative ? 'text-red-600 dark:text-red-400' : ''} ${className}`}>
      {formatCents(cents)}
    </span>
  );
}

/** American prices always carry an explicit sign — +150 reads differently from 150. */
export function Price({ american }: { american: number }) {
  return <span className="tabular-nums">{american > 0 ? `+${american}` : american}</span>;
}
