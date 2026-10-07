import type { PointerEvent as ReactPointerEvent } from "react";
import { DEFAULT_STICKY_COLOR, STICKY_COLORS } from "../../shared/config";

/**
 * The fixed left toolbar (sticky.toolbar). One button for now: the sticky note.
 */
export interface ToolbarProps {
  onCreateSticky(): void;
}

export const STICKY_BUTTON_LABEL = "Sticky note";
export const STICKY_BUTTON_TOOLTIP = "Sticky note – or double-click the board";

export function Toolbar({ onCreateSticky }: ToolbarProps) {
  const stop = (event: ReactPointerEvent<HTMLDivElement>) => {
    // A toolbar click is never a board click.
    event.stopPropagation();
  };

  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      onPointerDown={stop}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="sticky-note-button"
        aria-label={STICKY_BUTTON_LABEL}
        title={STICKY_BUTTON_TOOLTIP}
        onClick={onCreateSticky}
      >
        <span
          className="board-toolbar-icon"
          aria-hidden="true"
          style={{ background: STICKY_COLORS[DEFAULT_STICKY_COLOR] }}
        />
        <span className="board-toolbar-text">{STICKY_BUTTON_LABEL}</span>
      </button>
    </div>
  );
}
