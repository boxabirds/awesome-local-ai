// The Undo / Redo toolbar buttons (story 8). They are the only undo controls a
// mouse-only contributor needs, and they expose their enabled state so the keyboard
// shortcuts and the buttons always agree.
//
// A disabled button carries `aria-disabled` as well as the native `disabled`, so its
// state is announced even while it is inert. Both are off when the corresponding
// stack is empty or the board is not editable (`useUndo` already folds `canEdit` into
// `canUndo`/`canRedo`).

import type { UndoActions } from './useUndo';

export function UndoButtons({ canUndo, canRedo, undo, redo }: UndoActions) {
  return (
    <>
      <button
        type="button"
        className="board-tool"
        data-testid="undo"
        onClick={undo}
        disabled={!canUndo}
        aria-disabled={!canUndo}
        aria-label="Undo"
        title="Undo (⌘/Ctrl+Z)"
      >
        <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M7.5 5 3.5 9l4 4M3.5 9h8a4.5 4.5 0 1 1 0 9H8"
          />
        </svg>
      </button>
      <button
        type="button"
        className="board-tool"
        data-testid="redo"
        onClick={redo}
        disabled={!canRedo}
        aria-disabled={!canRedo}
        aria-label="Redo"
        title="Redo (⇧⌘/Ctrl+Z)"
      >
        <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12.5 5l4 4-4 4M16.5 9h-8a4.5 4.5 0 1 0 0 9H12"
          />
        </svg>
      </button>
    </>
  );
}
