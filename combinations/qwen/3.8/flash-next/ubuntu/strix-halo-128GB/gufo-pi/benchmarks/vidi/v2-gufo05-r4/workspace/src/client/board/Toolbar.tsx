/**
 * The left-side tool bar. Today it holds one tool — Sticky note — and later
 * stories add theirs next to it.
 *
 * The button creates a note in the middle of whatever part of the board is on
 * screen (the caller works out where that is), so it works the same after the
 * user has panned a million units away as it does on a fresh board.
 */

import type { JSX } from 'react';
import type { UndoActions } from './useUndo';
import { UndoButtons } from './UndoButtons';

export interface ToolbarProps {
  onCreateSticky(): void;
  /**
   * False when the board cannot be written to (story 4: it could not be loaded). The
   * button says so by being disabled rather than by doing nothing when clicked.
   */
  disabled?: boolean;
  /**
   * The undo controls (story 8): the two buttons beside the tools, enabled only when this
   * client has a step of their own to reverse.
   */
  undo?: UndoActions;
}

/** Pointer and double-click gestures belong to the palette, not to the board. */
const stopPointer = (event: { stopPropagation(): void }) => {
  event.stopPropagation();
};

export function Toolbar(props: ToolbarProps): JSX.Element {
  const { onCreateSticky, undo } = props;
  const disabled = props.disabled === true;

  return (
    <div
      className="vidi6-toolbar"
      data-vidi6="toolbar"
      role="toolbar"
      aria-label="Board tools"
      onPointerDown={stopPointer}
      onDoubleClick={stopPointer}
    >
      <button
        type="button"
        className="vidi6-tool"
        data-vidi6="tool-sticky"
        aria-label="Sticky note"
        aria-disabled={disabled}
        disabled={disabled}
        title={disabled ? 'This board could not be loaded' : 'Sticky note – or double-click the board'}
        onClick={onCreateSticky}
      >
        {/* A folded-corner note, drawn inline so there is no icon dependency. */}
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M3 3.5A1.5 1.5 0 0 1 4.5 2h11A1.5 1.5 0 0 1 17 3.5V12l-5 5H4.5A1.5 1.5 0 0 1 3 15.5v-12Z"
          />
          <path fill="rgba(0,0,0,0.25)" d="M17 12h-3.5a1.5 1.5 0 0 0-1.5 1.5V17l5-5Z" />
        </svg>
      </button>

      {/* Undo and redo sit with the tools: they act on the board the same way the tools
          do, and their enabled state is the only signal of what this client can reverse. */}
      {undo ? <UndoButtons undo={undo} /> : null}
    </div>
  );
}
