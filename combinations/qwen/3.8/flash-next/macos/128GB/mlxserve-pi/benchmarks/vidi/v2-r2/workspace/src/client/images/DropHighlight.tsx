// The dashed outline that says "let go here" (story 12).
//
// It is shown between `dragenter` and `dragleave`/`drop` while files are over the board, and its
// whole job is to answer the question a person has in that half-second - would this land on the
// board, or would it open the file in a tab. It is not a drop target of its own: it sits above
// the board and takes no pointer, because the drag is over the *board*, and a highlight that
// swallows the drop event would drop the picture on nothing.
//
// It is `aria-hidden` on purpose, and the words in it are decoration. A screen-reader user is not
// dragging a file with a mouse they can see, and the news that matters - what was added, what was
// refused - arrives in the toast region, which is a live region and can be read.

import type { JSX } from 'react';

export interface DropHighlightProps {
  /** Whether files are over the board right now. */
  active: boolean;
}

export function DropHighlight({ active }: DropHighlightProps): JSX.Element | null {
  if (!active) return null;
  return (
    <div className="drop-highlight" data-testid="drop-highlight" aria-hidden="true">
      <span className="drop-highlight-words">Drop to add images</span>
    </div>
  );
}
