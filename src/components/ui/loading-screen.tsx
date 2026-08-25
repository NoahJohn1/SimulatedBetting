/**
 * Deliberately not a skeleton. A skeleton that does not match the screen it precedes reads
 * worse than an honest placeholder, and per-screen skeletons are phase 7d's job — this
 * reserves space and says "working" without pretending to predict the layout.
 */
export function LoadingScreen({ label = 'Loading' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6"
    >
      <span className="sr-only">{label}</span>
      <div
        aria-hidden
        className="h-2 w-24 animate-pulse rounded-pill bg-surface-skeleton"
      />
      <div
        aria-hidden
        className="h-2 w-16 animate-pulse rounded-pill bg-surface-skeleton"
      />
    </div>
  );
}
