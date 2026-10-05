import type { JSX } from 'react';
import type { UndoApi } from './useUndo';

/** Exact tooltip copy from the design (PRD: tooltips show the shortcuts). */
export const UNDO_TOOLTIP = 'Undo (Ctrl/Cmd+Z)';
export const REDO_TOOLTIP = 'Redo (Ctrl/Cmd+Shift+Z)';

/**
 * The Undo and Redo buttons, below the tools in the left toolbar.
 *
 * A person's history is their own, so these buttons only ever step through what
 * this tab changed: when there is nothing of theirs to undo the button is
 * disabled rather than doing nothing on click (`undo.buttons`), and a board that
 * cannot be edited shows both as disabled (`undo.not_editable`).
 */
export function UndoButtons(props: UndoApi): JSX.Element {
  const { canUndo, canRedo, undo, redo } = props;
  return (
    <>
      <span className="board-toolbar-separator" aria-hidden="true" />
      <button
        type="button"
        className="board-toolbar-btn"
        aria-label="Undo"
        title={UNDO_TOOLTIP}
        data-undo=""
        disabled={!canUndo}
        aria-disabled={!canUndo}
        onClick={undo}
      >
        <span className="board-toolbar-icon" aria-hidden="true">
          {'\u21BA'}
        </span>
        <span className="board-toolbar-text">Undo</span>
      </button>
      <button
        type="button"
        className="board-toolbar-btn"
        aria-label="Redo"
        title={REDO_TOOLTIP}
        data-redo=""
        disabled={!canRedo}
        aria-disabled={!canRedo}
        onClick={redo}
      >
        <span className="board-toolbar-icon" aria-hidden="true">
          {'\u21BB'}
        </span>
        <span className="board-toolbar-text">Redo</span>
      </button>
    </>
  );
}
