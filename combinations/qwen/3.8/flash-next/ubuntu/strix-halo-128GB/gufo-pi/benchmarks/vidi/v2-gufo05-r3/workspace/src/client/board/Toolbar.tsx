/** Exact tooltip copy from the PRD (sticky.create_button). */
export const STICKY_NOTE_TOOLTIP = 'Sticky note \u2013 or double-click the board';

export interface ToolbarProps {
  onCreateSticky(): void;
}

/**
 * Left-side vertical board toolbar. In this story it holds the Sticky note
 * button; later stories add their tools here.
 *
 * Pointer events are stopped so a click on the toolbar never reaches the
 * viewport (which would pan the board or clear the selection).
 */
export function Toolbar(props: ToolbarProps) {
  const { onCreateSticky } = props;
  return (
    <div
      className="board-toolbar"
      data-toolbar=""
      role="toolbar"
      aria-label="Board tools"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="board-toolbar-btn"
        aria-label="Sticky note"
        title={STICKY_NOTE_TOOLTIP}
        data-create-sticky=""
        onClick={onCreateSticky}
      >
        <span className="board-toolbar-icon" aria-hidden="true">
          {'\u25A6'}
        </span>
        <span className="board-toolbar-text">Sticky note</span>
      </button>
    </div>
  );
}
