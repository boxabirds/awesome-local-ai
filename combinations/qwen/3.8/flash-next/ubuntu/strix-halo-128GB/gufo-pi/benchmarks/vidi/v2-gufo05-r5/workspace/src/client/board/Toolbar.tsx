/**
 * The fixed left toolbar. Story 2 adds the Sticky note button; later stories add tools
 * to the same strip.
 */
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';

export interface ToolbarProps {
  /** Creates a note at the centre of the visible board area and starts editing it. */
  onCreateSticky(): void;
}

/** Tooltip (and accessible hint) of the Sticky note button, as worded in the PRD. */
export const STICKY_NOTE_TOOLTIP = 'Sticky note – or double-click the board';

export function Toolbar({ onCreateSticky }: ToolbarProps): JSX.Element {
  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      role="toolbar"
      aria-label="Board tools"
      onPointerDown={(event: ReactPointerEvent) => {
        event.stopPropagation();
      }}
    >
      <button
        type="button"
        className="board-toolbar__button"
        data-testid="create-sticky-button"
        aria-label="Sticky note"
        title={STICKY_NOTE_TOOLTIP}
        onClick={() => {
          onCreateSticky();
        }}
      >
        <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M2.5 2.75A.75.75 0 0 1 3.25 2h9.5a.75.75 0 0 1 .75.75V9.5L9.5 14H3.25a.75.75 0 0 1-.75-.75v-10.5ZM10 10.25h2.35L10 12.6v-2.35Z"
          />
        </svg>
      </button>
    </div>
  );
}
