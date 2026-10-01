// The board's one way of saying something in words (story 12).
//
// A toast is what the app says when a person asked for something and it did not happen the way
// they asked: three files arrived and one of them was a PDF, twenty-one arrived and only twenty
// went in, the link was down. Every one of those is a fact about an action that already finished,
// which is why this is a live region rather than a dialog - the board keeps focus, the keyboard
// keeps working, and nothing has to be dismissed before anything else can happen.
//
// The region is in the document whether or not there is anything to say. That is not tidiness:
// a live region that arrives in the DOM carrying its own news is a live region that says nothing,
// because there is no moment at which a screen reader could notice it appearing. Empty, it is a
// zero-height box that takes no pointer.
//
// The messages themselves belong to `validateFiles` and the flows in `useImageInsert` - this
// component is given strings and shows them, and outlives them by four seconds.

import type { JSX } from 'react';

export interface ToastProps {
  /** Newest last, as the flows say them. Empty is silence, not an unmount. */
  messages: readonly string[];
}

export function Toast({ messages }: ToastProps): JSX.Element {
  return (
    <div
      className={`toast-stack${messages.length === 0 ? ' is-empty' : ''}`}
      data-testid="toast-stack"
      role="status"
      aria-live="polite"
    >
      {messages.map((message, index) => (
        // The message plus its position is the key on purpose. The same sentence said twice in
        // a row is the same words and a new piece of news, and a test that dropped two bad files
        // wants to be told about both - remounting the node is what makes a screen reader read
        // the second one too.
        <div className="toast" data-testid="toast" key={`${index}:${message}`}>
          {message}
        </div>
      ))}
    </div>
  );
}
