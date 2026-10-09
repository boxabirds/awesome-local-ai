import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import { UndoButtons } from './UndoButtons';
import type { UndoButtonState } from './useUndo';

/** Exact UI text (PRD: Left-side vertical toolbar with a "Sticky note" button). */
export const STICKY_BUTTON_LABEL = 'Sticky note';
export const STICKY_BUTTON_TOOLTIP = 'Sticky note – or double-click the board';

export interface ToolbarProps {
  /** Creates a note in the middle of the visible board area and starts editing it. */
  onCreateSticky(): void;
  /** Story 4: while the board could not be loaded, the Sticky note button is disabled. */
  disabled?: boolean;
  /** Story 8: the undo controls under the Sticky note button; absent off a board. */
  undo?: UndoButtonState;
}

/**
 * The fixed left toolbar. Its buttons are always available, whatever else is happening
 * on the board. Pointer events stop here so a click on a button never reaches the
 * viewport (which would pan the board and clear the selection).
 *
 * Story 5 moved sharing out of here and into the page that owns the board's address
 * (`share/SharePanel`): sharing is about the link, and the toolbar is about the board.
 */
export function Toolbar({ onCreateSticky, disabled = false, undo }: ToolbarProps): JSX.Element {
  const stop = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.stopPropagation();
  };

  return (
    <div
      className="vidi6-toolbar"
      data-testid="toolbar"
      onPointerDown={stop}
      onPointerUp={stop}
      onPointerCancel={stop}
      onDoubleClick={stop}
    >
      <button
        type="button"
        className="vidi6-toolbar-button"
        data-testid="create-sticky"
        aria-label={STICKY_BUTTON_LABEL}
        title={STICKY_BUTTON_TOOLTIP}
        onClick={onCreateSticky}
        disabled={disabled}
      >
        <span className="vidi6-sticky-glyph" aria-hidden="true" />
        <span className="vidi6-toolbar-text">{STICKY_BUTTON_LABEL}</span>
      </button>
      {undo ? <UndoButtons {...undo} /> : null}
    </div>
  );
}
