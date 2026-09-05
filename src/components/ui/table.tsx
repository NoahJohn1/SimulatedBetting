import type { ReactNode } from 'react';

/**
 * Thin, token-speaking table primitives. Presentation only — no sorting, no state. A screen
 * composes `<Table><THead><Tr><Th>...</Th></Tr></THead><TBody><Tr><Td>...</Td></Tr></TBody></Table>`
 * and owns the data.
 */

type Align = 'left' | 'right';

function alignClass(align: Align): string {
  return align === 'right' ? 'text-right' : 'text-left';
}

export function Table({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <table className={`w-full border-collapse ${className}`}>{children}</table>;
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="border-b border-line">{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-line">{children}</tbody>;
}

export function Tr({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <tr className={className}>{children}</tr>;
}

export function Th({
  children,
  align = 'left',
  className = '',
}: {
  children: ReactNode;
  align?: Align;
  className?: string;
}) {
  return (
    <th
      className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-muted ${alignClass(align)} ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = 'left',
  className = '',
}: {
  children: ReactNode;
  align?: Align;
  className?: string;
}) {
  return <td className={`px-3 py-2 text-sm ${alignClass(align)} ${className}`}>{children}</td>;
}
