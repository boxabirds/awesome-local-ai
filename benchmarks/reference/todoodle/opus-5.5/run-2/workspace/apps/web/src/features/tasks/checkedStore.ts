import { useCallback, useSyncExternalStore } from 'react';

/*
 * The checkbox state a user just asked for, shown before the cache catches up: a completed tick
 * appears at once while the row plays its leaving animation, and an unticked completed row shows
 * open while it moves back. Cleared by the row once it renders data that agrees (or unmounts), and
 * by the mutation when the change is rolled back. Rows
 * subscribe to their own id only, so a tick never re-renders other rows.
 */

/** `leaving`: a completion playing its leaving animation (never under reduced motion). */
export type PendingCheck = { checked: boolean; leaving: boolean };

const pending = new Map<string, PendingCheck>();
const listeners = new Map<string, Set<() => void>>();

function emit(id: string) {
  for (const listener of listeners.get(id) ?? []) listener();
}

export const checkedStore = {
  set(id: string, checked: boolean, leaving = false): void {
    const current = pending.get(id);
    if (current && current.checked === checked && current.leaving === leaving) return;
    pending.set(id, { checked, leaving });
    emit(id);
  },
  clear(id: string): void {
    if (!pending.delete(id)) return;
    emit(id);
  },
  get(id: string): PendingCheck | undefined {
    return pending.get(id);
  },
  subscribe(id: string, listener: () => void): () => void {
    let set = listeners.get(id);
    if (!set) {
      set = new Set();
      listeners.set(id, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) listeners.delete(id);
    };
  },
  /** Test hook: as after a page load. */
  resetForTests(): void {
    pending.clear();
  },
};

/** The pending checked state for a task, or undefined when there is none. */
export function usePendingCheck(id: string): PendingCheck | undefined {
  const subscribe = useCallback((listener: () => void) => checkedStore.subscribe(id, listener), [id]);
  return useSyncExternalStore(subscribe, () => checkedStore.get(id), () => undefined);
}
