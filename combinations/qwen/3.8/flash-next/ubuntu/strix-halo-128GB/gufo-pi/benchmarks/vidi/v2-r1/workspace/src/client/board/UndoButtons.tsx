import type { JSX } from 'react';

export interface UndoButtonsProps {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

/**
 * Undo and Redo toolbar buttons (story 8).
 *
 * Rendered in the left toolbar below the tools. Disabled when the respective
 * history is empty or the board cannot be edited. Accessible names are exactly
 * "Undo" and "Redo".
 */
export function UndoButtons(props: UndoButtonsProps): JSX.Element {
  return (
    <>
      <button
        type="button"
        className="board-toolbar__button"
        data-testid="undo-button"
        aria-label="Undo"
        title="Undo (Ctrl/Cmd+Z)"
        onClick={props.undo}
        disabled={!props.canUndo}
        aria-disabled={!props.canUndo}
      >
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M7.5 4.5 3 9l4.5 4.5v-3h4a3 3 0 0 1 0 6H8v2h3.5a5 5 0 0 0 0-10H7.5v-3Z"
          />
        </svg>
        <span>Undo</span>
      </button>
      <button
        type="button"
        className="board-toolbar__button"
        data-testid="redo-button"
        aria-label="Redo"
        title="Redo (Ctrl/Cmd+Shift+Z)"
        onClick={props.redo}
        disabled={!props.canRedo}
        aria-disabled={!props.canRedo}
      >
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M12.5 4.5 17 9l-4.5 4.5v-3H9a3 3 0 0 0 0 6h3.5v2H9a5 5 0 0 0 0-10h3.5v-3Z"
          />
        </svg>
        <span>Redo</span>
      </button>
    </>
  );
}
