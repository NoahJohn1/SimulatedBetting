'use client';

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from 'react';

export interface SlipLeg {
  selectionId: string;
  gameId: string;
  /** Frozen copy of exactly what the board displayed, which is what placement re-checks. */
  line: string | null;
  priceAmerican: number;
  label: string;
  marketLabel: string;
}

const STORAGE_KEY = 'simbet.slip';
const EMPTY: SlipLeg[] = [];

/**
 * The slip is an external store rather than component state.
 *
 * It has to survive navigating between games — building a parlay across the board is the
 * whole point — and localStorage is genuinely external to React, so useSyncExternalStore is
 * the right primitive. It also avoids reading storage during render or setting state inside
 * an effect, both of which cause cascading renders.
 */
let legs: SlipLeg[] = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) legs = JSON.parse(stored) as SlipLeg[];
  } catch {
    // A corrupt slip is not worth breaking the page over; start empty.
  }
}

function write(next: SlipLeg[]): void {
  legs = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private browsing and full quotas both land here; the slip still works in memory.
  }
  emit();
}

function subscribe(listener: () => void): () => void {
  // Runs only on the client, after hydration — the safe point to read storage.
  const first = listeners.size === 0;
  listeners.add(listener);
  if (first) {
    load();
    emit();
  }
  return () => listeners.delete(listener);
}

const getSnapshot = (): SlipLeg[] => legs;
const getServerSnapshot = (): SlipLeg[] => EMPTY;

interface SlipContextValue {
  legs: SlipLeg[];
  toggle: (leg: SlipLeg) => void;
  remove: (selectionId: string) => void;
  clear: () => void;
  has: (selectionId: string) => boolean;
}

const SlipContext = createContext<SlipContextValue | null>(null);

export function BetSlipProvider({ children }: { children: React.ReactNode }) {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback((leg: SlipLeg) => {
    if (legs.some((l) => l.selectionId === leg.selectionId)) {
      write(legs.filter((l) => l.selectionId !== leg.selectionId));
      return;
    }
    // No two legs from the same game (D13) — picking a second market on a game the slip
    // already holds replaces the first rather than silently building an invalid parlay.
    write([...legs.filter((l) => l.gameId !== leg.gameId), leg]);
  }, []);

  const remove = useCallback((selectionId: string) => {
    write(legs.filter((l) => l.selectionId !== selectionId));
  }, []);

  const clear = useCallback(() => write([]), []);

  const value = useMemo<SlipContextValue>(
    () => ({
      legs: current,
      toggle,
      remove,
      clear,
      has: (id: string) => current.some((l) => l.selectionId === id),
    }),
    [current, toggle, remove, clear],
  );

  return <SlipContext.Provider value={value}>{children}</SlipContext.Provider>;
}

export function useSlip(): SlipContextValue {
  const context = useContext(SlipContext);
  if (!context) throw new Error('useSlip must be used inside a BetSlipProvider');
  return context;
}
