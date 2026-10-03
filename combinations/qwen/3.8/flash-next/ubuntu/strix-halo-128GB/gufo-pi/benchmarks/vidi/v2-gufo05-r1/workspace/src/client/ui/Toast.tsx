/**
 * The board's toast: one line at the bottom, for the things that went wrong and that a
 * person needs to be told about once (`image.types`, `image.size_limit`, `image.offline`).
 *
 * It is a module-level store rather than a hook the board threads through its props, and
 * that is deliberate. The things that need to say something — the file validation in an
 * add action, an upload that came back 415, a board that is offline — are reached from
 * callbacks and from worker code that has no route to a component's state, and the
 * alternative to a store is passing a `notify` function down through every hook that might
 * refuse a file. `showToast` is the whole interface; `<ToastHost />` is the whole view.
 *
 * Three lines maximum, newest at the top of the pile, each gone after `TOAST_VISIBLE_MS`.
 * A drop of forty bad files is one message about the type, not forty, because
 * `validateFiles` reports each refusal once (`image.count_limit`) — the cap here is the
 * backstop for a caller that ignores that and reports per file.
 *
 * It is one `role="status"` live region, so a screen reader hears a message arrive without
 * the board's focus moving. The host layer is `pointer-events: none` so the strip of space it
 * occupies never eats a click meant for the board; an individual toast takes pointers again,
 * because it has a dismiss button that has to be reachable.
 */
import { useEffect, useState } from 'react';

/** How long one toast stays up. Long enough to read twice, short enough to never pile up. */
const TOAST_VISIBLE_MS = 6000;

/** The most the board will show at once. */
const TOAST_LIMIT = 3;

export interface Toast {
  readonly id: number;
  readonly message: string;
}

let nextToastId = 1;
let toasts: Toast[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/**
 * Put `message` at the bottom of the board, and take it away again later.
 *
 * Returns the toast's id, so a caller that knows when the message has stopped being true —
 * a retry that worked — can dismiss it early. Nothing else has to: a toast is a notice, not
 * a dialog, and nobody is required to acknowledge it.
 */
export function showToast(message: string): number {
  const id = nextToastId;
  nextToastId += 1;
  toasts = [...toasts, { id, message }].slice(-TOAST_LIMIT);
  emit();
  setTimeout(() => {
    dismissToast(id);
  }, TOAST_VISIBLE_MS);
  return id;
}

/** Take one toast away. Absent ids are ignored: it may already have timed out. */
export function dismissToast(id: number): void {
  const next = toasts.filter((toast) => toast.id !== id);
  if (next.length === toasts.length) return;
  toasts = next;
  emit();
}

/** Take every toast away. For tests, and for leaving a board. */
export function clearToasts(): void {
  if (toasts.length === 0) return;
  toasts = [];
  emit();
}

/** What is on screen right now. Exported for tests that assert without a DOM query. */
export function activeToasts(): readonly Toast[] {
  return toasts;
}

/**
 * The toast layer. Render it once, above the board, and it shows whatever `showToast`
 * put there.
 */
export function ToastHost() {
  const [visible, setVisible] = useState<readonly Toast[]>(toasts);

  useEffect(() => {
    const listener = () => {
      setVisible([...toasts]);
    };
    listeners.add(listener);
    // A toast may have been raised before this host mounted — the first refusal of a drop
    // on a board that is still painting — so sync once on the way in.
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);

  if (visible.length === 0) {
    // The region stays in the DOM with nothing in it: a live region that appears at the
    // same moment its message does is read as nothing at all by some screen readers.
    return <div className="toast-host" data-testid="toast-host" role="status" aria-live="polite" />;
  }

  return (
    <div className="toast-host" data-testid="toast-host" role="status" aria-live="polite">
      {visible.map((toast) => (
        <div className="toast" data-testid="toast" key={toast.id}>
          <span className="toast__message">{toast.message}</span>
          <button
            type="button"
            className="toast__dismiss"
            data-testid="toast-dismiss"
            aria-label="Dismiss"
            onClick={() => {
              dismissToast(toast.id);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
