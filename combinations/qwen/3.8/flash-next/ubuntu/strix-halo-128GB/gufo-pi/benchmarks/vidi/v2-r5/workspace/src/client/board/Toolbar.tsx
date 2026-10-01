import type React from 'react';
import { UndoButtons } from './UndoButtons';
import type { UseUndoResult } from './useUndo';

export interface ToolbarProps {
  onCreateSticky(): void;
  disabled?: boolean;
  undo?: UseUndoResult;
}

/** Tooltip and accessible name of the sticky note button, exactly as the PRD words it. */
export const STICKY_NOTE_TOOLTIP = 'Sticky note – or double-click the board';

/**
 * Fixed left-side toolbar. In this story it holds one tool: create a sticky note in the middle
 * of the visible board.
 *
 * Pointer events stop at the toolbar so a click never reaches the viewport (which would pan the
 * board or clear the selection).
 */
export function Toolbar({ onCreateSticky, disabled, undo }: ToolbarProps) {
  const stop = (event: React.SyntheticEvent): void => {
    event.stopPropagation();
  };

  return (
    <div className="board-toolbar" data-testid="board-toolbar" role="toolbar" aria-label="Board tools"
      onPointerDown={stop}
      onPointerUp={stop}
      onClick={stop}
      onDoubleClick={stop}
      onWheel={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="create-sticky-button"
        aria-label="Sticky note"
        title={STICKY_NOTE_TOOLTIP}
        onClick={onCreateSticky}
        disabled={disabled}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M3 3h14v9.5L12.5 17H3V3Zm1.6 1.6v10.8h6.3v-3.9h3.9V4.6H4.6Z"
          />
        </svg>
      </button>
      {undo && <UndoButtons {...undo} />}
    </div>
  );
}
