export default function DisabledPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Account disabled</h1>
      <p className="mt-3 max-w-sm text-balance text-sm text-zinc-500">
        This account can no longer place bets. Talk to an admin if you think that is a mistake.
      </p>
    </main>
  );
}
