/**
 * The left-hand toolbar: the tools, and under them this person's Undo and Redo.
 *
 * Two kinds of control live here, and the difference is what a click on the board
 * does afterwards:
 *
 * - **Modes** — Select and Text (`text.tool_ui`). One of them is always armed
 *   (`aria-pressed`), and arming one changes what the next click means without
 *   changing anything on the board. `V` and `T` are the same two choices; the
 *   shortcut is in the label so a person can read the pairing off the button.
 * - **Actions** — Sticky note, which puts a note in the middle of the visible
 *   board and puts its text straight into edit mode (`N` does the same thing), and
 *   the undo pair, which steps back over what the tools did.
 *
 * Text is disabled when the board cannot be written: offering a mode whose clicks
 * go nowhere is worse than saying the board cannot be edited (`text.tool_ui`).
 *
 * It is a fixed overlay outside the world layer, so it does not pan or zoom and
 * stays reachable at any zoom level.
 */
import { UndoButtons } from './UndoButtons';
import type { Tool } from './useTool';
import type { UndoHandle } from './useUndo';

export interface ToolbarProps {
  onCreateSticky(): void;
  /** Which mode a click on the board is in. Defaults to Select for a caller with no modes. */
  tool?: Tool;
  /** False on a board that cannot be written: Text is disabled (`text.tool_ui`). */
  canEdit?: boolean;
  /** Arm a mode. Absent means the toolbar has no modes to offer. */
  onTool?(tool: Tool): void;
  /** This person's history, for the buttons underneath the tools. */
  undo: UndoHandle;
}

export function Toolbar({ onCreateSticky, tool = 'select', canEdit = true, onTool, undo }: ToolbarProps) {
  return (
    <div className="toolbar" data-testid="toolbar" role="toolbar" aria-label="Board tools">
      <button
        type="button"
        className="toolbar__button"
        data-testid="tool-select"
        aria-label="Select (V)"
        aria-pressed={tool === 'select'}
        title="Select — drag to move objects, click empty board to clear the selection"
        onClick={() => {
          onTool?.('select');
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M4 2.5l8 4.2-3.4 1.1-1.2 3.5L4 2.5z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
        <span>Select</span>
      </button>
      <button
        type="button"
        className="toolbar__button"
        data-testid="tool-text"
        aria-label="Text (T)"
        aria-pressed={tool === 'text'}
        disabled={!canEdit}
        title="Text — click anywhere on the board to write there"
        onClick={() => {
          onTool?.('text');
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M3 4V2.5h10V4M8 2.5V13M6 13h4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
        <span>Text</span>
      </button>
      <button
        type="button"
        className="toolbar__button"
        data-testid="tool-sticky-note"
        aria-label="Sticky note (N)"
        title="Sticky note — adds a note in the centre and starts typing"
        onClick={onCreateSticky}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M3 3h10v7l-3 3H3V3z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path d="M13 10h-3v3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
        <span>Sticky note</span>
      </button>
      <UndoButtons {...undo} />
    </div>
  );
}
