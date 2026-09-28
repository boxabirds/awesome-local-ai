import type { PointerEvent as ReactPointerEvent } from 'react';

/** Tooltip and title text for the create button, exactly as the PRD words it. */
export const STICKY_BUTTON_TOOLTIP = 'Sticky note \u2013 or double-click the board';

export interface ToolbarProps {
  onCreateSticky(): void;
}

/**
 * Fixed left-side vertical toolbar. Story 2 contributes the Sticky note
 * button; later stories add their tools here.
 */
export function Toolbar({ onCreateSticky }: ToolbarProps) {
  const stop = (e: ReactPointerEvent<HTMLElement>) => {
    // The toolbar is board chrome: a click on it must not reach the viewport
    // (which would pan, clear the selection or create a note at that point).
    e.stopPropagation();
  };

  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      role="toolbar"
      aria-label="Board tools"
      aria-orientation="vertical"
      onPointerDown={stop}
    >
      <button
        type="button"
        className="toolbar-button"
        data-testid="create-sticky"
        aria-label="Sticky note"
        title={STICKY_BUTTON_TOOLTIP}
        onClick={onCreateSticky}
      >
        <span className="toolbar-icon" aria-hidden="true">
          &#9635;
        </span>
        <span className="toolbar-label">Sticky note</span>
      </button>
    </div>
  );
}
