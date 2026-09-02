import type { ReactNode } from 'react';

/**
 * Label, control, hint, error. `htmlFor` is required rather than optional because an
 * unlabelled control is the accessibility bug this component exists to make impossible —
 * the caller has to name the id it gave its input.
 */
export function FormField({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-ink-secondary">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="text-xs text-ink-muted">{hint}</p> : null}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-xs text-negative">
          {error}
        </p>
      ) : null}
    </div>
  );
}
