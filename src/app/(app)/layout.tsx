import Link from 'next/link';
import { BetSlip } from '@/components/bet-slip/bet-slip';
import { BetSlipProvider } from '@/components/bet-slip/slip-context';
import { Money } from '@/components/ui/money';
import { TabBar } from '@/components/ui/tab-bar';
import { requireApprovedMember } from '@/server/auth/session';

/**
 * The members-only shell. Authorization runs here, once, at the top of every screen inside
 * the group — server-side on every request, never by hiding UI.
 */
export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const member = await requireApprovedMember();

  return (
    <div className="flex min-h-dvh flex-col bg-zinc-50 dark:bg-black">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <Link href="/games" className="text-sm font-semibold tracking-tight">
          SimulatedBetting
        </Link>
        <div className="flex items-center gap-3">
          {member.role === 'ADMIN' ? (
            <Link href="/admin" className="text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200">
              Admin
            </Link>
          ) : null}
          <Money cents={member.balanceCents} className="text-sm font-semibold" />
        </div>
      </header>

      <BetSlipProvider>
        <main className="flex-1">{children}</main>
        <BetSlip />
      </BetSlipProvider>

      <TabBar />
    </div>
  );
}
