import { type JSX, type ReactNode } from 'react';

export interface ToolbarProps {
  onCreateSticky(): void;
  /** False while the board cannot be edited (persist.load_failure). */
  editable?: boolean;
  /** Undo/Redo buttons rendered below the tools. */
  undoButtons?: ReactNode;
}

/**
 * Fixed left-side toolbar with the Sticky note button and undo/redo buttons.
 */
export function Toolbar({ onCreateSticky, editable = true, undoButtons }: ToolbarProps): JSX.Element {
  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Sticky note"
        data-testid="create-sticky"
        title="Sticky note \u2013 or double-click the board"
        onClick={onCreateSticky}
        disabled={!editable}
        aria-disabled={!editable}
      >
        <span aria-hidden="true">&#x1F4CC;</span>
      </button>
      {undoButtons}
    </div>
  );
}
