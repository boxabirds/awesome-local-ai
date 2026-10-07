import type { PointerEvent as ReactPointerEvent } from "react";

export interface ToolbarProps {
  onCreateSticky(): void;
}

export const STICKY_NOTE_BUTTON_LABEL = "Sticky note";
export const STICKY_NOTE_BUTTON_TOOLTIP = "Sticky note – or double-click the board";

/**
 * The fixed left-side board toolbar. Buttons act on the centre of the visible
 * board area, so they work wherever the board has been panned to.
 */
export function Toolbar({ onCreateSticky }: ToolbarProps) {
  const stop = (event: ReactPointerEvent<HTMLElement>) => {
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
    >
      <button
        type="button"
        className="board-tool"
        data-testid="create-sticky"
        aria-label={STICKY_NOTE_BUTTON_LABEL}
        title={STICKY_NOTE_BUTTON_TOOLTIP}
        onClick={onCreateSticky}
      >
        <span className="board-tool-icon" aria-hidden="true">
          {"\u{1F5E9}"}
        </span>
        <span className="board-tool-label">{STICKY_NOTE_BUTTON_LABEL}</span>
      </button>
    </div>
  );
}
