import { useSyncExternalStore, type JSX } from 'react';

/**
 * The board's status messages (PRD accessibility: "status messages announced
 * politely"), bottom-centre, and the only place a message like
 * "Only PNG, JPEG, GIF and WebP images can be added." is decided to appear.
 *
 * It is a module store, not a hook's state, because the code that has something to
 * say is `useImageInsert`, which is not the component that renders toasts and should
 * not have to be. `showToast` is safe to call from anywhere, including outside React;
 * `Toast` renders whatever is currently showing, each message with `role="status"` so
 * a screen reader reads it in the background rather than interrupting.
 */

/** How long a message sits there. Long enough to read twice, short enough to ignore. */
const TOAST_DISMISS_MS = 8000;
/** A batch of refusals is one stack of messages, not an infinite column. */
const MAX_TOASTS = 4;

export interface ToastMessage {
  readonly id: number;
  readonly text: string;
}

let toasts: readonly ToastMessage[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit(): void {
  for (const listener of listeners) listener();
}

function dismiss(id: number): void {
  const timer = timers.get(id);
  if (timer !== undefined) clearTimeout(timer);
  timers.delete(id);
  const next = toasts.filter((toast) => toast.id !== id);
  if (next.length === toasts.length) return;
  toasts = next;
  emit();
}

/**
 * Show `text` at the bottom of the board for `TOAST_DISMISS_MS`. Identical text
 * arriving twice (two drops, no re-validation) is shown again rather than merged:
 * the second one is the answer to something the person just did.
 */
export function showToast(text: string): void {
  const message = String(text ?? '').trim();
  if (!message) return;
  const toast: ToastMessage = { id: nextId++, text: message };
  const next = [...toasts, toast];
  // A message that is pushed off the top has to lose its timer as well, or the timer
  // outlives the thing it was set for and fires `dismiss` for a message that is gone.
  for (const pushed of next.slice(0, Math.max(0, next.length - MAX_TOASTS))) {
    const timer = timers.get(pushed.id);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(pushed.id);
  }
  toasts = next.slice(-MAX_TOASTS);
  timers.set(toast.id, setTimeout(() => dismiss(toast.id), TOAST_DISMISS_MS));
  emit();
}

/** Every message showing, oldest first. */
export function getToasts(): readonly ToastMessage[] {
  return toasts;
}

export function subscribeToToasts(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** What is on screen, for a component that wants to react to it (a test, mostly). */
export function useToasts(): readonly ToastMessage[] {
  return useSyncExternalStore(subscribeToToasts, getToasts, getToasts);
}

/**
 * The toast host: one node per message, in the order they arrived. It never takes a
 * pointer event, so a message cannot swallow a click on the board under it.
 */
export function ToastHost(): JSX.Element | null {
  const current = useToasts();
  if (current.length === 0) return null;
  return (
    <div className="toast-stack" data-testid="toast-stack">
      {current.map((toast) => (
        <p key={toast.id} className="toast" data-testid="toast" role="status">
          {toast.text}
        </p>
      ))}
    </div>
  );
}

/**
 * Forget everything, and stop every timer. Tests only: without it a message from one
 * test is still on screen in the next one, which is a lie about what was shown.
 */
export function clearToasts(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  toasts = [];
  emit();
}
