import Link from 'next/link';
import { buttonClasses } from '@/components/ui/button';

/**
 * The shared "there's nothing here" layout: a heading, one line saying why, and — only where
 * there's something the viewer can actually do about it — one action. `action` is optional on
 * purpose: a lot of empty states (nobody's joined, nothing's overdue) have no sensible next
 * step, and a button to nowhere is worse than no button (Task 20).
 */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <p className="text-sm font-medium text-ink-secondary">{title}</p>
      {body ? <p className="max-w-xs text-balance text-sm text-ink-muted">{body}</p> : null}
      {action ? (
        <Link href={action.href} className={`${buttonClasses('secondary', 'sm')} mt-2`}>
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
