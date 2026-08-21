'use client';

import Link from 'next/link';

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="mt-3 max-w-sm text-balance text-sm text-zinc-500 dark:text-zinc-400">
          That&rsquo;s on us, not on you. Nothing was lost.
        </p>
      </div>
      <div className="flex items-center gap-4">
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
      </div>
    </main>
  );
}
