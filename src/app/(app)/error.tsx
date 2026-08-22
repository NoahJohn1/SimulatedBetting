'use client';

import Link from 'next/link';
import { StatusScreen } from '@/components/ui/status-screen';

/**
 * Renders inside the shell — header, tab bar and bet slip survive, so a member can navigate
 * away instead of reloading. A failure of the shell's own layout falls through to the root
 * boundary, which is what that one is for.
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <StatusScreen
      title="Something went wrong"
      body="That's on us, not on you. No bet was placed and no balance changed."
      digest={error.digest}
    >
      <button
        type="button"
        onClick={() => retry()}
        className="text-sm font-medium text-zinc-500 underline"
      >
        Try again
      </button>
      <Link href="/games" className="text-sm font-medium text-zinc-500 underline">
        Back to games
      </Link>
    </StatusScreen>
  );
}
