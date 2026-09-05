'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

/**
 * A hand-rolled bottom sheet rather than `ConfirmDialog`'s native `<dialog>` (D79): the slip
 * needs to pin to the viewport's bottom edge with safe-area padding, not the centered
 * placement a native `showModal()` gives for free. What that trade costs — the focus trap and
 * ESC handling `<dialog>` gets from the platform — this component does by hand instead.
 *
 * Motion (Task 15): the panel slides up on enter and reverses on exit, via a `data-state` flip
 * plus the CSS transition on `--motion-base` (globals.css) — 0s, hence inert, unless
 * `prefers-reduced-motion: no-preference` says otherwise. `present` is what makes the exit
 * half possible: it outlives `open` by `EXIT_MS` so the panel stays mounted — and the slide-down
 * has a node to animate — for the ~150ms the transition needs, then actually unmounts.
 */

const EXIT_MS = 150;

const emptySubscribe = () => () => {};

function prefersMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: no-preference)').matches
  );
}

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

  // `present` controls mounting; `entered` controls the visual (open/closed) data-state. They
  // diverge exactly during an exit: `present` stays true for EXIT_MS after `open` goes false so
  // the slide-down has a node to animate on, `entered` flips false the instant `open` does.
  const [present, setPresent] = useState(open);
  const [entered, setEntered] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Adjusted during render (React's documented pattern for reacting to a prop change without
  // an effect's one-render lag — state only, never a ref, which the project's react-hooks/refs
  // rule forbids reading or writing during render): an effect would leave `present` false for
  // one extra render right when `open` flips true, and the focus effect below — which expects
  // the panel already in the DOM the instant `open` does — would focus a still-null ref.
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setPresent(true);
    } else {
      setEntered(false);
      if (!prefersMotion()) setPresent(false);
    }
  }

  // The enter half: mount at the closed transform, then flip a frame later so the browser has
  // a "from" state to transition out of.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // The exit half: `present` was left true above; unmount for real once the transition (or, at
  // reduced motion, nothing) has had time to play. Its cleanup also cancels a pending unmount
  // if the sheet reopens before the timer fires (deps change, so the previous instance's
  // cleanup runs before this one's guard skips scheduling a new timer).
  useEffect(() => {
    if (open || !present) return;
    exitTimerRef.current = setTimeout(() => setPresent(false), EXIT_MS);
    return () => {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    };
  }, [open, present]);

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

  if (!mounted || !present) return null;

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
        data-state={entered ? 'open' : 'closed'}
        onClick={(event) => event.stopPropagation()}
        className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] translate-y-full overflow-y-auto rounded-t-card border-t border-line bg-surface-raised pb-[env(safe-area-inset-bottom)] outline-none transition-transform duration-[var(--motion-base)] ease-out data-[state=open]:translate-y-0"
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
