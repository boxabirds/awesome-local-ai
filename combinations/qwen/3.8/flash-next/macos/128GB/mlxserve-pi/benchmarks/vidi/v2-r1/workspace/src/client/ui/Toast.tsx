// A short message at the bottom of the screen (`image.insert`).
//
// Every refusal an add action can make — an unsupported type, a file too big, too
// many at once, or being offline — is said here, in the one widget, and never thrown.
// The only job with any logic in it is that a message says itself once and then goes
// away by itself: a toast that lingered would cover the board a person is trying to
// use, and one that never repeats means a drop of ten bad files is one line, not ten
// (which is why `validateFiles` hands back a *set* of reasons, not a list).
//
// `role="status"` and `aria-live="polite"` are what make it a status announcement and
// not a visual-only flash — a screen reader hears the refusal the same sighted person
// reads it. It is fixed to the bottom of the screen and out of the pointer's way, so
// it never steals a click from an object underneath it.
//
// Spec: spec/stories/012-drop-images-onto-the-board/design.md, "Adding images".
import { useEffect, type CSSProperties, type ReactNode } from 'react';

/** How long a toast stays before it fades on its own. */
const TOAST_VISIBLE_MS = 6000;

export interface ToastProps {
  /** The message to show, or null for nothing showing. */
  message: string | null;
  /** Called when the message has been dismissed or has timed out. */
  onDismiss(): void;
}

const toastStyle: CSSProperties = {
  position: 'fixed',
  left: '50%',
  bottom: 24,
  transform: 'translateX(-50%)',
  maxWidth: '80vw',
  padding: '10px 16px',
  borderRadius: 8,
  backgroundColor: 'rgba(31, 35, 40, 0.94)',
  color: '#ffffff',
  fontSize: 14,
  lineHeight: 1.4,
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
  // A notice you read, not something you click: it must not take a click from the
  // board, and it must not scroll under a pointer that lands on it.
  pointerEvents: 'none',
  zIndex: 40,
};

/**
 * Show one message at a time, bottom-centre, that clears itself after a few seconds.
 * Changing `message` restarts the timeout, so a second refusal is given its full
 * reading time rather than inheriting the first one's remaining seconds.
 */
export function Toast({ message, onDismiss }: ToastProps): ReactNode {
  useEffect(() => {
    if (message === null) return;
    const timer = setTimeout(onDismiss, TOAST_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  if (message === null) return null;
  return (
    <div
      data-testid="toast"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      style={toastStyle}
    >
      {message}
    </div>
  );
}
