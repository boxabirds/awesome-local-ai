/**
 * Left-side board toolbar: the Sticky note tool.
 *
 * The button's accessible name is "Sticky note"; its tooltip spells out the
 * alternative (double-click the board). Clicking it creates a note in the
 * middle of the visible board area, wherever the board has been panned.
 */
export interface ToolbarProps {
  onCreateSticky(): void;
}

export const STICKY_TOOL_TOOLTIP = "Sticky note \u2013 centre of view";

export function Toolbar({ onCreateSticky }: ToolbarProps) {
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
    </div>
  );
}
