import type { ReactNode } from 'react';

/**
 * The shared layout for every "this screen is not showing you what you asked for" state:
 * error boundaries and not-found boundaries. Rendered inside the app shell, so it sizes
 * itself against the viewport rather than filling it — the header and tab bar are still
 * there and still take space.
 */
export function StatusScreen({
  title,
  body,
  digest,
  children,
}: {
  title: string;
  body: string;
  digest?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 max-w-sm text-balance text-sm text-ink-muted">
          {body}
        </p>
      </div>
      {children ? <div className="flex items-center gap-4">{children}</div> : null}
      {/* The digest is the only thread between a member saying "it broke" and a server log
          line. Phase 6 will attach real error reporting; until then this is the whole of it. */}
      {digest ? (
        <p className="font-mono text-xs text-ink-subtle">Reference {digest}</p>
      ) : null}
    </div>
  );
}
