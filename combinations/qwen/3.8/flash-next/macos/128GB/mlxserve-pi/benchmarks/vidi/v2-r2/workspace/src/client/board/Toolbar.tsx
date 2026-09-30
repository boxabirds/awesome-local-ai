// The fixed tools on the left edge of the board. Only the sticky note tool today;
// stories 9-12 add the rest of the shapes to this rail.

import type { JSX } from 'react';

export interface ToolbarProps {
  onCreateSticky(): void;
  /**
   * Tools that change the board are switched off - a board the room could not read
   * takes no edits. `disabledReason` is why, and is what the button says, so the
   * person at the keyboard is told rather than left clicking a dead button.
   */
  disabled?: boolean;
  disabledReason?: string;
}

export function Toolbar({
  onCreateSticky,
  disabled = false,
  disabledReason,
}: ToolbarProps): JSX.Element {
  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      role="toolbar"
      aria-label="Board tools"
      // Tools are UI: a press or a wheel over them belongs to the tool, so the
      // board neither pans, zooms nor clears its selection because of one.
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="board-tool"
        data-testid="create-sticky"
        aria-label="Sticky note"
        aria-disabled={disabled || undefined}
        disabled={disabled}
        title={
          disabled
            ? (disabledReason ?? 'Not available right now')
            : 'Sticky note – or double-click the board'
        }
        onClick={onCreateSticky}
      >
        <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
            d="M3.5 3.5h13v9l-4.5 4.5h-8.5z"
          />
          <path fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" d="M16.5 12.5h-4.5v4.5" />
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            d="M6.5 7.5h7M6.5 10.5h4"
          />
        </svg>
      </button>
    </div>
  );
}
