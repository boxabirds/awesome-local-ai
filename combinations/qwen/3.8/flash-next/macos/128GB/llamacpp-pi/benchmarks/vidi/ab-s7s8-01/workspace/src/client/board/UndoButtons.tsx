// Undo / Redo toolbar buttons (story 8, board.controls).
//
// Visible controls mirroring the keyboard shortcuts. State comes straight from
// useUndo — disabled exactly when the relevant stack is empty or the board is
// not editable, so they can never disagree with what Ctrl/Cmd+Z would do.

import type { UndoApi } from './useUndo';

export interface UndoButtonsProps extends UndoApi {}

export function UndoButtons({ canUndo, canRedo, undo, redo }: UndoButtonsProps) {
  return (
    <div className="vidi6-undo-buttons" data-testid="undo-buttons" role="group" aria-label="Undo history">
      <button
        type="button"
        data-testid="undo-button"
        aria-label="Undo"
        title="Undo (Ctrl/Cmd+Z)"
        aria-disabled={!canUndo}
        disabled={!canUndo}
        onClick={undo}
      >
        <span aria-hidden="true">↺</span>
      </button>
      <button
        type="button"
        data-testid="redo-button"
        aria-label="Redo"
        title="Redo (Ctrl/Cmd+Shift+Z)"
        aria-disabled={!canRedo}
        disabled={!canRedo}
        onClick={redo}
      >
        <span aria-hidden="true">↻</span>
      </button>
    </div>
  );
}
