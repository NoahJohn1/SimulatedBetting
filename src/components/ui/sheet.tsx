'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

/**
 * A hand-rolled bottom sheet rather than `ConfirmDialog`'s native `<dialog>` (D79): the slip
 * needs to pin to the viewport's bottom edge with safe-area padding, not the centered
 * placement a native `showModal()` gives for free. What that trade costs — the focus trap and
 * ESC handling `<dialog>` gets from the platform — this component does by hand instead.
 *
 * No animation yet; motion is Task 15 (7d).
 */

const emptySubscribe = () => () => {};

export function Sheet({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  // Hydration-safe client check (matches toast.tsx): server snapshot false, client snapshot
  // true. No effect, no setState — avoids the cascading-render lint an effect+useState gate
  // trips, and the portal target (document.body) does not exist during SSR anyway.
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  useEffect(() => {
    if (!open) return;

    // Remember what had focus before the sheet opened, so closing can hand it back — the same
    // shape as ConfirmDialog's invokerRef.
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      restoreFocusRef.current?.focus();
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-40 bg-surface-sunken/60"
      // A click lands here only when it misses the panel below (which stops propagation) —
      // i.e. a click on the scrim.
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-card border-t border-line bg-surface-raised pb-[env(safe-area-inset-bottom)] outline-none"
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
