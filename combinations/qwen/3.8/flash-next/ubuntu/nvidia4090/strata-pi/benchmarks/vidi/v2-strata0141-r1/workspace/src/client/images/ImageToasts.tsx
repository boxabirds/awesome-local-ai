import type { ImageToast } from './useImageInsert';

/**
 * The messages an add produced (`image.feedback`).
 *
 * The PRD asks for "a short toast at the bottom of the screen for refused files",
 * and the interesting cases are all batches - a drop of a PDF, an 11 MB file and a
 * PNG. So this is a list rather than a single message: one line per reason the
 * batch failed, each saying how many files it is about, and the supported files from
 * the same action are on the board behind them. A person who drops eight files and
 * gets two notes and six images needs to be told about the two, not about one.
 *
 * Each one is dismissable and each one goes away by itself; the timing is the
 * hook's (`IMAGE_TOAST_DISMISS_MS`), because a message that never leaves the screen
 * is a second object a person has to deal with.
 */
export function ImageToasts({
  toasts,
  onDismiss,
}: {
  toasts: readonly ImageToast[];
  onDismiss(id: number): void;
}) {
  if (toasts.length === 0) {
    return null;
  }
  return (
    <div className="image-toasts" data-testid="image-toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <p
          key={toast.id}
          className={`image-toast image-toast--${toast.reason}`}
          data-testid={`image-toast-${toast.reason}`}
          data-reason={toast.reason}
          data-count={toast.count}
        >
          <span className="image-toast__message">{toast.message}</span>
          <button
            type="button"
            className="image-toast__dismiss"
            data-testid={`image-toast-dismiss-${toast.reason}`}
            aria-label="Dismiss"
            onClick={() => {
              onDismiss(toast.id);
            }}
          >
            ×
          </button>
        </p>
      ))}
    </div>
  );
}
