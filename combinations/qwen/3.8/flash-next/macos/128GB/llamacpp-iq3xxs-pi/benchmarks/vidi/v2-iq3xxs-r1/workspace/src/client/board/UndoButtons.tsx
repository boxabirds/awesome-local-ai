import type { UndoControls } from './useUndo';

export type UndoButtonsProps = UndoControls;

/** Tooltips double as the shortcut reminder (PRD undo.buttons, undo.shortcuts). */
export const UNDO_BUTTON_TOOLTIP = 'Undo (Ctrl/Cmd+Z)';
export const REDO_BUTTON_TOOLTIP = 'Redo (Ctrl/Cmd+Shift+Z)';

/**
 * The toolbar's Undo and Redo buttons.
 *
 * They are the visible half of this tab's history only: they call the controller
 * built for this board in this tab, whose stacks hold nothing but this person's own
 * changes. Both are dark when there is nothing of mine to step over, or when the
 * board cannot be edited (PRD undo.buttons, undo.not_editable).
 */
export function UndoButtons({ canUndo, canRedo, undo, redo }: UndoButtonsProps) {
  return (
    <>
      <button
        type="button"
        className="tool-button"
        data-testid="undo"
        aria-label="Undo"
        title={UNDO_BUTTON_TOOLTIP}
        disabled={!canUndo}
        aria-disabled={!canUndo}
        onClick={canUndo ? undo : undefined}
      >
        <span className="tool-icon" aria-hidden="true">
          {'\u21B6'}
        </span>
        Undo
      </button>
      <button
        type="button"
        className="tool-button"
        data-testid="redo"
        aria-label="Redo"
        title={REDO_BUTTON_TOOLTIP}
        disabled={!canRedo}
        aria-disabled={!canRedo}
        onClick={canRedo ? redo : undefined}
      >
        <span className="tool-icon" aria-hidden="true">
          {'\u21B7'}
        </span>
        Redo
      </button>
    </>
  );
}
