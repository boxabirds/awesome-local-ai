/**
 * A message at the bottom of the board that says what just went wrong (story 12).
 *
 * It is not a dialog: it takes nothing away from what the person was doing, it cannot be the thing
 * that makes a dropped file disappear, and it goes away by itself. `role="status"` is what makes a
 * screen reader read it when it appears, and the element stays the same node while the text changes
 * so the change is announced rather than the region being new.
 *
 * The wording is the PRD's, and it is passed in rather than written here: the reason a file was not
 * added is decided by `validateFiles` and `useImageInsert`, and this component only says it.
 */
import { useEffect, type JSX } from 'react';

/** How long a message stays up. Long enough to read twice, short enough not to be scenery. */
export const TOAST_DISMISS_MS = 6000;

export interface ToastMessage {
  readonly id: number;
  readonly text: string;
}

export interface ToastProps {
  /** The messages currently on show, oldest first. Nothing is rendered when there are none. */
  messages: readonly ToastMessage[];
  /** Called once the display time has run out. */
  onDismiss(): void;
}

export function Toast({ messages, onDismiss }: ToastProps): JSX.Element | null {
  // One timer for the batch: the messages of one refused action arrive together, and a person who
  // is still reading one was almost certainly reading the other.
  useEffect(() => {
    if (messages.length === 0) return;
    const timer = setTimeout(onDismiss, TOAST_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [messages, onDismiss]);

  if (messages.length === 0) return null;

  return (
    <div className="board-toast" data-testid="board-toast">
      {messages.map((message) => (
        <p className="board-toast__message" key={message.id} role="status">
          {message.text}
        </p>
      ))}
    </div>
  );
}
