'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/games', label: 'Games' },
  { href: '/feed', label: 'Feed' },
  { href: '/bets', label: 'My Bets' },
  { href: '/standings', label: 'Standings' },
  { href: '/me', label: 'Me' },
] as const;

/** The five-tab bottom bar. Games is the default landing route (D8); Feed sits one tap away. */
export function TabBar() {
  const pathname = usePathname();

  return (
    <nav className="sticky bottom-0 z-10 grid grid-cols-5 border-t border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors ${
              active
                ? 'text-zinc-900 dark:text-zinc-50'
                : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
