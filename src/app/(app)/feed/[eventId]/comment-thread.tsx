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
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Comments</h2>

      {comments.length === 0 ? (
        <p className="text-sm text-zinc-500">Nobody has said anything yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {comments.map((comment) => (
            <li
              key={comment.id}
              className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950"
            >
              {comment.deleted ? (
                <p className="text-sm italic text-zinc-400">Comment removed</p>
              ) : (
                <>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold">{comment.displayName}</span>
                    {comment.canDelete ? (
                      <button
                        type="button"
                        onClick={() => remove(comment.id)}
                        disabled={pending}
                        className="text-xs text-zinc-400 hover:text-rose-600 disabled:opacity-50"
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
          className="rounded-xl border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950"
        />
        {error ? <p className="text-xs text-rose-600">{error}</p> : null}
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="self-end rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? 'Posting…' : 'Post'}
        </button>
      </div>
    </section>
  );
}
