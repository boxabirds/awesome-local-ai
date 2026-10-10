import { useEffect, useState } from 'react';

/**
 * The dashed outline that says "let go here" (`image.drop`).
 *
 * It listens on `window` rather than being told by the board what is being dragged,
 * for the same reason the board's drop handlers are on `window`: a file released
 * over the toolbar or the zoom control is still a file the person wants on this
 * board, and an outline that only appears over the canvas would vanish exactly when
 * that person needs it.
 *
 * The counter is the whole trick. `dragenter` and `dragleave` fire again every time
 * the moving file crosses into or out of a child of the surface, so a boolean
 * flickers; counting them shows the moment the drag is genuinely over the board and
 * the moment it is genuinely not. `drop` clears it whatever happens to the rest of
 * the event, because the person has already let go.
 *
 * Only a drag carrying files raises it. Dragging text, a link or the board's own
 * objects is not an offer of a file, and an outline for it would be a lie.
 */

/** Does this drag carry files? (`DataTransfer.types` says so without touching them.) */
export function dragCarriesFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) {
    return false;
  }
  const types = Array.from(dataTransfer.types ?? []);
  return types.includes('Files') || (types.length === 0 && (dataTransfer as { files?: unknown }).files !== undefined);
}

export function DropHighlight() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    let depth = 0;
    const show = (): void => {
      depth += 1;
      setActive(true);
    };
    const hide = (): void => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        setActive(false);
      }
    };
    const dropped = (): void => {
      depth = 0;
      setActive(false);
    };
    const onDragEnter = (event: DragEvent) => {
      if (dragCarriesFiles(event.dataTransfer)) {
        show();
      }
    };
    const onDragLeave = () => {
      hide();
    };
    // A drag that ends on the page never fires `dragleave` for the window - it ends
    // as a `drop`, or it is cancelled somewhere the browser never tells us about.
    const onDrop = () => {
      dropped();
    };
    const onDragEnd = () => {
      dropped();
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragend', onDragEnd);
    return () => {
      depth = 0;
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragend', onDragEnd);
    };
  }, []);

  if (!active) {
    return null;
  }

  return (
    <div className="drop-highlight" data-testid="drop-highlight" aria-hidden="true">
      <p className="drop-highlight__label">Drop images to add them</p>
    </div>
  );
}
