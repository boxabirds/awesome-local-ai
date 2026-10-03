import type { JSX } from 'react';

export interface ToolbarProps {
  onCreateSticky(): void;
}

/**
 * Fixed left-side vertical toolbar with a Sticky note button.
 */
export function Toolbar(props: ToolbarProps): JSX.Element {
  return (
    <div
      className="board-toolbar"
      data-vidi6="board-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="board-toolbar-sticky"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        onClick={props.onCreateSticky}
      >
        <span className="board-toolbar-sticky-icon" aria-hidden="true">📝</span>
        <span className="board-toolbar-sticky-label">Sticky note</span>
      </button>
    </div>
  );
}
