import { type PointerEvent as ReactPointerEvent } from "react";

/**
 * Left-side vertical board toolbar (story 2: the Sticky note button).
 *
 * Exact UI text and accessible names come from the PRD:
 * `button[aria-label="Sticky note"]` with the tooltip
 * "Sticky note – or double-click the board".
 */
export const STICKY_BUTTON_LABEL = "Sticky note";
export const STICKY_BUTTON_TOOLTIP = "Sticky note – or double-click the board";

export interface ToolbarProps {
  onCreateSticky(): void;
}

export function Toolbar({ onCreateSticky }: ToolbarProps) {
  // Clicks on a toolbar must never reach the viewport, which would clear the
  // selection (and therefore the note toolbar).
  const stop = (event: ReactPointerEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  return (
    <div className="board-toolbar" data-testid="board-toolbar">
      <button
        type="button"
        className="board-toolbar-button"
        aria-label={STICKY_BUTTON_LABEL}
        title={STICKY_BUTTON_TOOLTIP}
        data-testid="sticky-note-button"
        onPointerDown={stop}
        onPointerUp={stop}
        onClick={onCreateSticky}
      >
        {STICKY_BUTTON_LABEL}
      </button>
    </div>
  );
}
