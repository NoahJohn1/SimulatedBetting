export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{title}</p>
      {body ? <p className="max-w-xs text-balance text-sm text-zinc-500">{body}</p> : null}
    </div>
  );
}
