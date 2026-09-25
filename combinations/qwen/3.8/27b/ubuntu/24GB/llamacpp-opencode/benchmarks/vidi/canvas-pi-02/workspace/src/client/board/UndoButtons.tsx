import type { JSX } from 'react';
import type { UndoState } from './useUndo';

/**
 * The Undo / Redo toolbar buttons (story 8, undo.controls).
 *
 * `aria-label="Undo"` / `aria-label="Redo"` with tooltips
 * "Undo (Ctrl/Cmd+Z)" / "Redo (Ctrl/Cmd+Shift+Z)"; the `disabled` attribute
 * follows the controller's stacks (and the edit lock, via `useUndo`).
 */
export function UndoButtons(props: UndoState): JSX.Element {
  return (
    <>
      <button
        type="button"
        className="vidi6-toolbar__button"
        aria-label="Undo"
        title="Undo (Ctrl/Cmd+Z)"
        disabled={!props.canUndo}
        onClick={props.undo}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M8.5 3.5 4 8l4.5 4.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M4 8h7a5.5 5.5 0 0 1 5.5 5.5V15"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="vidi6-toolbar__button"
        aria-label="Redo"
        title="Redo (Ctrl/Cmd+Shift+Z)"
        disabled={!props.canRedo}
        onClick={props.redo}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M11.5 3.5 16 8l-4.5 4.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M16 8h-7A5.5 5.5 0 0 0 3.5 13.5V15"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </>
  );
}
