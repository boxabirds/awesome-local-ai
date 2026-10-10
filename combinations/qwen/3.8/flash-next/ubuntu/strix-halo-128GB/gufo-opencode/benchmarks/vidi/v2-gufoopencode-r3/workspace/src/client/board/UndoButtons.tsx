import type { JSX } from 'react';
import type { UndoState } from './useUndo';

// Undo and redo for this tab's own history (the controller's stacks hold only
// LOCAL_ORIGIN steps, so other people's changes are never touched).
export function UndoButtons({ canUndo, canRedo, undo, redo }: UndoState): JSX.Element {
  return (
    <>
      <button
        type="button"
        aria-label="Undo"
        aria-disabled={!canUndo}
        title="Undo (Ctrl/Cmd+Z)"
        onClick={undo}
        disabled={!canUndo}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            d="M7 5 3 9l4 4M3 9h7.5a4.5 4.5 0 1 1 0 9H8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Redo"
        aria-disabled={!canRedo}
        title="Redo (Ctrl/Cmd+Shift+Z)"
        onClick={redo}
        disabled={!canRedo}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            d="M13 5l4 4-4 4M17 9H9.5a4.5 4.5 0 1 0 0 9H12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </>
  );
}
