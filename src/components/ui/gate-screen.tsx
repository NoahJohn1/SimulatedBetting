import type { ReactNode } from 'react';

/**
 * The shared layout for the four screens a member meets before the app: `/pending`, `/join`,
 * `/no-season` and `/disabled` (D71).
 *
 * Not `StatusScreen`, which is sized to render *inside* the app shell where a header and a tab
 * bar are already taking space. These have no shell, fill the viewport, and need a footer —
 * one component answering to both contracts would falsify StatusScreen's own comment.
 *
 * `step` is the thing that makes these a sequence rather than four dead ends. `/no-season` and
 * `/disabled` pass none, because neither is a stage anyone progresses through.
 */
export function GateScreen({
  title,
  body,
  step,
  children,
  footer,
}: {
  title: string;
  body: ReactNode;
  step?: { current: number; total: number };
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6 text-center">
      <div>
        {step ? (
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-subtle">
            Step {step.current} of {step.total}
          </p>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <div className="mt-3 max-w-sm text-balance text-sm text-ink-muted">{body}</div>
      </div>

      {children ? <div className="flex flex-col items-center gap-3">{children}</div> : null}

      {footer ? (
        <div className="flex items-center gap-4 text-xs text-ink-muted">{footer}</div>
      ) : null}
    </main>
  );
}
