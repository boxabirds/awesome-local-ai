import type { JSX } from 'react';

import type { UseUndoResult } from './useUndo.js';

/** Exact tooltip of the Undo button (PRD "Structure": tooltips show shortcuts). */
export const UNDO_BUTTON_TOOLTIP = 'Undo (Ctrl/Cmd+Z)';

/** Exact tooltip of the Redo button. */
export const REDO_BUTTON_TOOLTIP = 'Redo (Ctrl/Cmd+Shift+Z)';

export type UndoButtonsProps = UseUndoResult;

/**
 * The Undo and Redo buttons of the left toolbar (`src/client/board/UndoButtons.tsx`).
 *
 * Two things they exist to make visible, and both are the PRD's complaint that
 * "you can't tell whether there is anything to undo":
 *
 * - **Whose changes these are.** The buttons talk to the one controller this tab
 *   built for this board, whose stacks hold only this tab's own transactions -
 *   so the Undo button can only ever take back what *this* person did. A
 *   colleague's work is not in the stack to be undone.
 * - **Whether there is anything to undo.** `canUndo`/`canRedo` are the stack
 *   lengths, so a greyed-out button is an empty history rather than a button that
 *   will do nothing. A board that will not take edits (story 4's failed load) has
 *   neither, whatever its history holds.
 *
 * They are ordinary `button[disabled]`, which is how the disabled state reaches a
 * screen reader; `aria-disabled` is written alongside it so the state is in the
 * markup as well as in the accessibility tree.
 */
export function UndoButtons({ canUndo, canRedo, undo, redo }: UndoButtonsProps): JSX.Element {
  return (
    <div className="undo-buttons" data-testid="undo-buttons">
      <button
        type="button"
        className="board-toolbar-button undo-button"
        data-testid="undo-button"
        aria-label="Undo"
        aria-disabled={!canUndo}
        title={UNDO_BUTTON_TOOLTIP}
        disabled={!canUndo}
        onClick={undo}
      >
        <span className="board-toolbar-icon" aria-hidden="true">
          &#8630;
        </span>
        <span className="board-toolbar-label">Undo</span>
      </button>
      <button
        type="button"
        className="board-toolbar-button redo-button"
        data-testid="redo-button"
        aria-label="Redo"
        aria-disabled={!canRedo}
        title={REDO_BUTTON_TOOLTIP}
        disabled={!canRedo}
        onClick={redo}
      >
        <span className="board-toolbar-icon" aria-hidden="true">
          &#8631;
        </span>
        <span className="board-toolbar-label">Redo</span>
      </button>
    </div>
  );
}

export default UndoButtons;
