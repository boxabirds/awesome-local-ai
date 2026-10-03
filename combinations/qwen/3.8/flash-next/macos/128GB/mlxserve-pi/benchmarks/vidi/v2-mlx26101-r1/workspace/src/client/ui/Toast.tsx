// One line of news, at the bottom of the screen, that says what happened and goes away (story 12).
//
// The toast exists because a person can put a file on the board and never see the reason it did not
// land. The PRD is exact about the words ("Only PNG, JPEG, GIF and WebP images can be added." and the
// three messages around it), and about the shape: a message is *short*, it is *at the bottom*, and it
// does not stay. It is also the only place a refusal is written down — nothing is added to the board
// and nothing is added to the document, so if the toast does not say it, nobody will ever know.
//
// Two things it deliberately is not:
//   * Not a queue. Nine oversized files in one drop are one message about size, not nine toasts
//     (image.mixed_batch), so a repeat of the same text restarts the existing toast's timer instead of
//     stacking another copy of itself up the screen.
//   * Not a dialog. Nothing here takes focus, steals a keystroke or has to be dismissed before the
//     board works again — a story 12 refusal is information, and the board underneath is still the
//     thing a person is doing.

import { useCallback, useEffect, useRef, useState } from 'react';

/** How long a toast stays up. Long enough to read twice, short enough to ignore. */
export const TOAST_VISIBLE_MS = 6_000;

export interface ToastItem {
  id: number;
  text: string;
}

export interface ToastApi {
  toasts: readonly ToastItem[];
  /** Say `text`. If that exact message is already up, it is the same news and only its timer moves. */
  show(text: string): void;
  /** Put one away now (the toast's own close button). */
  dismiss(id: number): void;
}

let nextToastId = 1;

/**
 * The messages currently on screen, and the way to put one there.
 *
 * The timers live in one effect over the list rather than one per toast, so a message that is
 * refreshed twenty times does not leave twenty timers behind, and so everything outstanding is
 * cleared when the board unmounts.
 */
export function useToasts(): ToastApi {
  const [toasts, setToasts] = useState<readonly ToastItem[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number): void => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback((text: string): void => {
    setToasts((current) => {
      // The same news twice is one piece of news (image.mixed_batch).
      if (current.some((toast) => toast.text === text)) return current;
      return [...current, { id: nextToastId++, text }];
    });
  }, []);

  useEffect(() => {
    for (const toast of toasts) {
      if (timers.current.has(toast.id)) continue;
      timers.current.set(
        toast.id,
        setTimeout(() => dismiss(toast.id), TOAST_VISIBLE_MS),
      );
    }
  }, [toasts, dismiss]);

  useEffect(() => {
    const outstanding = timers.current;
    return () => {
      for (const timer of outstanding.values()) clearTimeout(timer);
      outstanding.clear();
    };
  }, []);

  return { toasts, show, dismiss };
}

/**
 * The toasts themselves, at the bottom of the screen. `role=status` on a live region, so the message
 * is announced to somebody using a screen reader as the news it is, rather than being a thing they
 * have to go and find (image.accepted_types and its three siblings are all about being told).
 */
export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: readonly ToastItem[];
  onDismiss(id: number): void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div
      className="toast-stack"
      data-testid="toast-stack"
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        zIndex: 40,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          data-testid="toast"
          data-toast-text={toast.text}
          style={{
            pointerEvents: 'auto',
            maxWidth: 'min(560px, 80vw)',
            padding: '10px 14px',
            borderRadius: 8,
            background: 'rgba(28, 29, 33, 0.94)',
            color: '#fff',
            fontSize: 13,
            lineHeight: 1.4,
            boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span>{toast.text}</span>
          <button
            type="button"
            aria-label="Dismiss this message"
            data-testid="toast-dismiss"
            onClick={() => onDismiss(toast.id)}
            style={{
              border: 'none',
              background: 'transparent',
              color: '#c9cbd2',
              cursor: 'pointer',
              fontSize: 14,
              lineHeight: 1,
              padding: 2,
            }}
          >
            {'\u00D7'}
          </button>
        </div>
      ))}
    </div>
  );
}
