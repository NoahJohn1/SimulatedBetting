'use client';

import { useEffect, useRef } from 'react';
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

/**
 * A native `<dialog>`, not a hand-rolled overlay (D79): `showModal()` gets the focus trap and
 * top-layer stacking for free, and ESC-to-close needs no keydown listener because the platform
 * already fires it. What is not free — the scrim click and restoring focus to whatever opened
 * the dialog — is the handful of lines below.
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

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      invokerRef.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // The native `close` event fires for every way out — ESC (which fires `cancel` first, then
  // `close`, both left to their default behaviour), the scrim click below, and the Cancel
  // button's own `dialog.close()` — so it is the one place that needs to tell the parent the
  // dialog is gone and hand focus back to whatever opened it.
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

  return (
    <dialog
      ref={ref}
      onClick={(e) => {
        // A click lands on the <dialog> element itself only when it misses the content box
        // below (which stops propagation) — i.e. a click on the backdrop.
        if (e.target === ref.current) ref.current?.close();
      }}
      className="w-full max-w-sm rounded-card border border-line bg-surface-raised p-0 backdrop:bg-ink/50"
    >
      <div className="flex flex-col gap-4 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">{title}</h2>
          {body ? <p className="text-sm text-ink-muted">{body}</p> : null}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => ref.current?.close()}>
            Cancel
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            size="sm"
            onClick={() => {
              onConfirm();
              ref.current?.close();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
