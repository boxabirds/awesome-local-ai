import type { JSX, PointerEvent as ReactPointerEvent } from 'react';

/** Shown when hovering the sticky note button (PRD "Add sticky notes", FR-2). */
export const STICKY_BUTTON_TOOLTIP = 'Sticky note \u2013 or double-click the board';

export interface ToolbarProps {
  /** Add a sticky note in the middle of what the user is looking at. */
  onCreateSticky(): void;
}

/**
 * The board's tools, docked at the top left. It is a `data-board-ui` element, so a press
 * on it never pans the board and a wheel over it never zooms - and it stays a fixed
 * screen-space control while the notes around it move.
 */
export function Toolbar({ onCreateSticky }: ToolbarProps): JSX.Element {
  const stop = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.stopPropagation();
  };
  return (
    <div
      className="toolbar"
      data-board-ui=""
      data-testid="board-toolbar"
      role="toolbar"
      aria-label="Board tools"
      aria-orientation="vertical"
      onPointerDown={stop}
      onDoubleClick={(event) => {
        event.stopPropagation();
      }}
    >
      <button
        type="button"
        className="toolbar__sticky"
        data-testid="create-sticky"
        aria-label="Sticky note"
        title={STICKY_BUTTON_TOOLTIP}
        onClick={onCreateSticky}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M4 4h10l6 6v10H4V4Zm1 1v14h11v-9h-5V5H5Zm6 1v4h4l-4-4Z"
          />
        </svg>
        <span className="toolbar__label">Sticky note</span>
      </button>
    </div>
  );
}
