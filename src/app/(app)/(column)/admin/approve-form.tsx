'use client';

import { useTransition } from 'react';
import { useToast } from '@/components/ui/toast';
import type { RateLimited } from '@/server/limits/types';

type StatusResult = { ok: true } | { ok: false; error: RateLimited };

/**
 * Approve or deny one pending sign-in. `setStatus` is the page's own server action — the
 * `requireAdmin` gate and the rate limit both run there; this component only reports the
 * result (D76: every submitted action announces through toast, success and failure alike).
 */
export function ApproveForm({
  userId,
  displayName,
  setStatus,
}: {
  userId: string;
  displayName: string;
  setStatus: (userId: string, status: 'APPROVED' | 'DISABLED') => Promise<StatusResult>;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function act(status: 'APPROVED' | 'DISABLED') {
    startTransition(async () => {
      const result = await setStatus(userId, status);
      if (result.ok) {
        toast({
          tone: 'positive',
          title: status === 'APPROVED' ? `${displayName} approved` : `${displayName} denied`,
        });
      } else {
        toast({
          tone: 'negative',
          title: "You're doing that too quickly",
          description: `Try again in ${result.error.retryAfterSeconds} seconds.`,
        });
      }
    });
  }

  return (
    <span className="flex shrink-0 gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => act('APPROVED')}
        className="h-9 rounded-full bg-accent px-4 text-xs font-medium text-accent-ink disabled:opacity-40"
      >
        Approve
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => act('DISABLED')}
        className="h-9 rounded-full border border-line-strong px-4 text-xs font-medium disabled:opacity-40"
      >
        Deny
      </button>
    </span>
  );
}
