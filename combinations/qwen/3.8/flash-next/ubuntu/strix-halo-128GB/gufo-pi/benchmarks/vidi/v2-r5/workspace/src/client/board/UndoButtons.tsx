import type { UseUndoResult } from './useUndo';

/**
 * Undo and Redo toolbar buttons.
 * Shown below the tools in the left toolbar.
 * Disabled when the matching history is empty or canEdit is false.
 */
export function UndoButtons(props: UseUndoResult) {
  return (
    <div className="board-toolbar-undo-group">
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="undo-button"
        aria-label="Undo"
        title="Undo (Ctrl/Cmd+Z)"
        onClick={props.undo}
        disabled={!props.canUndo}
        aria-disabled={!props.canUndo}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M7 4l-4 4 4 4v-2.5c3.3 0 6.1 1.5 7.3 3.9.3-3.6-1.9-6.9-5.3-7.8V4H7z"
          />
        </svg>
      </button>
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="redo-button"
        aria-label="Redo"
        title="Redo (Ctrl/Cmd+Shift+Z)"
        onClick={props.redo}
        disabled={!props.canRedo}
        aria-disabled={!props.canRedo}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M13 4l4 4-4 4v-2.5c-3.3 0-6.1 1.5-7.3 3.9-.3-3.6 1.9-6.9 5.3-7.8V4h2z"
          />
        </svg>
      </button>
    </div>
  );
}
