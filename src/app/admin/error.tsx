'use client';

import Link from 'next/link';
import { StatusScreen } from '@/components/ui/status-screen';

export default function AdminError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <StatusScreen
      title="Something went wrong"
      body="An admin screen failed to load. Nothing was resolved, voided, or arbitrated."
      digest={error.digest}
    >
      <button
        type="button"
        onClick={() => retry()}
        className="text-sm font-medium text-zinc-500 underline"
      >
        Try again
      </button>
      <Link href="/admin" className="text-sm font-medium text-zinc-500 underline">
        Back to admin
      </Link>
    </StatusScreen>
  );
}
