'use client';
import {
  createContext,
  useCallback,
  useContext,
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
 */

type Tone = 'positive' | 'negative' | 'neutral';
interface ToastInput {
  tone: Tone;
  title: string;
  description?: string;
}
interface ToastItem extends ToastInput {
  id: string;
}

const ToastContext = createContext<{ toast: (t: ToastInput) => void } | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast outside ToastProvider');
  return ctx;
}

const DISMISS_MS = 5000;

const emptySubscribe = () => () => {};

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
    setItems((all) => all.filter((t) => t.id !== id));
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
              <div
                key={t.id}
                onMouseEnter={() => pause(t.id)}
                onMouseLeave={() => resume(t.id)}
                className="pointer-events-auto flex w-full max-w-sm items-start justify-between gap-3 rounded-card border border-line bg-surface-raised p-3 shadow-slip"
              >
                <div className="flex flex-col gap-0.5">
                  <span
                    className={`text-sm font-semibold ${t.tone === 'negative' ? 'text-negative' : t.tone === 'positive' ? 'text-positive' : ''}`}
                  >
                    {t.title}
                  </span>
                  {t.description && <span className="text-xs text-ink-muted">{t.description}</span>}
                </div>
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={() => dismiss(t.id)}
                  className="text-xs text-ink-muted"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}
