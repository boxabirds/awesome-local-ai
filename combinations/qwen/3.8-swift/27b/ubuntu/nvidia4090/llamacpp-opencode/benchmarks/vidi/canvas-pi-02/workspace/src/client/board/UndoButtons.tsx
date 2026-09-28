// Undo and Redo buttons in the left toolbar (story 8, undo.buttons): below
// the tools, with tooltips showing the shortcuts. Disabled (and exposed as
// aria-disabled) while the matching history is empty or the board is locked.

import type { ReactElement } from 'react';
import type { UndoApi } from './useUndo';

export const UNDO_BUTTON_TOOLTIP = 'Undo (Ctrl/Cmd+Z)';
export const REDO_BUTTON_TOOLTIP = 'Redo (Ctrl/Cmd+Shift+Z)';

export function UndoButtons(props: UndoApi): ReactElement {
  return (
    <div className="toolbar-undo" data-testid="undo-buttons" onPointerDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="toolbar-undo-button"
        aria-label="Undo"
        title={UNDO_BUTTON_TOOLTIP}
        disabled={!props.canUndo}
        onClick={props.undo}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path
            d="M4.5 7.5H11a3.5 3.5 0 1 1 0 7H6.5M4.5 7.5 8 4M4.5 7.5 8 11"
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
        className="toolbar-undo-button"
        aria-label="Redo"
        title={REDO_BUTTON_TOOLTIP}
        disabled={!props.canRedo}
        onClick={props.redo}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path
            d="M13.5 7.5H7a3.5 3.5 0 1 0 0 7h4.5M13.5 7.5 10 4M13.5 7.5 10 11"
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
