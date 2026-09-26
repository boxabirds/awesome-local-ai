import type { JSX } from 'react';
import type { UndoState } from './useUndo';

/**
 * The Undo / Redo pair at the bottom of the left toolbar (story 8, design
 * "Undo/Redo UI").
 *
 * Two small buttons under the sticky-note tool: a curved arrow left and a
 * curved arrow right, with the shortcut in the tooltip. They are *always
 * rendered* (unlike the selection bar, which hides): a greyed-out Undo still
 * tells you undo exists and that this board is simply done with undoing.
 * `disabled` is the native attribute — which also carries `aria-disabled` —
 * and it is set whenever the personal history is empty or the board cannot
 * be edited (`undo.not_editable`).
 */
export function UndoButtons(props: UndoState): JSX.Element {
  return (
    <>
      <button
        type="button"
        className="board-toolbar__button"
        data-testid="undo-button"
        aria-label="Undo"
        title="Undo (Ctrl/Cmd+Z)"
        disabled={!props.canUndo}
        aria-disabled={!props.canUndo}
        onClick={props.undo}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" focusable="false" aria-hidden="true">
          <path
            d="M7 4.5H12a3.2 3.2 0 0 1 0 6.4H5.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <path
            d="M9.2 2.2 6.4 4.5l2.8 2.3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="board-toolbar__button"
        data-testid="redo-button"
        aria-label="Redo"
        title="Redo (Ctrl/Cmd+Shift+Z)"
        disabled={!props.canRedo}
        aria-disabled={!props.canRedo}
        onClick={props.redo}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" focusable="false" aria-hidden="true">
          <path
            d="M11 4.5H6a3.2 3.2 0 0 0 0 6.4h6.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <path
            d="M8.8 2.2l2.8 2.3-2.8 2.3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </>
  );
}