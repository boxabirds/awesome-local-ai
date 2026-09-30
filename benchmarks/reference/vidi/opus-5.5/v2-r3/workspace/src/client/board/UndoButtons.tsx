import type { UndoApi } from './useUndo';

export const UNDO_TOOLTIP = 'Undo (Ctrl/Cmd+Z)';
export const REDO_TOOLTIP = 'Redo (Ctrl/Cmd+Shift+Z)';

/** Undo and Redo buttons for the left toolbar, below the tools. */
export function UndoButtons(props: UndoApi) {
  return (
    <div className="toolbar-group" role="group" aria-label="History">
      <button
        type="button"
        className="toolbar-button"
        aria-label="Undo"
        title={UNDO_TOOLTIP}
        disabled={!props.canUndo}
        aria-disabled={!props.canUndo}
        onClick={props.undo}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            d="M7.5 5 3.5 9l4 4M4 9h8a4.5 4.5 0 0 1 0 9h-2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar-button"
        aria-label="Redo"
        title={REDO_TOOLTIP}
        disabled={!props.canRedo}
        aria-disabled={!props.canRedo}
        onClick={props.redo}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            d="M12.5 5l4 4-4 4M16 9H8a4.5 4.5 0 0 0 0 9h2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
