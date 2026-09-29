// A sentence the board says to one person, at the bottom of the screen (story 12).
//
// The messages that live here are the story's failure vocabulary: what was refused and why,
// what is taking too long, what did not finish. They are short, they name what happened rather
// than what went wrong internally, and they disappear by themselves — a message about a
// transient thing that stayed on screen would become part of the furniture.
//
// The queue is a module store rather than a prop passed down from `useImageInsert`, because the
// hook that has something to say and the place it is displayed are far apart in the tree, and
// because the alternative — threading a toast list through BoardApp into the viewport into the
// toolbar — would make every component between them a component that has an opinion about
// pictures. `ToastHost` is mounted once, by the board, and anything in the board can speak.

import { useSyncExternalStore } from 'react';
import { TOAST_DISMISS_MS } from '../../shared/config.ts';

export type ToastTone = 'info' | 'warning';

export interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

let items: ToastItem[] = [];
let listeners = new Set<() => void>();
let nextId = 1;
/** Timers by toast id, so a dismissed toast's timer cannot dismiss anything else later. */
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

function scheduleDismiss(id: number): void {
  const timer = setTimeout(() => dismissToast(id), TOAST_DISMISS_MS);
  // A message that removes itself must not hold a hidden page's timer open.
  (timer as unknown as { unref?: () => void }).unref?.();
  timers.set(id, timer);
}

/** Say something for a few seconds. Returns the id it was said under. */
export function pushToast(message: string, tone: ToastTone = 'warning'): number {
  const toast: ToastItem = { id: nextId++, message, tone };
  items = [...items, toast];
  scheduleDismiss(toast.id);
  emit();
  return toast.id;
}

export function dismissToast(id: number): void {
  const timer = timers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(id);
  }
  const next = items.filter((toast) => toast.id !== id);
  if (next.length === items.length) return;
  items = next;
  emit();
}

/** Only used by tests: a board that has already said something should not start a scene. */
export function clearToasts(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  if (items.length === 0) return;
  items = [];
  emit();
}

export function getToasts(): readonly ToastItem[] {
  return items;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useToasts(): readonly ToastItem[] {
  return useSyncExternalStore(subscribe, getToasts, getToasts);
}

export interface ToastHostProps {
  onDismiss?(id: number): void;
}

/**
 * The toast area. One live region, polite: a person reading the board aloud should hear that
 * their file was refused, and should not be dragged away from what they were doing to hear it.
 */
export function ToastHost({ onDismiss = dismissToast }: ToastHostProps) {
  const toasts = useToasts();
  return (
    <div className="toast-host" data-testid="toast-host" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="toast"
          data-testid="toast"
          data-toast-tone={toast.tone}
          data-toast-id={toast.id}
        >
          <span className="toast-message" data-testid="toast-message">{toast.message}</span>
          <button
            type="button"
            className="toast-dismiss"
            aria-label="Dismiss message"
            onClick={() => onDismiss(toast.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
