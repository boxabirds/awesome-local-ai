import { useSyncExternalStore } from 'react';

/** A task row's date picker (D, or the row's date chip): which task, and the row focus goes back to. */
export type RowDatePickerState = { taskId: string; row: HTMLElement | null } | null;

let state: RowDatePickerState = null;
const listeners = new Set<() => void>();

function emit(next: RowDatePickerState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function openRowDatePicker(taskId: string, row: HTMLElement | null): void {
  emit({ taskId, row });
}

export function closeRowDatePicker(): void {
  if (state) emit(null);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The open row picker (a tiny external store shared by D, the row chip and the picker host). */
export function useRowDatePicker(): RowDatePickerState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => null,
  );
}

/** Test helper. */
export function resetRowDatePickerForTests(): void {
  state = null;
  listeners.clear();
}
