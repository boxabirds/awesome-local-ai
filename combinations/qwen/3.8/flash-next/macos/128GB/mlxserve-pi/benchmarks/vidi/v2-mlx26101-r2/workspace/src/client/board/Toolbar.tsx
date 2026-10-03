import type { JSX } from 'react';

/** Exact tooltip of the Sticky note button (PRD "Structure"). */
export const STICKY_BUTTON_TOOLTIP = 'Sticky note \u2013 or double-click the board';

export interface ToolbarProps {
  /** Create a sticky note in the middle of what the user is looking at. */
  onCreateSticky(): void;
}

/**
 * The left-side vertical toolbar. Story 2 contributes the Sticky note button;
 * later stories add their tools here.
 */
export function Toolbar({ onCreateSticky }: ToolbarProps): JSX.Element {
  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      role="toolbar"
      aria-label="Board tools"
      aria-orientation="vertical"
      // The toolbar is page chrome: a click or wheel over it must not reach the
      // board (which would pan, zoom or clear the selection).
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="create-sticky-button"
        aria-label="Sticky note"
        title={STICKY_BUTTON_TOOLTIP}
        onClick={onCreateSticky}
      >
        <span className="board-toolbar-icon" aria-hidden="true">
          &#9635;
        </span>
        <span className="board-toolbar-label">Sticky note</span>
      </button>
    </div>
  );
}
