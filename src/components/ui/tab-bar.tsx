'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The six destinations, single source (D74). The bottom tab bar and the desktop header nav
 * both render from this list rather than keeping their own copies.
 */
export const NAV_ITEMS: { href: string; label: string }[] = [
  { href: '/games', label: 'Games' },
  { href: '/events', label: 'Events' },
  { href: '/feed', label: 'Feed' },
  { href: '/bets', label: 'My Bets' },
  { href: '/standings', label: 'Standings' },
  { href: '/me', label: 'Me' },
];

/** True when `pathname` is on `href` or a route nested beneath it. */
function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The six-tab bottom bar. Games is still the default landing route (D8); Events sits right
 * next to it since custom events are a first-class currency, not a buried feature.
 *
 * Peer-to-peer wagers deliberately did not become a seventh tab. This comment previously
 * named a segmented control as the fallback if six ever read as crowded, and subsystem 4
 * took it: `/wagers` is reached from a Bets | Wagers control on `/bets`, which is also where
 * a member would look for them.
 *
 * Hidden at `lg+` (D74), where the same destinations render as links in the header instead —
 * see `HeaderNav` below, which shares this component's active-route logic.
 */
export function TabBar() {
  const pathname = usePathname();

  return (
    // src/components/bet-slip/bet-slip.tsx sticks itself just above this nav using a hardcoded
    // `bottom` offset derived from this nav's rendered height — changing this nav's padding,
    // font size, or border requires updating that offset too.
    <nav className="sticky bottom-0 z-10 grid grid-cols-6 border-t border-line bg-surface-raised/90 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      {NAV_ITEMS.map((tab) => {
        const active = isActive(pathname, tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors ${
              active ? 'text-ink' : 'text-ink-muted hover:text-ink-secondary'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The same six destinations as a horizontal link list for the desktop header (D74). Reuses
 * `NAV_ITEMS` and `isActive` from `TabBar` above rather than keeping a second copy of either.
 */
export function HeaderNav() {
  const pathname = usePathname();

  return (
    <ul className="hidden items-center gap-4 lg:flex">
      {NAV_ITEMS.map((tab) => {
        const active = isActive(pathname, tab.href);
        return (
          <li key={tab.href}>
            <Link
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={`text-sm font-medium transition-colors ${
                active ? 'text-ink' : 'text-ink-muted hover:text-ink-secondary'
              }`}
            >
              {tab.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
