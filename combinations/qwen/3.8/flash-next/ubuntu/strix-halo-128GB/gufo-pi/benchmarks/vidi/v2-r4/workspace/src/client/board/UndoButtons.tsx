/**
 * UndoButtons: toolbar buttons for undo and redo.
 * Disabled when the matching stack is empty or canEdit is false.
 */
import type { UseUndoResult } from './useUndo';

export function UndoButtons(props: UseUndoResult): React.JSX.Element {
  return (
    <>
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="undo-button"
        aria-label="Undo"
        title="Undo (Ctrl/Cmd+Z)"
        disabled={!props.canUndo}
        onClick={props.undo}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M7 4L3 8l4 4"
          />
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            d="M3 8h9a4 4 0 0 1 0 8H9"
          />
        </svg>
      </button>
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="redo-button"
        aria-label="Redo"
        title="Redo (Ctrl/Cmd+Shift+Z)"
        disabled={!props.canRedo}
        onClick={props.redo}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13 4l4 4-4 4"
          />
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            d="M17 8H8a4 4 0 0 0 0 8h3"
          />
        </svg>
      </button>
    </>
  );
}
