/**
 * Bottom-of-screen status messages (story 12, image.insert).
 *
 * A tiny module-level store rather than React state: the messages are raised
 * from imperative code (upload results, validation, the file picker) that lives
 * outside the React tree, and the announcer must be able to show several messages
 * at once. `role="status"` with `aria-live="polite"` makes screen readers read
 * each message without interrupting what the user is doing (PRD Accessibility).
 */
import { useSyncExternalStore, type JSX } from 'react';
import { TOAST_DURATION_MS } from '../../shared/config';

interface ToastItem {
  id: number;
  message: string;
}

let nextId = 0;
let items: ToastItem[] = [];
let snapshot: readonly string[] = [];
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function publish(): void {
  snapshot = items.map((item) => item.message);
  for (const listener of [...listeners]) listener();
}

/** Show `message` at the bottom of the screen. Identical messages stack separately. */
export function showToast(message: string): void {
  if (!message) return;
  const item = { id: ++nextId, message };
  items = [...items, item];
  publish();
  timers.set(
    item.id,
    setTimeout(() => {
      dismissToast(item.id);
    }, TOAST_DURATION_MS),
  );
}

/** Hide a message early (used by tests and by the dismiss control). */
export function dismissToast(id: number): void {
  const timer = timers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(id);
  }
  if (!items.some((item) => item.id === id)) return;
  items = items.filter((item) => item.id !== id);
  publish();
}

/** Hide every message and cancel their timers. */
export function clearToasts(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  items = [];
  publish();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): readonly string[] {
  return snapshot;
}

/** The message strip itself; mount once, near the board root. */
export function ToastHost(): JSX.Element | null {
  const messages = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  if (messages.length === 0) return null;
  return (
    <div className="toast-host" data-testid="toast-host" role="status" aria-live="polite">
      {messages.map((message, index) => (
        <div className="toast" data-testid="toast" key={`${index}-${message}`}>
          <span className="toast-text">{message}</span>
          <button
            type="button"
            className="toast-close"
            aria-label="Dismiss message"
            onClick={() => dismissToast(items[index]?.id ?? -1)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
