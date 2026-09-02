'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import type { Currency } from '@/db/schema';

export interface SlipLeg {
  selectionId: string;
  /**
   * The dedup group key, not literally a game id: a sports leg carries its game's id, a
   * custom-event leg carries its event's id. Grouping on it is what makes the courtesy below
   * agree with the server's real key, `markets.event_id`.
   */
  gameId: string;
  /** Frozen copy of exactly what the board displayed, which is what placement re-checks. */
  line: string | null;
  priceAmerican: number;
  label: string;
  marketLabel: string;
  /** CASH for a game, CREDITS for a custom event. One slip, one denomination (D31). */
  currency: Currency;
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

/**
 * A slip written before credits existed has legs with no `currency`. Reading it as CASH is
 * both what it was and what keeps an in-flight cash slip working across the deploy.
 */
function currencyOf(leg: SlipLeg): Currency {
  return leg.currency ?? 'CASH';
}

interface SlipContextValue {
  legs: SlipLeg[];
  /** The slip's denomination, taken from the first leg. CASH while the slip is empty. */
  currency: Currency;
  toggle: (leg: SlipLeg) => void;
  remove: (selectionId: string) => void;
  clear: () => void;
  has: (selectionId: string) => boolean;
  /** Why the last tap did nothing, when it did nothing. Null the rest of the time. */
  notice: string | null;
  dismissNotice: () => void;
}

const SlipContext = createContext<SlipContextValue | null>(null);

export function BetSlipProvider({ children }: { children: React.ReactNode }) {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [notice, setNotice] = useState<string | null>(null);

  const toggle = useCallback((leg: SlipLeg) => {
    if (legs.some((l) => l.selectionId === leg.selectionId)) {
      write(legs.filter((l) => l.selectionId !== leg.selectionId));
      setNotice(null);
      return;
    }

    // Cash and credits cannot share one stake (D31). The server rejects a mixed slip with
    // MIXED_CURRENCY_PARLAY regardless; refusing here just means the rejection arrives as a
    // sentence at the moment of the tap instead of after a submit.
    const incoming = currencyOf(leg);
    if (legs.length > 0 && currencyOf(legs[0]) !== incoming) {
      setNotice(
        incoming === 'CREDITS'
          ? 'Clear your slip to bet on an event — events are bet in credits.'
          : 'Clear your slip to bet on a game — games are bet in cash.',
      );
      return;
    }

    setNotice(null);
    // No two legs from the same game (D13) — picking a second market on a game the slip
    // already holds replaces the first rather than silently building an invalid parlay.
    // The same key is the event id for a custom-event leg, so it covers events too.
    write([...legs.filter((l) => l.gameId !== leg.gameId), leg]);
  }, []);

  const remove = useCallback((selectionId: string) => {
    setNotice(null);
    write(legs.filter((l) => l.selectionId !== selectionId));
  }, []);

  const clear = useCallback(() => {
    setNotice(null);
    write([]);
  }, []);

  const dismissNotice = useCallback(() => setNotice(null), []);

  const value = useMemo<SlipContextValue>(
    () => ({
      legs: current,
      currency: current.length > 0 ? currencyOf(current[0]) : 'CASH',
      toggle,
      remove,
      clear,
      has: (id: string) => current.some((l) => l.selectionId === id),
      notice,
      dismissNotice,
    }),
    [current, toggle, remove, clear, notice, dismissNotice],
  );

  return <SlipContext.Provider value={value}>{children}</SlipContext.Provider>;
}

export function useSlip(): SlipContextValue {
  const context = useContext(SlipContext);
  if (!context) throw new Error('useSlip must be used inside a BetSlipProvider');
  return context;
}
