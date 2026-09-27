/**
 * Left-side vertical board toolbar (story 2: the Sticky note button).
 * Clicks here must never reach the viewport, so pointer events stop propagating
 * (otherwise the board would clear the selection under the toolbar).
 */
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';

export interface ToolbarProps {
  onCreateSticky(): void;
}

const TOOLBAR_TOOLTIP = 'Sticky note – or double-click the board';

export function Toolbar({ onCreateSticky }: ToolbarProps): JSX.Element {
  const stop = (event: ReactPointerEvent): void => {
    event.stopPropagation();
  };
  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      role="toolbar"
      aria-label="Board tools"
      onPointerDown={stop}
      onWheel={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="create-sticky"
        aria-label="Sticky note"
        title={TOOLBAR_TOOLTIP}
        onClick={onCreateSticky}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <rect
            x="3"
            y="3"
            width="14"
            height="14"
            rx="2"
            fill="#FFF59D"
            stroke="currentColor"
            strokeWidth="1.3"
          />
          <path d="M6 8h8M6 12h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
