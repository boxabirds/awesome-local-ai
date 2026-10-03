/**
 * The dashed outline that says "let go here" while files are being dragged over the board
 * (`image.drop`).
 *
 * It is one absolutely-positioned frame over the viewport, `pointer-events: none` throughout:
 * an overlay that could take the drag would end the drag, and the highlight would be the
 * reason the drop failed. Everything the overlay needs to be honest — that it is only shown
 * for file drags, and only while the pointer is inside the board — is decided by
 * `useImageInsert`, which owns the enter/leave counting this visual depends on.
 */
export function DropHighlight() {
  return (
    <div className="drop-highlight" data-testid="drop-highlight" aria-hidden="true">
      <span className="drop-highlight__label">Drop images</span>
    </div>
  );
}
