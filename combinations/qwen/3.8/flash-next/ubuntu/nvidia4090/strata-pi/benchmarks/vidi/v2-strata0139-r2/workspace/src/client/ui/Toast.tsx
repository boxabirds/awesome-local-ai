import { useEffect, useSyncExternalStore } from "react";
import { TOAST_DISMISS_MS } from "../../shared/config";

/**
 * `image.insert` — the board's toast.
 *
 * One small store, module-level, because the thing that has to say something is
 * a hook (`useImageInsert`) and the thing that renders it is the screen: passing
 * messages up through props would put the wording of a validation failure in
 * every caller. Auto-dismissal is the store's job, so no caller has to remember
 * to clear anything.
 *
 * `role="status"` with `aria-live="polite"` is what makes the wording announced
 * without interrupting what the person is doing (PRD: status messages announced
 * politely).
 */

export interface Toast {
  readonly id: number;
  readonly text: string;
}

let nextId = 1;
let toasts: Toast[] = [];
let snapshot: Toast[] = toasts;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit(): void {
  snapshot = toasts;
  for (const listener of Array.from(listeners)) listener();
}

/** Shows a message at the bottom of the board for `TOAST_DISMISS_MS`. */
export function showToast(text: string): void {
  if (typeof text !== "string" || text.length === 0) return;
  const toast: Toast = { id: nextId, text };
  nextId += 1;
  toasts = [...toasts, toast];
  emit();
  timers.set(toast.id, setTimeout(() => dismissToast(toast.id), TOAST_DISMISS_MS));
}

export function dismissToast(id: number): void {
  const timer = timers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(id);
  }
  if (!toasts.some((toast) => toast.id === id)) return;
  toasts = toasts.filter((toast) => toast.id !== id);
  emit();
}

/** Clears every message (tests, and a screen that is leaving the board). */
export function clearToasts(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  if (toasts.length === 0) return;
  toasts = [];
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Toast[] {
  return snapshot;
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** The messages themselves, in the order they appeared. */
export function toastTexts(): string[] {
  return snapshot.map((toast) => toast.text);
}

export function ToastHost() {
  const toasts = useToasts();

  // A screen that goes away takes its messages with it: a toast about a drop on
  // one board has nothing to say on the next one.
  useEffect(() => clearToasts, []);

  return (
    <div
      className="toast-host"
      data-testid="toast-host"
      role="status"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((toast) => (
        <p key={toast.id} className="toast" data-testid="toast">
          <span className="toast-text" data-testid="toast-text">{toast.text}</span>
          <button
            type="button"
            className="toast-dismiss"
            data-testid="toast-dismiss"
            aria-label="Dismiss message"
            onClick={() => dismissToast(toast.id)}
          >
            ×
          </button>
        </p>
      ))}
    </div>
  );
}
