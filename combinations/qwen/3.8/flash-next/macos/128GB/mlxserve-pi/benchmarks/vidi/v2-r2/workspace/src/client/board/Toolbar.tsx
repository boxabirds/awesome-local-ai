// The fixed tools on the left edge of the board: the two the pointer can hold, and
// the one button that makes a thing without being told where. Stories 10-12 add the
// rest of the shapes to this rail.
//
// The tool buttons are a pressed state, not a highlight: the board must always say
// which tool the next click belongs to, because a click on an empty board either
// pans it or writes an object, and the two look exactly the same until one of them
// happens.

import type { JSX } from 'react';
import { UndoButtons } from './UndoButtons';
import type { UndoActions } from './useUndo';
import type { Tool } from './useTool';

export interface ToolbarProps {
  onCreateSticky(): void;
  /**
   * The tool the pointer holds. Optional, because the rail is also rendered on its
   * own (a test of the rail, a story-7 board with no tools): a rail that is not
   * wired to a tool shows Select as the pressed one, which is what a board with no
   * tools is.
   */
  tool?: Tool;
  /** A tool button. Optional for the same reason as `tool`. */
  onTool?: (tool: Tool) => void;
  /**
   * This person's undo/redo, shown as toolbar buttons (story 8). Left out when a
   * caller renders the bare tool rail on its own (a test); the real board always
   * passes it. The board being uneditable is folded into these actions already.
   */
  undo?: UndoActions;
  /**
   * Tools that change the board are switched off - a board the room could not read
   * takes no edits. `disabledReason` is why, and is what the button says, so the
   * person at the keyboard is told rather than left clicking a dead button.
   */
  disabled?: boolean;
  disabledReason?: string;
}

export function Toolbar({
  onCreateSticky,
  tool = 'select',
  onTool,
  undo,
  disabled = false,
  disabledReason,
}: ToolbarProps): JSX.Element {
  const reason = disabled ? (disabledReason ?? 'Not available right now') : undefined;
  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      role="toolbar"
      aria-label="Board tools"
      // Tools are UI: a press or a wheel over them belongs to the tool, so the
      // board neither pans, zooms nor clears its selection because of one.
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="board-tool"
        data-testid="tool-select"
        aria-label="Select (V)"
        // the pressed tool is the one the next click belongs to
        aria-pressed={tool === 'select'}
        disabled={disabled}
        title={reason ?? 'Select, move and resize – V'}
        onClick={() => {
          onTool?.('select');
        }}
      >
        <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
            d="M4.5 3.5l11 6.2-4.8 1.1-1.9 4.7z"
          />
        </svg>
      </button>
      <button
        type="button"
        className="board-tool"
        data-testid="tool-text"
        aria-label="Text (T)"
        aria-pressed={tool === 'text'}
        // a board that could not be read has no tools to hold: the button says so
        disabled={disabled}
        title={reason ?? 'Write text anywhere – T'}
        onClick={() => {
          onTool?.('text');
        }}
      >
        <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            d="M4.5 5.5h11M10 5.5v9.5"
          />
        </svg>
      </button>
      <span className="board-toolbar__divider" aria-hidden="true" />
      <button
        type="button"
        className="board-tool"
        data-testid="create-sticky"
        aria-label="Sticky note (N)"
        aria-disabled={disabled || undefined}
        disabled={disabled}
        title={
          disabled
            ? (reason ?? 'Not available right now')
            : 'Sticky note – N, or double-click the board'
        }
        onClick={onCreateSticky}
      >
        <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
            d="M3.5 3.5h13v9l-4.5 4.5h-8.5z"
          />
          <path fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" d="M16.5 12.5h-4.5v4.5" />
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            d="M6.5 7.5h7M6.5 10.5h4"
          />
        </svg>
      </button>
      {undo === undefined ? null : (
        <>
          <span className="board-toolbar__divider" aria-hidden="true" />
          <UndoButtons {...undo} />
        </>
      )}
    </div>
  );
}
