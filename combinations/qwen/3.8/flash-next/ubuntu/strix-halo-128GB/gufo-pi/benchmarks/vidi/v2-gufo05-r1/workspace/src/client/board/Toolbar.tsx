/**
 * The left-hand toolbar: the tools, and under them this person's Undo and Redo.
 *
 * "Sticky note" puts a note in the middle of the visible board and puts its text
 * straight into edit mode. The undo pair sits below the tools because that is the order
 * the PRD gives the structure — a tool adds, and the history steps back over what the
 * tools did — and because a divider is cheaper than reasoning about it later.
 *
 * It is a fixed overlay outside the world layer, so it does not pan or zoom and
 * stays reachable at any zoom level.
 */
import { UndoButtons } from './UndoButtons';
import type { UndoHandle } from './useUndo';

export interface ToolbarProps {
  onCreateSticky(): void;
  /** This person's history, for the buttons underneath the tools. */
  undo: UndoHandle;
}

export function Toolbar({ onCreateSticky, undo }: ToolbarProps) {
  return (
    <div className="toolbar" data-testid="toolbar" role="toolbar" aria-label="Board tools">
      <button
        type="button"
        className="toolbar__button"
        data-testid="tool-sticky-note"
        aria-label="Sticky note"
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
