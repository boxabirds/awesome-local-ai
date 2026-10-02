/*! The board while files are being dragged over it (story 12).
 *
 * The board says "here" before anybody has committed to anything: a dashed line
 * around the whole board area, and a line about what would happen. It is the drop
 * target made visible, and it is shown from the one state which knows a drag with
 * files in it is over the board — the same state `preventDefault` is called from,
 * because a highlight which appeared on a drag the board would not accept would be
 * a highlight that lied.
 *
 * It is `aria-hidden` on purpose. It is an affordance for eyes, its words are the
 * same words every drop is answered with anyway, and it must not take the live
 * region away from the toasts which say whether a drop was actually taken.
 */
import type { JSX } from 'react';

export interface DropHighlightProps {
  /** Whether files are being dragged over *this* board. */
  dragging: boolean;
}

export function DropHighlight({ dragging }: DropHighlightProps): JSX.Element | null {
  if (!dragging) return null;
  return (
    <div className="drop-highlight" data-testid="drop-highlight" aria-hidden="true">
      <p className="drop-highlight-label">Drop images to add them</p>
    </div>
  );
}
