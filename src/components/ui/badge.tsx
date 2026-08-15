const TONES: Record<string, string> = {
  PENDING: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  WON: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  LOST: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
  PUSHED: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  VOIDED: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
};

export function Badge({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONES[status] ?? TONES.PENDING}`}
    >
      {status}
    </span>
  );
}
