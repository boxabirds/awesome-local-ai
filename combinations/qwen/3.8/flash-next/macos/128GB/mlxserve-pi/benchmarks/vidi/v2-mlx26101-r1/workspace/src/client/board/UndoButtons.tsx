// Undo / Redo buttons (story 8). Two buttons, disabled when there is nothing to
// step back to or forward to, or when the board cannot be edited (undo.buttons,
// undo.readonly). The controller tells us availability; clicking calls its
// undo/redo, which is origin-filtered so it only ever touches this person's own
// changes (undo.own) — no server round-trip, it syncs as an ordinary change.

import type { UndoActions } from './useUndo';

export function UndoButtons(props: UndoActions) {
  const { canUndo, canRedo, undo, redo } = props;
  return (
    <>
      <button
        data-testid="undo-button"
        aria-label="Undo"
        title="Undo (Ctrl/Cmd+Z)"
        disabled={!canUndo}
        aria-disabled={!canUndo}
        onClick={undo}
      >
        ↶ Undo
      </button>
      <button
        data-testid="redo-button"
        aria-label="Redo"
        title="Redo (Ctrl/Cmd+Shift+Z)"
        disabled={!canRedo}
        aria-disabled={!canRedo}
        onClick={redo}
      >
        ↷ Redo
      </button>
    </>
  );
}
