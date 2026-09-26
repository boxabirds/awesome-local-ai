// Story 2: the fixed left-side board toolbar (anchor: sticky.toolbar) with
// the Sticky note button.

import type { JSX } from 'react';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';

export function Toolbar(props: { onCreateSticky: () => void }): JSX.Element {
  const stop = (e: ReactPointerEvent | ReactMouseEvent): void => {
    e.stopPropagation();
  };
  return (
    <div
      className="board-toolbar"
      onPointerDown={stop}
      onDoubleClick={stop}
      onClick={stop}
    >
      <button
        type="button"
        className="board-toolbar__sticky"
        title="Sticky note – or double-click the board"
        aria-label="Sticky note"
        onClick={props.onCreateSticky}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            d="M3 3h14v9l-5 5H3V3zm10 11.5V15h3.5L13 14.5z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
      </button>
    </div>
  );
}
