import { type JSX } from 'react';

export interface ToolbarProps {
  onCreateSticky(): void;
}

/**
 * Fixed left-side toolbar with the Sticky note button.
 */
export function Toolbar({ onCreateSticky }: ToolbarProps): JSX.Element {
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
      >
        <span aria-hidden="true">&#x1F4CC;</span>
      </button>
    </div>
  );
}
