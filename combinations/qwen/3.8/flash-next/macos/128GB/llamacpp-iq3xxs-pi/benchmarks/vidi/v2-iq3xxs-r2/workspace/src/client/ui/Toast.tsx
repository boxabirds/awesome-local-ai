/**
 * Story 12: the one place a board says something in words (PRD: "One toast per kind of
 * refusal, not per file").
 *
 * A board has several things that want to interrupt somebody — an image that could not be
 * added, a batch that was too big, a connection that went out — and none of them owns the
 * screen. So the bus lives in this module rather than in a provider: the code that has the
 * bad news is often a hook several layers down, sometimes not a component at all, and
 * making every one of them thread a callback through three props to say one sentence is
 * how messages end up not being said.
 *
 * What a board *renders* is a state, and states belong to the document (story 3); this is
 * the exception, because a toast is a moment. It is not stored anywhere, so nobody else
 * sees it, and a reload loses it — which is exactly right for something whose whole job is
 * to explain the last five seconds.
 */
import { useEffect, useState, type JSX } from 'react';

export type ToastListener = (message: string) => void;

/**
 * How long a message stays up. The PRD asks for a "short toast" without a number; five
 * seconds is about how long a sentence like "Only PNG, JPEG, GIF and WebP images can be
 * added." takes to read once, and it is not a rule anybody can be annoyed by, so it lives
 * here next to the component that uses it rather than among the shared settings.
 */
export const TOAST_TIMEOUT_MS = 5_000;

/** One entry per kind of refusal, in the order they came in. */
interface Toast {
  id: number;
  message: string;
}

let NEXT_ID = 1;
const LISTENERS = new Set<ToastListener>();

/**
 * Say `message` on every toast region in this page.
 *
 * Listeners are called synchronously: a test that triggers a refusal and then looks at the
 * screen should not have to wait for a microtask to find out whether the message exists.
 */
export function showToast(message: string): void {
  if (typeof message !== 'string' || message.length === 0) return;
  for (const listener of LISTENERS) listener(message);
}

/** Start listening for toasts; returns the function that stops. */
export function subscribeToToasts(listener: ToastListener): () => void {
  LISTENERS.add(listener);
  return () => {
    LISTENERS.delete(listener);
  };
}

interface ToastState {
  toasts: readonly Toast[];
}

/**
 * The bottom-centre region the messages appear in. Every message goes away by itself after
 * `TOAST_TIMEOUT_MS` (PRD: "a toast that disappears after 5 seconds"), and each one has its
 * own timer, so a second refusal does not shorten the first one's time on the screen.
 */
export function ToastRegion(): JSX.Element {
  const [state, setState] = useState<ToastState>({ toasts: [] });

  useEffect(() => {
    return subscribeToToasts((message) => {
      const toast = { id: NEXT_ID++, message };
      setState((current) => ({ toasts: [...current.toasts, toast] }));
      setTimeout(() => {
        // Removed by identity, not by message: the same sentence said twice in a row is two
        // messages, and the second one should not cancel the first.
        setState((current) => ({ toasts: current.toasts.filter((entry) => entry.id !== toast.id) }));
      }, TOAST_TIMEOUT_MS);
    });
  }, []);

  if (state.toasts.length === 0) {
    return <div aria-live="polite" data-testid="toast-region" className="vidi6-toast-region" />;
  }
  return (
    <div aria-live="polite" data-testid="toast-region" className="vidi6-toast-region">
      {state.toasts.map((toast) => (
        <div key={toast.id} role="status" className="vidi6-toast" data-testid="toast">
          {toast.message}
        </div>
      ))}
    </div>
  );
}
