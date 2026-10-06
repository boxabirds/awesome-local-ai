import type { UndoState } from "./useUndo";

/**
 * The Undo and Redo buttons (`undo.controls`).
 *
 * They are the only visible entry to this tab's history, and they can only ever
 * reach the controller this tab created: their stacks hold nothing but this
 * person's own steps, so clicking Undo here cannot undo anybody else's work.
 * A button is disabled when its stack is empty or when this board may not be
 * written to (story 4's load failure), which is the same rule the keyboard
 * follows.
 */

export const UNDO_TOOLTIP = "Undo (Ctrl/Cmd+Z)";
export const REDO_TOOLTIP = "Redo (Ctrl/Cmd+Shift+Z)";

export type UndoButtonsProps = UndoState;

export function UndoButtons({ canUndo, canRedo, undo, redo }: UndoButtonsProps) {
  return (
    <>
      <button
        type="button"
        className="tool-button"
        data-testid="undo-button"
        aria-label="Undo"
        title={UNDO_TOOLTIP}
        disabled={!canUndo}
        aria-disabled={!canUndo}
        onClick={undo}
      >
        <span className="tool-glyph tool-glyph-undo" aria-hidden="true" />
        <span className="tool-label">Undo</span>
      </button>
      <button
        type="button"
        className="tool-button"
        data-testid="redo-button"
        aria-label="Redo"
        title={REDO_TOOLTIP}
        disabled={!canRedo}
        aria-disabled={!canRedo}
        onClick={redo}
      >
        <span className="tool-glyph tool-glyph-redo" aria-hidden="true" />
        <span className="tool-label">Redo</span>
      </button>
    </>
  );
}
