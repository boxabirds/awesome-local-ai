import { useSyncExternalStore } from 'react';

/** The Move to… picker: which task it is open for, and the row focus returns to when it closes without a move. */
export type MovePickerState = { taskId: string; row: HTMLElement | null } | null;

let state: MovePickerState = null;
const listeners = new Set<() => void>();

function emit(next: MovePickerState): void {
  state = next;
  for (const listener of listeners) listener();
}

/** Opens Move to… for a task (the row's '…' menu, or M on the focused row). */
export function openMovePicker(taskId: string, row: HTMLElement | null): void {
  emit({ taskId, row });
}

export function closeMovePicker(): void {
  if (state) emit(null);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The picker's state (a tiny external store: the row menu, M and the picker host share it). */
export function useMovePicker(): MovePickerState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => null,
  );
}

/** Test helper. */
export function resetMovePickerForTests(): void {
  state = null;
  listeners.clear();
}
