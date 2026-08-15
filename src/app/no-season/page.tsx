export default function NoSeasonPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">No season running</h1>
      <p className="mt-3 max-w-sm text-balance text-sm text-zinc-500">
        An admin needs to start a season before there is anything to bet on.
      </p>
    </main>
  );
}
