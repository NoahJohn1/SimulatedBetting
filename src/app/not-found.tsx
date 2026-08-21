import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="max-w-sm text-balance text-sm text-zinc-500 dark:text-zinc-400">
        There&rsquo;s nothing at this address.
      </p>
      <Link href="/" className="text-sm font-medium text-zinc-500 underline">
        Back home
      </Link>
    </main>
  );
}
