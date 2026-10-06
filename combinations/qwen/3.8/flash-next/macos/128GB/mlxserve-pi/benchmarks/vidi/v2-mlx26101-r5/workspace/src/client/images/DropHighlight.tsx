/**
 * The dashed outline that says *this is where it goes*.
 *
 * A person who has a file in their hand and is moving it across a screen wants one answer before they let
 * go: will this land here, or will this browser do something else with it. The outline is that answer, and
 * it is drawn over the whole board because the whole board is the drop area — a highlight drawn around some
 * smaller target would be a claim about a target that does not exist.
 *
 * Two things about it are the whole of the difficulty, and both are properties of drag events rather than
 * choices made here.
 *
 * **It counts entries, not events.** `dragenter` fires again every time the pointer crosses into another
 * element on its way across the board — a child, a shape, a sticky note — and `dragleave` fires each time
 * it leaves one, so the naive reading ("show it on enter, hide it on leave") blinks continuously while a
 * file is waved over the page, and the last `dragleave` before the drop often arrives on its own. A depth
 * counter is the standard answer: shown from the first enter, hidden when the count returns to zero, which
 * is the moment the pointer has really left the window.
 *
 * **It answers file drags and nothing else.** Dragging a word out of another page, a link from a bookmarks
 * bar or a selected path from a file manager's *text* all fire the same events, and a board that promised a
 * picture in exchange for a dragged `const` would be promising something it has no intention of delivering.
 * `DataTransfer.types` names what is being carried before any of it is readable — `Files` is the one that
 * means a file is in the hand.
 *
 * It draws nothing but an outline, and `pointer-events: none` keeps it that way: a highlight that caught the
 * pointer would intercept the very drop it is announcing, which is a highlight that breaks the thing it
 * decorates.
 */

import { useEffect, useState, type ReactElement } from 'react';

/** Is a file being dragged, as opposed to a selection, a link or a dragged image from another page? */
function isFileDrag(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  if (types === undefined || types === null) return false;
  return Array.from(types).includes('Files');
}

/** The drop highlight over the whole board, while files are being dragged over it. */
export function DropHighlight(): ReactElement | null {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let depth = 0;
    const show = (event: Event): void => {
      if (!isFileDrag(event as DragEvent)) return;
      depth += 1;
      setDragging(true);
    };
    const hide = (event: Event): void => {
      if (!isFileDrag(event as DragEvent)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    // A drop ends the drag whatever the depth counter has been counting: the files have arrived, and an
    // outline left standing over a board that has just been given a picture is a lie about what is left
    // to do.
    const dropped = (): void => {
      depth = 0;
      setDragging(false);
    };
    window.addEventListener('dragenter', show);
    window.addEventListener('dragleave', hide);
    window.addEventListener('drop', dropped);
    return () => {
      window.removeEventListener('dragenter', show);
      window.removeEventListener('dragleave', hide);
      window.removeEventListener('drop', dropped);
    };
  }, []);

  if (!dragging) return null;
  return <div aria-hidden="true" className="drop-highlight" data-testid="drop-highlight" />;
}
