export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <p className="text-sm font-medium text-ink-secondary">{title}</p>
      {body ? <p className="max-w-xs text-balance text-sm text-ink-muted">{body}</p> : null}
    </div>
  );
}
