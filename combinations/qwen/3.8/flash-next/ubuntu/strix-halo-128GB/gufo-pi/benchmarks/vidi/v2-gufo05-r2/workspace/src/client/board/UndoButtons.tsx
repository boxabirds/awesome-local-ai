/**
 * Story 8: the Undo and Redo buttons in the left toolbar.
 *
 * They sit below the tools and make the two histories visible: each is dimmed
 * and inert while its history is empty (or the board cannot be edited), and its
 * tooltip shows the shortcut beside the button so the keyboard path is
 * discoverable (PRD undo.buttons).
 */

import type { UndoState } from './useUndo';

/** Exact tooltips shown on the buttons (PRD wording). */
export const UNDO_BUTTON_TOOLTIP = 'Undo (Ctrl/Cmd+Z)';
export const REDO_BUTTON_TOOLTIP = 'Redo (Ctrl/Cmd+Shift+Z)';

export type UndoButtonsProps = UndoState;

export function UndoButtons({ canUndo, canRedo, undo, redo }: UndoButtonsProps) {
  return (
    <>
      <button
        type="button"
        className="toolbar__button"
        aria-label="Undo"
        title={UNDO_BUTTON_TOOLTIP}
        data-testid="undo-button"
        disabled={!canUndo}
        aria-disabled={!canUndo}
        onClick={undo}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M7.5 5 4 8.5 7.5 12M4 8.5h6.5a4 4 0 0 1 0 8H8"
          />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar__button"
        aria-label="Redo"
        title={REDO_BUTTON_TOOLTIP}
        data-testid="redo-button"
        disabled={!canRedo}
        aria-disabled={!canRedo}
        onClick={redo}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12.5 5 16 8.5 12.5 12M16 8.5H9.5a4 4 0 0 0 0 8H12"
          />
        </svg>
      </button>
    </>
  );
}
