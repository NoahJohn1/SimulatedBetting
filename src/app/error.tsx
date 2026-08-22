'use client';

import Link from 'next/link';
import { StatusScreen } from '@/components/ui/status-screen';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <StatusScreen
      title="Something went wrong"
      body="That's on us, not on you. Nothing was lost."
      digest={error.digest}
    >
      <button
        type="button"
        onClick={() => reset()}
        className="text-sm font-medium text-zinc-500 underline"
      >
        Try again
      </button>
      <Link href="/" className="text-sm font-medium text-zinc-500 underline">
        Back home
      </Link>
    </StatusScreen>
  );
}
