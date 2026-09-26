import type { JSX } from 'react';
import { UndoButtons } from './UndoButtons';
import type { UndoState } from './useUndo';

/**
 * The fixed left toolbar (PRD "Create by double-click" names its tooltip).
 *
 * It lives outside the world layer: it is UI, not board content, so it does
 * not pan, does not zoom and does not need the `data-board-object` marker that
 * tells BoardViewport "this is not empty board surface".
 *
 * Story 8 added the Undo / Redo pair under the sticky tool.
 */
export interface ToolbarProps {
  /** A new 200x200 sticky at the centre of the current viewport. */
  onCreateSticky(): void;
  /** The personal undo history's state, for the two buttons. */
  undo: UndoState;
}

export function Toolbar(props: ToolbarProps): JSX.Element {
  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      onPointerDown={(event) => {
        // UI chrome never reaches the board underneath.
        event.stopPropagation();
      }}
    >
      <button
        type="button"
        className="board-toolbar__button"
        data-testid="create-sticky"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        onClick={props.onCreateSticky}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" focusable="false" aria-hidden="true">
          <rect
            x="2.5"
            y="2.5"
            width="13"
            height="13"
            rx="1"
            fill="#FFF3A3"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <path d="M5.5 6.5h7M5.5 9.5h7M5.5 12.5h4" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
      <UndoButtons {...props.undo} />
    </div>
  );
}
