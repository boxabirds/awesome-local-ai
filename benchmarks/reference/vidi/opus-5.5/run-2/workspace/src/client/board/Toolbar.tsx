/** Fixed left-side toolbar with the Sticky note button (anchor: sticky.toolbar). */
import type { PointerEvent, WheelEvent } from 'react';

export const STICKY_BUTTON_TOOLTIP = 'Sticky note – or double-click the board';

export function Toolbar(props: { onCreateSticky(): void }): React.JSX.Element {
  // The toolbar is not board space: pointer and wheel input here never reach the board.
  const stop = (e: PointerEvent | WheelEvent) => e.stopPropagation();
  return (
    <div
      className="board-toolbar"
      role="toolbar"
      aria-label="Tools"
      aria-orientation="vertical"
      data-testid="board-toolbar"
      onPointerDown={stop}
      onWheel={stop}
    >
      <button type="button" aria-label="Sticky note" title={STICKY_BUTTON_TOOLTIP} onClick={props.onCreateSticky}>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
          <path
            d="M4 4h16v10l-6 6H4z"
            fill="#FFF59D"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M14 20v-6h6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
