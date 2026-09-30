import type { JSX } from 'react';

import { UndoButtons, type UndoButtonsProps } from './UndoButtons';

export interface ToolbarProps {
  onCreateSticky(): void;
  disabled?: boolean;
  undo?: UndoButtonsProps;
}

/** The tooltip of the Sticky note button, exactly as the product names it. */
export const STICKY_BUTTON_TOOLTIP = 'Sticky note – or double-click the board';

/**
 * The left-side board toolbar. In this story it holds one tool, the Sticky note
 * button; later stories add their tools here.
 *
 * Pointer events stop at the toolbar so clicking a tool never reaches the board
 * (which would pan it or clear the selection).
 */
export function Toolbar({ onCreateSticky, disabled, undo }: ToolbarProps): JSX.Element {
  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      role="toolbar"
      aria-label="Board tools"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="board-toolbar__button"
        data-testid="create-sticky"
        aria-label="Sticky note"
        title={STICKY_BUTTON_TOOLTIP}
        onClick={onCreateSticky}
        disabled={disabled}
      >
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M4 3.75A.75.75 0 0 1 4.75 3h7.69c.2 0 .39.08.53.22l3.81 3.81c.14.14.22.33.22.53v8.69a.75.75 0 0 1-.75.75H4.75a.75.75 0 0 1-.75-.75Zm1.5.75v11h11V8h-3.25a.75.75 0 0 1-.75-.75V4.5ZM13.5 6.5H16l-2.5-2.5Z"
          />
        </svg>
        <span>Sticky note</span>
      </button>
      {undo ? <UndoButtons {...undo} /> : null}
    </div>
  );
}
