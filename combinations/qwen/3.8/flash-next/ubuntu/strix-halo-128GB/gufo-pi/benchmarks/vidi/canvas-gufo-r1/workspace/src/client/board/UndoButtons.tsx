import type { UseUndoResult } from './useUndo';

export type UndoButtonsProps = UseUndoResult;

/**
 * Undo and Redo toolbar buttons with tooltips showing shortcuts.
 * Disabled when the matching history is empty or editing is locked.
 */
export function UndoButtons(props: UndoButtonsProps) {
  const { canUndo, canRedo, undo, redo } = props;

  return (
    <div className="undo-buttons" data-testid="undo-buttons">
      <button
        type="button"
        aria-label="Undo"
        title="Undo (Ctrl/Cmd+Z)"
        className="toolbar-btn"
        data-testid="undo-btn"
        onClick={undo}
        disabled={!canUndo}
        aria-disabled={!canUndo}
      >
        <span className="toolbar-btn-icon" aria-hidden="true">{'\u21B6'}</span>
      </button>
      <button
        type="button"
        aria-label="Redo"
        title="Redo (Ctrl/Cmd+Shift+Z)"
        className="toolbar-btn"
        data-testid="redo-btn"
        onClick={redo}
        disabled={!canRedo}
        aria-disabled={!canRedo}
      >
        <span className="toolbar-btn-icon" aria-hidden="true">{'\u21B7'}</span>
      </button>
    </div>
  );
}
