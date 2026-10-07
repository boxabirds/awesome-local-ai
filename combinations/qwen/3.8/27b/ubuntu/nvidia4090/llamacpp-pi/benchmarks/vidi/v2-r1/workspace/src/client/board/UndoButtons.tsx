// UndoButtons (story 8, undo.buttons): the Undo and Redo buttons in the
// left toolbar, below the tools. Disabled while the matching history is
// empty (or the board cannot be edited); tooltips show the shortcuts.

import type { JSX } from 'react';
import type { UndoApi } from './useUndo';

export const UNDO_BUTTON_TOOLTIP = 'Undo (Ctrl/Cmd+Z)';
export const REDO_BUTTON_TOOLTIP = 'Redo (Ctrl/Cmd+Shift+Z)';

export function UndoButtons(props: { undo: UndoApi }): JSX.Element {
  const { canUndo, canRedo, undo, redo } = props.undo;
  return (
    <div className="toolbar__undo" role="group" aria-label="History">
      <button
        type="button"
        className="toolbar__undo-button"
        aria-label="Undo"
        title={UNDO_BUTTON_TOOLTIP}
        disabled={!canUndo}
        onClick={() => undo()}
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M8 5L4 9l4 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M4 9h8a5 5 0 0 1 0 10h-2"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar__undo-button"
        aria-label="Redo"
        title={REDO_BUTTON_TOOLTIP}
        disabled={!canRedo}
        onClick={() => redo()}
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M12 5l4 4-4 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M16 9H8a5 5 0 0 0 0 10h2"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
