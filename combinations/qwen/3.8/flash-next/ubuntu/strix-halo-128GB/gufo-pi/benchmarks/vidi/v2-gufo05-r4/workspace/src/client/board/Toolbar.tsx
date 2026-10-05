/**
 * The left-side tool bar: what the pointer does when you click the board, plus the two
 * things that act on the board as a whole.
 *
 * Two kinds of button live here, and the difference is worth stating because it is how
 * the board thinks:
 *
 *  - a **tool** is a mode. It lights up while it is held, changes what a click on the
 *    board means, and is left by Escape or by its key. Select is the resting tool; the
 *    Text tool of story 9 is the first mode the board offers (`text.tool`).
 *  - an **action** happens when you press it and nothing is left switched on. Sticky note
 *    is still that: one press, one note in the middle of the view, ready to type
 *    (`sticky.create` — story 2's behaviour, story 9's shortcut `N`).
 *
 * A tool the board cannot offer is disabled rather than silent: on a board that failed to
 * load the Text tool says so by being switched off (`text.limit_access`).
 */

import type { JSX } from 'react';
import type { Tool } from './useTool';
import type { UndoActions } from './useUndo';
import { UndoButtons } from './UndoButtons';

export interface ToolbarProps {
  onCreateSticky(): void;
  /** Which tool the pointer is holding (`text.tool`). Defaults to Select. */
  tool?: Tool;
  /** Hold the pointer: clicks select, and nothing is placed. */
  onSelectTool?(): void;
  /** Hold the Text tool: the next click on the board places text there. */
  onTextTool?(): void;
  /**
   * False when the board cannot be written to (story 4: it could not be loaded). Buttons
   * that would change the board say so by being disabled rather than by doing nothing
   * when clicked.
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
  const { onCreateSticky, onSelectTool, onTextTool, undo } = props;
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
        data-vidi6="tool-select"
        aria-label="Select (V)"
        aria-pressed={props.tool === 'select'}
        title="Select what is on the board – V"
        onClick={onSelectTool}
      >
        {/* An arrow pointer, drawn inline so there is no icon dependency. */}
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M4 2.5 15.5 9.2l-4.9 1.1 2.6 5.3-2.3 1.1-2.6-5.3L4 15.6V2.5Z" />
        </svg>
      </button>

      <button
        type="button"
        className="vidi6-tool"
        data-vidi6="tool-sticky"
        aria-label="Sticky note (N)"
        aria-disabled={disabled}
        disabled={disabled}
        title={disabled ? 'This board could not be loaded' : 'Sticky note – or double-click the board (N)'}
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

      <button
        type="button"
        className="vidi6-tool"
        data-vidi6="tool-text"
        aria-label="Text (T)"
        aria-pressed={props.tool === 'text'}
        aria-disabled={disabled}
        disabled={disabled}
        title={disabled ? 'This board could not be loaded' : 'Text – click the board to place it (T)'}
        onClick={onTextTool}
      >
        {/* A plain capital T: this tool draws text and nothing else. */}
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M3 3h14v3.2h-1.9V4.9h-3.8v10.2h2.1v1.9H6.6v-1.9h2.1V4.9H4.9v1.3H3V3Z" />
        </svg>
      </button>

      {/* Undo and redo sit with the tools: they act on the board the same way the tools
          do, and their enabled state is the only signal of what this client can reverse. */}
      {undo ? <UndoButtons undo={undo} /> : null}
    </div>
  );
}
