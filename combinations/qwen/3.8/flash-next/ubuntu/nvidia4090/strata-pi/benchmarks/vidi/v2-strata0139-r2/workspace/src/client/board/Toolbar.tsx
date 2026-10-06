import { UndoButtons } from "./UndoButtons";
import type { UndoState } from "./useUndo";

/**
 * Left-side board toolbar: the Sticky note tool, and story 8's Undo and Redo.
 *
 * The button's accessible name is "Sticky note"; its tooltip spells out the
 * alternative (double-click the board). Clicking it creates a note in the
 * middle of the visible board area, wherever the board has been panned.
 */
export interface ToolbarProps {
  onCreateSticky(): void;
  /** This tab's undo state: the buttons only ever reach this tab's history. */
  undo: UndoState;
}

export const STICKY_TOOL_TOOLTIP = "Sticky note \u2013 centre of view";

export function Toolbar({ onCreateSticky, undo }: ToolbarProps) {
  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      role="toolbar"
      aria-label="Board tools"
      aria-orientation="vertical"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="tool-button"
        data-testid="create-sticky"
        aria-label="Sticky note"
        title={STICKY_TOOL_TOOLTIP}
        onClick={onCreateSticky}
      >
        <span className="tool-glyph" aria-hidden="true" />
        <span className="tool-label">Sticky note</span>
      </button>
      <UndoButtons {...undo} />
    </div>
  );
}
