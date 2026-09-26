import { useCallback, useSyncExternalStore } from 'react';

// Which tasks have a change in flight (row aria-busy). A tiny external store keyed by task id, so a row
// re-renders only when its own busy flag flips.

const pending = new Map<string, number>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** A change to this task started. Pair every call with endBusy. */
export function startBusy(id: string): void {
  pending.set(id, (pending.get(id) ?? 0) + 1);
  if (pending.get(id) === 1) emit();
}

export function endBusy(id: string): void {
  const count = (pending.get(id) ?? 0) - 1;
  if (count > 0) {
    pending.set(id, count);
    return;
  }
  if (pending.delete(id)) emit();
}

export function isTaskBusy(id: string): boolean {
  return pending.has(id);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True while any change to this task is saving. */
export function useTaskBusy(id: string): boolean {
  const get = useCallback(() => pending.has(id), [id]);
  return useSyncExternalStore(subscribe, get, get);
}

/** Test helper. */
export function clearTaskBusyForTests(): void {
  pending.clear();
  emit();
}
