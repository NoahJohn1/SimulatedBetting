'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from './button';

export type ConfirmDialogTone = 'default' | 'danger';

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body?: string;
  confirmLabel: string;
  tone?: ConfirmDialogTone;
}

const EXIT_MS = 150;

function prefersMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: no-preference)').matches
  );
}

/**
 * A native `<dialog>`, not a hand-rolled overlay (D79): `showModal()` gets the focus trap and
 * top-layer stacking for free, and ESC-to-close needs no keydown listener because the platform
 * already fires it. What is not free — the scrim click and restoring focus to whatever opened
 * the dialog — is the handful of lines below.
 *
 * Motion (Task 15): fade-and-rise on enter, reversed on exit, via a `data-state` flip plus the
 * CSS transition on `--motion-base` (globals.css) — 0s, hence inert, unless
 * `prefers-reduced-motion: no-preference` says otherwise. Every path that closes the dialog —
 * Cancel, Confirm, a scrim click, and ESC's native `cancel` — routes through `requestClose`
 * below rather than calling `dialog.close()` directly, so the exit transition gets ~150ms to
 * play before the platform actually removes the dialog from the top layer.
 * `event.preventDefault()` on `cancel` is what buys that room: without it the browser closes
 * the dialog synchronously, before any CSS transition gets a frame to run.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
  tone = 'default',
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const invokerRef = useRef<HTMLElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [entered, setEntered] = useState(false);

  function requestClose() {
    const dialog = ref.current;
    if (!dialog || !dialog.open || closeTimerRef.current) return;
    if (prefersMotion()) {
      setEntered(false);
      closeTimerRef.current = setTimeout(() => {
        closeTimerRef.current = null;
        dialog.close();
      }, EXIT_MS);
    } else {
      dialog.close();
    }
  }

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      invokerRef.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
      setEntered(false);
      const raf = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(raf);
    }
    if (!open && dialog.open) {
      requestClose();
    }
  }, [open]);

  // The native `close` event fires for every way out — ESC, the scrim click below, and the
  // Cancel/Confirm buttons, all of which now go through requestClose — so it is the one place
  // that needs to tell the parent the dialog is gone and hand focus back to whatever opened it.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleClose = () => {
      onClose();
      invokerRef.current?.focus();
    };
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [onClose]);

  // ESC fires `cancel` before the platform's default action closes the dialog. Preventing that
  // default and routing through requestClose is what lets ESC play the same exit transition as
  // every other close path; at reduced motion (or in a test environment with no matchMedia) we
  // leave the default alone and the platform closes it immediately, same as before this task.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    function handleCancel(event: Event) {
      if (!prefersMotion()) return;
      event.preventDefault();
      requestClose();
    }
    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, []);

  useEffect(
    () => () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    },
    [],
  );

  return (
    <dialog
      ref={ref}
      onClick={(e) => {
        // A click lands on the <dialog> element itself only when it misses the content box
        // below (which stops propagation) — i.e. a click on the backdrop.
        if (e.target === ref.current) requestClose();
      }}
      data-state={entered ? 'open' : 'closed'}
      className="w-full max-w-sm translate-y-2 rounded-card border border-line bg-surface-raised p-0 opacity-0 backdrop:bg-ink/50 transition-[opacity,transform] duration-[var(--motion-base)] ease-out data-[state=open]:translate-y-0 data-[state=open]:opacity-100"
    >
      <div className="flex flex-col gap-4 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">{title}</h2>
          {body ? <p className="text-sm text-ink-muted">{body}</p> : null}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => requestClose()}>
            Cancel
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            size="sm"
            onClick={() => {
              onConfirm();
              requestClose();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
