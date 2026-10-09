/**
 * The left fixed toolbar (story 2): a single "Sticky note" button with the
 * tooltip "Sticky note – or double-click the board". Clicking it creates a
 * note in the centre of the visible area, even when the camera has been
 * panned far from the origin (the visible centre, not the world origin).
 *
 * Pointer events stop propagation so the viewport never sees them.
 */
import type * as React from "react";

export function Toolbar(props: {
  onCreateSticky(): void;
}): React.JSX.Element {
  const stop = (event: React.SyntheticEvent) => {
    event.stopPropagation();
  };

  return (
    <div
      className="toolbar"
      data-testid="toolbar"
      onPointerDown={stop}
      onPointerUp={stop}
      onDoubleClick={stop}
    >
      <button
        type="button"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        onClick={props.onCreateSticky}
      >
        <span aria-hidden="true" className="toolbar__icon">▣</span>
      </button>
    </div>
  );
}
