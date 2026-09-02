import type { ComponentProps } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-ink hover:opacity-90',
  secondary: 'border border-line-strong text-ink hover:border-line-hover',
  ghost: 'text-ink-muted hover:text-ink',
  danger: 'border border-negative-line text-negative hover:bg-negative-surface-soft',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-11 px-4 text-sm',
};

/**
 * The class string, for the call sites that are `<Link>`s rather than `<button>`s. Exported
 * instead of an `asChild` prop: cloning children to forward props is what makes button
 * components hard to read, and every link-button in this app is a plain next/link.
 */
export function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md'): string {
  return [
    'inline-flex items-center justify-center gap-2 rounded-control font-medium',
    'transition-colors disabled:cursor-not-allowed disabled:opacity-50',
    VARIANTS[variant],
    SIZES[size],
  ].join(' ');
}

/**
 * `disabled:opacity-50` lives here rather than at each call site, which is what keeps the
 * twelve forms' pending-state contract (D51) true by construction rather than by twelve
 * separate people remembering it.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  type = 'button',
  ...props
}: ComponentProps<'button'> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button type={type} className={`${buttonClasses(variant, size)} ${className}`} {...props} />
  );
}
