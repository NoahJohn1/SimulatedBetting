'use client';

import { useState, useTransition } from 'react';
import { MAX_COMMENT_LENGTH } from '@/server/feed/reaction-emoji';
import { addCommentAction, deleteCommentAction } from '../actions';

export interface ThreadComment {
  id: string;
  membershipId: string;
  displayName: string;
  body: string;
  createdAt: string;
  deleted: boolean;
  canDelete: boolean;
}

export function CommentThread({
  eventId,
  comments,
}: {
  eventId: string;
  comments: ThreadComment[];
}) {
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ERRORS: Record<string, string> = {
    COMMENT_EMPTY: 'Say something first.',
    COMMENT_TOO_LONG: `Keep it under ${MAX_COMMENT_LENGTH} characters.`,
    NOT_ALLOWED: 'Not your comment.',
    RATE_LIMITED: 'You are commenting too quickly. Give it a few seconds.',
  };

  function submit() {
    const trimmed = body.trim();
    if (trimmed.length === 0) {
      setError(ERRORS.COMMENT_EMPTY);
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await addCommentAction(eventId, trimmed);
      if ('error' in result) {
        setError(ERRORS[result.error] ?? 'Could not post that.');
        return;
      }
      setBody('');
    });
  }

  function remove(commentId: string) {
    startTransition(async () => {
      const result = await deleteCommentAction(commentId, eventId);
      if ('error' in result) setError(ERRORS[result.error] ?? 'Could not delete that.');
    });
  }

  return (
    <section className="flex flex-col gap-3 px-4 pb-6">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Comments</h2>

      {comments.length === 0 ? (
        <p className="text-sm text-ink-muted">Nobody has said anything yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {comments.map((comment) => (
            <li key={comment.id} className="rounded-xl border border-line bg-surface-raised p-3">
              {comment.deleted ? (
                <p className="text-sm italic text-ink-muted">Comment removed</p>
              ) : (
                <>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold">{comment.displayName}</span>
                    {comment.canDelete ? (
                      <button
                        type="button"
                        onClick={() => remove(comment.id)}
                        disabled={pending}
                        className="text-xs text-ink-muted hover:text-negative disabled:opacity-50"
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                  <p className="whitespace-pre-wrap text-sm">{comment.body}</p>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={MAX_COMMENT_LENGTH}
          rows={3}
          placeholder="Say something"
          className="rounded-xl border border-line bg-surface-raised p-3 text-sm"
        />
        {error ? <p className="text-xs text-negative">{error}</p> : null}
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="self-end rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
        >
          {pending ? 'Posting…' : 'Post'}
        </button>
      </div>
    </section>
  );
}
