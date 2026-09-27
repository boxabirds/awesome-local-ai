import { type JSX } from 'react';

/**
 * The board's toast (`image.types`, `image.size_limit`, `image.count_limit`,
 * `image.offline`, `image.rate_limit`).
 *
 * A refusal has to be read where the action happened, so it sits at the bottom of
 * the board and says the reason in words. `role="status"` with `aria-live="polite"`
 * is what makes an announcement a screen reader hears without interrupting what
 * they were doing — and it is a *statement*, not an alert to dismiss: nothing here
 * takes focus, and the message disappears on its own.
 */

export interface ToastProps {
  /** The message exactly as the user is shown it. */
  message: string;
}

/** One message. */
export function Toast({ message }: ToastProps): JSX.Element {
  return (
    <div className="board-toast" data-testid="toast">
      {message}
    </div>
  );
}

export interface ToastStackProps {
  /** Newest last; nothing is rendered when empty. */
  messages: readonly string[];
}

/**
 * The stack of current messages. The container is the live region, so adding a
 * message announces it without re-announcing the ones already on screen.
 */
export function ToastStack({ messages }: ToastStackProps): JSX.Element | null {
  if (messages.length === 0) return null;
  return (
    <div
      className="board-toast-stack"
      data-testid="toast-stack"
      role="status"
      aria-live="polite"
      aria-atomic="false"
    >
      {messages.map((message, index) => (
        // The same wording can arrive twice in a row (two batches, same refusal),
        // so a key has to be the position, not the text.
        <Toast key={`${index}:${message}`} message={message} />
      ))}
    </div>
  );
}
