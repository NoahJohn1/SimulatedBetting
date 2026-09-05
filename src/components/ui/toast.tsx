'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * The announcement layer (D76). One ToastProvider mounted in the (app) shell; every screen
 * reaches it through useToast(). A portal at the viewport edge, a polite live region so a
 * screen reader announces without interrupting, auto-dismiss with pause-on-hover, and a
 * queue capped at three so a burst of results doesn't bury the member in stacked banners.
 *
 * Motion (Task 15): each toast fades and rises on enter, reversed on exit, via a `data-state`
 * flip plus the CSS transition on `--motion-base` (globals.css) — 0s, hence inert, unless
 * `prefers-reduced-motion: no-preference` says otherwise. `dismiss` marks an item `closing`
 * before actually removing it ~150ms later, giving the exit transition room to play; queue-cap
 * eviction (the `slice(-2)` below) is a hard drop, not a `dismiss`, and stays instant.
 */

type Tone = 'positive' | 'negative' | 'neutral';
interface ToastInput {
  tone: Tone;
  title: string;
  description?: string;
}
interface ToastItem extends ToastInput {
  id: string;
  closing?: boolean;
}

const ToastContext = createContext<{ toast: (t: ToastInput) => void } | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast outside ToastProvider');
  return ctx;
}

const DISMISS_MS = 5000;
const EXIT_MS = 150;

const emptySubscribe = () => () => {};

function prefersMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: no-preference)').matches
  );
}

/** One toast's own enter transition — a frame after mount, so the browser has a "from" state
 *  to transition out of. Exit is driven by the parent's `closing` flag instead of local state,
 *  since ToastProvider is what decides when the item finally leaves the array. */
function ToastCard({
  item,
  onDismiss,
  onPause,
  onResume,
}: {
  item: ToastItem;
  onDismiss: () => void;
  onPause: () => void;
  onResume: () => void;
}) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      data-state={!item.closing && entered ? 'open' : 'closed'}
      onMouseEnter={onPause}
      onMouseLeave={onResume}
      className="pointer-events-auto flex w-full max-w-sm translate-y-2 items-start justify-between gap-3 rounded-card border border-line bg-surface-raised p-3 opacity-0 shadow-slip transition-[opacity,transform] duration-[var(--motion-base)] ease-out data-[state=open]:translate-y-0 data-[state=open]:opacity-100"
    >
      <div className="flex flex-col gap-0.5">
        <span
          className={`text-sm font-semibold ${item.tone === 'negative' ? 'text-negative' : item.tone === 'positive' ? 'text-positive' : ''}`}
        >
          {item.title}
        </span>
        {item.description && <span className="text-xs text-ink-muted">{item.description}</span>}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="text-xs text-ink-muted"
      >
        ✕
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  // Hydration-safe client check: server snapshot false, client snapshot true. No effect,
  // no setState — avoids the cascading-render lint that a useState+useEffect gate trips.
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    timers.current.delete(id);
    if (prefersMotion()) {
      setItems((all) => all.map((t) => (t.id === id ? { ...t, closing: true } : t)));
      setTimeout(() => {
        setItems((all) => all.filter((t) => t.id !== id));
      }, EXIT_MS);
    } else {
      setItems((all) => all.filter((t) => t.id !== id));
    }
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      const id = crypto.randomUUID();
      setItems((all) => [...all.slice(-2), { ...input, id }]); // queue of 3
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DISMISS_MS),
      );
    },
    [dismiss],
  );

  const pause = (id: string) => clearTimeout(timers.current.get(id));
  const resume = (id: string) =>
    timers.current.set(
      id,
      setTimeout(() => dismiss(id), DISMISS_MS),
    );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {mounted &&
        createPortal(
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6"
          >
            {items.map((t) => (
              <ToastCard
                key={t.id}
                item={t}
                onDismiss={() => dismiss(t.id)}
                onPause={() => pause(t.id)}
                onResume={() => resume(t.id)}
              />
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}
