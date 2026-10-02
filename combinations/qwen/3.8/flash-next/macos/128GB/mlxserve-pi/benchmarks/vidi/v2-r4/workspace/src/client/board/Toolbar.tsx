export interface ToolbarProps {
  /** Puts a sticky note in the middle of what is on screen and edits it. */
  onCreateSticky(): void;
}

/**
 * The board's tool bar: the sticky note tool.
 *
 * It floats over the board, so its clicks must not reach the viewport — a
 * pointer down here would otherwise clear the selection (`sticky.toolbar`).
 */
export function Toolbar({ onCreateSticky }: ToolbarProps) {
  const stop = (event: { stopPropagation(): void }): void => {
    event.stopPropagation();
  };

  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      role="toolbar"
      aria-label="Board tools"
      onPointerDown={stop}
      onDoubleClick={stop}
    >
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="create-sticky"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        onClick={onCreateSticky}
      >
        <span aria-hidden="true" className="board-toolbar-icon">
          {'▣'}
        </span>
      </button>
    </div>
  );
}
