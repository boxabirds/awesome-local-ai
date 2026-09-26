import { type JSX } from 'react';
import type { UseUndoResult } from './useUndo';

/**
 * Undo and Redo toolbar buttons with accessible labels and tooltips.
 * Disabled when the matching history is empty or the board is not editable.
 */
export function UndoButtons(props: UseUndoResult): JSX.Element {
  return (
    <>
      <button
        type="button"
        aria-label="Undo"
        data-testid="undo-button"
        title="Undo (Ctrl/Cmd+Z)"
        onClick={props.undo}
        disabled={!props.canUndo}
        aria-disabled={!props.canUndo}
      >
        <span aria-hidden="true">↩</span>
      </button>
      <button
        type="button"
        aria-label="Redo"
        data-testid="redo-button"
        title="Redo (Ctrl/Cmd+Shift+Z)"
        onClick={props.redo}
        disabled={!props.canRedo}
        aria-disabled={!props.canRedo}
      >
        <span aria-hidden="true">↪</span>
      </button>
    </>
  );
}
