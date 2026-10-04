import type { JSX } from 'react';
import type { UseUndoResult } from './useUndo';

export interface UndoButtonsProps {
  undo: Pick<UseUndoResult, 'canUndo' | 'canRedo' | 'undo' | 'redo'>;
}

/**
 * Undo / Redo toolbar buttons (story 8). Disabled while the stack is empty
 * or the session is read-only (canEdit already enforced in useUndo).
 */
export function UndoButtons({ undo }: UndoButtonsProps): JSX.Element {
  return (
    <div className="undo-buttons" data-vidi6="undo-buttons">
      <button
        type="button"
        className="toolbar-button"
        aria-label="Undo"
        aria-disabled={!undo.canUndo}
        title="Undo (Ctrl+Z)"
        disabled={!undo.canUndo}
        onClick={undo.undo}
      >
        ↩
      </button>
      <button
        type="button"
        className="toolbar-button"
        aria-label="Redo"
        aria-disabled={!undo.canRedo}
        title="Redo (Ctrl+Shift+Z)"
        disabled={!undo.canRedo}
        onClick={undo.redo}
      >
        ↪
      </button>
    </div>
  );
}
