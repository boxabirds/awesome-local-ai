import type { JSX } from 'react';

/** Exact tooltip of the Sticky note button (PRD "Structure"). */
export const STICKY_BUTTON_TOOLTIP = 'Sticky note \u2013 or double-click the board';

/**
 * What the same button says when the board will not take content. The tooltip is
 * where the reason goes: the button is the thing the user just tried to use, and
 * a control that will not respond has to say why where the pointer already is.
 */
export const BOARD_LOCKED_TOOLTIP = 'Sticky note \u2013 this board could not be loaded';

export interface ToolbarProps {
  /** Create a sticky note in the middle of what the user is looking at. */
  onCreateSticky(): void;
  /**
   * False while the board will not accept new content (a board the room could not
   * load - see `canEdit`). The button is then shown disabled rather than hidden:
   * the tool is still there, and what is missing is the board's ability to take
   * it, which is a fact about the board and not about the toolbar.
   */
  canEdit?: boolean;
}

/**
 * The left-side vertical toolbar. Story 2 contributes the Sticky note button;
 * later stories add their tools here.
 */
export function Toolbar({ onCreateSticky, canEdit = true }: ToolbarProps): JSX.Element {
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
        title={canEdit ? STICKY_BUTTON_TOOLTIP : BOARD_LOCKED_TOOLTIP}
        disabled={!canEdit}
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
