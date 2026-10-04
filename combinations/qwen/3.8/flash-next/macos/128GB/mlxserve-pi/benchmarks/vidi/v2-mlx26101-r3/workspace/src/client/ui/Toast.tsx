import type { JSX } from 'react';

export interface ToastProps {
  /**
   * What to say. Several sentences are passed as one string with the lines separated by newlines, because
   * they arrived as one event - a drop whose forty files were too big, too small and too many at once -
   * and one message that says three things is less to read than three messages that each say one.
   */
  message: string | null;
  /** Stop saying it. The timer does this by itself after a while; this is for the person in a hurry. */
  onDismiss(): void;
}

/**
 * The board's one message, at the bottom of the screen.
 *
 * `role="status"` is why this is a component rather than a line of markup in the board: it is what makes
 * the sentence get read out, by the screen reader the person is already using, as a change rather than as
 * something they have to go and look for. For that to work the region has to be on the screen *before* the
 * message arrives - an announcement that appears already holding its text is a thing a screen reader may
 * walk straight past - which is why the element below is always rendered and only its contents come and go.
 *
 * It says nothing about *what* is wrong with which file, and it is not meant to. The files that came in are
 * on the board; the files that did not are still where they were, and the sentence only has to be true.
 */
export function Toast({ message, onDismiss }: ToastProps): JSX.Element {
  const visible = message !== null;
  return (
    <div
      className="toast"
      data-testid="toast"
      data-visible={visible ? 'true' : 'false'}
      role="status"
      aria-live="polite"
    >
      {visible ? (
        <>
          <span className="toast__lines" data-testid="toast-message">
            {message.split('\n').map((line, index) => (
              <span className="toast__line" key={index}>
                {line}
              </span>
            ))}
          </span>
          <button
            type="button"
            className="toast__dismiss"
            onClick={onDismiss}
            aria-label="Dismiss message"
            data-testid="toast-dismiss"
          >
            ×
          </button>
        </>
      ) : null}
    </div>
  );
}
