import { type JSX, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * The left board toolbar. In story 2 it holds the Sticky note button; later
 * stories add the other tools next to it.
 */

export interface ToolbarProps {
  /** Create a note in the middle of the visible board area and start typing. */
  onCreateSticky(): void;
}

export function Toolbar({ onCreateSticky }: ToolbarProps): JSX.Element {
  const stop = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    // A toolbar click must never reach the board surface (which would pan or clear selection).
    event.stopPropagation();
  };

  return (
    <div className="board-toolbar" data-testid="board-toolbar" data-vidi6-overlay="true">
      <button
        type="button"
        className="tool-button"
        data-testid="create-sticky"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        onPointerDown={stop}
        onClick={(event) => {
          event.stopPropagation();
          onCreateSticky();
        }}
      >
        <span className="tool-icon" aria-hidden="true">
          <span className="tool-icon-square" />
        </span>
        <span className="tool-label">Sticky note</span>
      </button>
    </div>
  );
}
