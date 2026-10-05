/**
 * The board's drag-over outline (story 12).
 *
 * It answers one question, and it answers it while the answer is still true: *if I let go here, will these
 * files land on this board?* Without it, dropping is a guess — the files are in the air, the board says nothing,
 * and the only way to find out is to let go and see. It appears on `dragenter` with files in it, goes away on
 * `dragleave` and on the drop itself, and is not drawn for a drag of anything else (a selected note dragged over
 * the board is not a file and must not be promised a landing).
 *
 * Two details are the whole of the component:
 *
 *  - **`pointer-events: none`.** The outline is painted over the surface that is being dropped on. If it could
 *    catch the pointer, it would catch the drag instead — the surface would report a `dragleave` the moment the
 *    highlight appeared, the highlight would go away, the surface would report a `dragenter`, and the board would
 *    flicker at the exact moment somebody is aiming.
 *  - **`aria-hidden`.** A drag is something a sighted person does with a pointer; a screen reader is not
 *    following the file across the screen, and an announcement on every enter and leave is noise on top of a
 *    gesture that is not theirs. The *result* of the drop is announced instead, by the toasts in `ui/Toast.tsx`.
 */
import type { JSX } from 'react';

/** What the outline says, in the middle of itself. */
export const DROP_HINT = 'Drop to add these images to the board';

export function DropHighlight(): JSX.Element {
  return (
    <div className="drop-highlight" data-testid="drop-highlight" aria-hidden="true">
      <span className="drop-highlight__text">{DROP_HINT}</span>
    </div>
  );
}
