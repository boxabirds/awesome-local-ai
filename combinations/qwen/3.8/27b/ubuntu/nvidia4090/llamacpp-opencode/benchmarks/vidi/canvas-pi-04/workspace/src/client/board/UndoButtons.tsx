// Story 8: the toolbar's undo/redo buttons (anchor: undo.buttons).
//
// Two labelled buttons: disabled (and aria-disabled) when the respective
// stack is empty; enabled whenever it is not. The labels and titles follow
// the PRD contract: "Undo (Ctrl/Cmd+Z)" / "Redo (Ctrl/Cmd+Shift+Z)".

import type { JSX } from 'react';
import type { UndoBinding } from './useUndo';

export function UndoButtons(props: UndoBinding): JSX.Element {
  return (
    <div className="board-toolbar__undo">
      <button
        type="button"
        className="board-toolbar__undo-button"
        title="Undo (Ctrl/Cmd+Z)"
        aria-label="Undo"
        aria-disabled={props.canUndo ? undefined : true}
        disabled={!props.canUndo}
        onClick={props.undo}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            d="M7 5 3 9l4 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M3 9h8a5 5 0 0 1 0 10H8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="board-toolbar__undo-button"
        title="Redo (Ctrl/Cmd+Shift+Z)"
        aria-label="Redo"
        aria-disabled={props.canRedo ? undefined : true}
        disabled={!props.canRedo}
        onClick={props.redo}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            d="m13 5 4 4-4 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M17 9H9a5 5 0 0 0 0 10h2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
