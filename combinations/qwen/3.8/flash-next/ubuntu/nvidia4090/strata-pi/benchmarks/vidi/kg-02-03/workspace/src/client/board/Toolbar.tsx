import type { MouseEvent, PointerEvent as ReactPointerEvent } from "react";

/**
 * The fixed left-side toolbar of the board (story 2: the Sticky note button).
 */
export interface ToolbarProps {
  onCreateSticky(): void;
}

/** Exact PRD text: tooltip and accessible name of the create button. */
export const STICKY_BUTTON_LABEL = "Sticky note";
export const STICKY_BUTTON_TOOLTIP = "Sticky note – or double-click the board";

export function Toolbar({ onCreateSticky }: ToolbarProps) {
  // The toolbar sits outside the viewport, but stopping propagation keeps a
  // click here from ever reaching the board underneath.
  const stop = (event: ReactPointerEvent<HTMLDivElement> | MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      role="toolbar"
      aria-label="Board tools"
      onPointerDown={stop}
      onPointerUp={stop}
      onClick={stop}
    >
      <button
        type="button"
        className="toolbar-button"
        data-testid="sticky-note-button"
        aria-label={STICKY_BUTTON_LABEL}
        title={STICKY_BUTTON_TOOLTIP}
        onClick={onCreateSticky}
      >
        <span className="toolbar-button-icon" aria-hidden="true">
          ▧
        </span>
        <span className="toolbar-button-text">{STICKY_BUTTON_LABEL}</span>
      </button>
    </div>
  );
}
