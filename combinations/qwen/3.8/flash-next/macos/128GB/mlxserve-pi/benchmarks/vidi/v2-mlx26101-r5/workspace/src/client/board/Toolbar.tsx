import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';

/** Tooltip of the Sticky note button (exact product text). */
export const STICKY_BUTTON_HINT = 'Sticky note – or double-click the board';

export interface ToolbarProps {
  /** Creates a sticky note in the middle of the visible board area. */
  onCreateSticky(): void;
}

/**
 * The fixed left-side toolbar. Only the Sticky note button exists in this story;
 * later stories add their tools here.
 *
 * The toolbar swallows pointer and wheel events, so clicking a tool never pans
 * the board or clears the selection.
 */
export function Toolbar({ onCreateSticky }: ToolbarProps): React.JSX.Element {
  const stop = (event: ReactPointerEvent<HTMLDivElement> | ReactWheelEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };
  return (
    <div
      aria-label="Board tools"
      className="board-toolbar"
      data-testid="board-toolbar"
      role="toolbar"
      aria-orientation="vertical"
      onClick={stop}
      onDoubleClick={stop}
      onPointerCancel={stop}
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
      onWheel={stop}
    >
      <button
        aria-label="Sticky note"
        className="toolbar-button"
        data-testid="create-sticky"
        title={STICKY_BUTTON_HINT}
        type="button"
        onClick={onCreateSticky}
      >
        <span aria-hidden="true" className="toolbar-icon">
          {'🗒'}
        </span>
        <span className="toolbar-label">Sticky note</span>
      </button>
    </div>
  );
}
