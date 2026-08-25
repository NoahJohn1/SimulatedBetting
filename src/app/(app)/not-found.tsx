import Link from 'next/link';
import { StatusScreen } from '@/components/ui/status-screen';

/**
 * Catches the four notFound() calls: a wager, a feed card, a member profile, or an event
 * that either does not exist or is not in the viewer's season. The two cases are
 * deliberately not distinguished — saying "that exists but not for you" leaks whether it
 * exists.
 */
export default function AppNotFound() {
  return (
    <StatusScreen
      title="Not found"
      body="That game, event, wager, or member isn't here — it may not exist, or may not be part of your season."
    >
      <Link href="/games" className="text-sm font-medium text-ink-muted underline">
        Back to games
      </Link>
    </StatusScreen>
  );
}
