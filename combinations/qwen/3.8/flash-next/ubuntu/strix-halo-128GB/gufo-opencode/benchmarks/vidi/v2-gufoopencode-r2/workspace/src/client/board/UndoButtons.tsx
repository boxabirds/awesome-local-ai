// Undo / Redo buttons for the left toolbar (undo.controls). Disabled per
// stack state and edit lock; tooltips carry the keyboard shortcuts.

import type { UndoState } from './useUndo';

export type UndoButtonsProps = UndoState;

export function UndoButtons(props: UndoButtonsProps): React.JSX.Element {
  return (
    <>
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="undo"
        aria-label="Undo"
        title="Undo (Ctrl/Cmd+Z)"
        onClick={props.undo}
        disabled={!props.canUndo}
        aria-disabled={!props.canUndo}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path
            d="M6 4 2.5 7.5 6 11M2.5 7.5h7.5a4 4 0 0 1 0 8H7"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>Undo</span>
      </button>
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="redo"
        aria-label="Redo"
        title="Redo (Ctrl/Cmd+Shift+Z)"
        onClick={props.redo}
        disabled={!props.canRedo}
        aria-disabled={!props.canRedo}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path
            d="M12 4l3.5 3.5L12 11M15.5 7.5H8a4 4 0 0 0 0 8h3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>Redo</span>
      </button>
    </>
  );
}
