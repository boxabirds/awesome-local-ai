import type { MouseEvent as ReactMouseEvent } from 'react';
import type { UseUndoResult } from './useUndo';
import { UndoButtons } from './UndoButtons';

export interface ToolbarProps {
  onCreateSticky(): void;
  undo: UseUndoResult;
}

/**
 * The fixed left-side tool palette. In story 2 it holds the Sticky note
 * button; story 8 adds Undo and Redo below.
 */
export function Toolbar({ onCreateSticky, undo }: ToolbarProps): React.JSX.Element {
  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      role="toolbar"
      aria-label="Board tools"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="create-sticky"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        onClick={(event: ReactMouseEvent) => {
          event.stopPropagation();
          onCreateSticky();
        }}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path fill="#FFF59D" stroke="#c9b458" d="M3 3h14v10l-4 4H3V3Z" />
          <path fill="#e6d488" d="M13 17v-4h4l-4 4Z" />
        </svg>
      </button>
      <UndoButtons {...undo} />
    </div>
  );
}
