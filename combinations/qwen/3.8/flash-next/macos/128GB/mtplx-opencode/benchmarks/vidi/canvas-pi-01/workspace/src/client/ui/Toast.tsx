/**
 * Story 12 · the toast (design "Toast.tsx — new").
 *
 * A short message that appears over the board for about three seconds and is
 * never a control — no button, not focusable, `aria-live="polite"` so a
 * screen reader announces it without stealing focus (PRD: the failed-upload
 * message "is a toast ... never a modal or a dialog"). There is no progress in
 * it: a multi-file upload shows that on the placeholders themselves, not here.
 *
 * The component is presentational; the timer lives in the board
 * (`useImageInsert`), so this file has no state of its own and is trivially
 * testable — mount it and the message is in the tree.
 */
import type { JSX } from 'react';

export interface ToastProps {
  /** The message text; exactly one is shown at a time. */
  message: string;
  /** Presentation kind, only for styling. */
  tone?: 'info' | 'warning';
}

export function Toast({ message, tone = 'info' }: ToastProps): JSX.Element {
  return (
    <div
      className={`toast toast-${tone}`}
      data-testid="upload-toast"
      data-tone={tone}
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  );
}