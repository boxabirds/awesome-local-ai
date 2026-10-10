/**
 * Story 12: the dashed outline that says "here" while a person is still dragging
 * (`image.drop`: "WHILE files are dragged over the board THE SYSTEM SHALL show a drop
 * highlight").
 *
 * It is a whole-board overlay rather than a box under the cursor, because the question a
 * highlight answers is whether letting go will do anything *here*, and here is this board —
 * every point in it accepts a drop, and only the exact spot decides where the first image
 * lands. An outline round the cursor would answer a question nobody asked, and would need a
 * cursor-tracked position to do it.
 *
 * `count` is what the browser's dragenter/dragleave counting is for. A drag over a board with
 * objects in it crosses element boundaries constantly, and each crossing is a `dragleave`
 * followed by a `dragenter` on the way in: counting entries and exits is what stops the
 * highlight flickering as it passes over the things the drop will land on.
 */
import { useEffect, useRef, useState, type JSX } from 'react';

/** Is this drag carrying files? */
function carriesFiles(event: DragEvent): boolean {
  if (event.dataTransfer?.types?.includes('Files') === true) return true;
  return (event.dataTransfer?.files.length ?? 0) > 0;
}

/**
 * Whether files are currently being dragged over this window.
 *
 * The listeners sit on `window` rather than on the board element so the highlight also covers
 * the toolbar and the share panel: dropping there drops onto the page, which reloads the page
 * and loses the image, and a highlight that appeared only over part of the window is what
 * teaches somebody to aim.
 */
export function useFileDragOver(active: boolean): boolean {
  const [over, setOver] = useState(false);
  // Entries minus exits. A `drop` ends the drag and fires no `dragleave`, so the count is
  // reset there as well as on `dragleave` reaching zero.
  const depth = useRef(0);

  useEffect(() => {
    // A board that cannot accept an image does not advertise that it can.
    if (!active) return;
    const enter = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      depth.current += 1;
      setOver(true);
    };
    const leave = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    };
    const drop = (): void => {
      depth.current = 0;
      setOver(false);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    // A drag that is cancelled with Escape fires no `dragleave` and no `drop` at all, and
    // would otherwise leave a board offering to accept images for the rest of the afternoon.
    const cancel = (event: Event): void => {
      if (event.type !== 'dragend') return;
      depth.current = 0;
      setOver(false);
    };
    window.addEventListener('dragend', cancel);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
      window.removeEventListener('dragend', cancel);
      depth.current = 0;
    };
  }, [active]);

  return over && active;
}

/** Exact UI text: the highlight says what letting go does, because it is the only hint there is. */
export const DROP_HINT = 'Drop to add images';

/**
 * The overlay itself. `pointer-events: none` in its stylesheet rules, so it never receives
 * the `dragover` or `drop` events it is drawn in front of — an overlay that swallowed the
 * drop would be a highlight that prevents the thing it highlights.
 */
export function DropHighlight(): JSX.Element {
  return (
    <div className="vidi6-drop-highlight" data-testid="drop-highlight" aria-hidden="true">
      <span className="vidi6-drop-highlight-label">{DROP_HINT}</span>
    </div>
  );
}
