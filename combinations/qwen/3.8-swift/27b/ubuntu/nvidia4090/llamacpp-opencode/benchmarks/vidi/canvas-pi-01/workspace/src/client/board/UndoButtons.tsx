// Undo and Redo toolbar buttons (see spec: undo.buttons).
//
// Rendered in the left toolbar below the tools. Accessible names "Undo" and
// "Redo"; tooltips show the keyboard shortcuts; disabled (the `disabled`
// attribute, exposed via aria-disabled) while the matching history is empty
// or the board cannot be edited.

import type { JSX } from 'react';
import type { UndoUi } from './useUndo';

export const UNDO_BUTTON_TOOLTIP = 'Undo (Ctrl/Cmd+Z)';
export const REDO_BUTTON_TOOLTIP = 'Redo (Ctrl/Cmd+Shift+Z)';

export function UndoButtons({ canUndo, canRedo, undo, redo }: UndoUi): JSX.Element {
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  return (
    <div data-testid="undo-buttons" className="undo-buttons" onPointerDown={stop} onDoubleClick={stop}>
      <button
        type="button"
        className="undo-buttons__button"
        aria-label="Undo"
        title={UNDO_BUTTON_TOOLTIP}
        disabled={!canUndo}
        onClick={undo}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"
            fill="currentColor"
          />
        </svg>
      </button>
      <button
        type="button"
        className="undo-buttons__button"
        aria-label="Redo"
        title={REDO_BUTTON_TOOLTIP}
        disabled={!canRedo}
        onClick={redo}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z"
            fill="currentColor"
          />
        </svg>
      </button>
    </div>
  );
}
