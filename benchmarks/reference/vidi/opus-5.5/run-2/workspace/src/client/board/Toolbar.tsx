/**
 * Fixed left-side toolbar with the Sticky note button (anchor: sticky.toolbar) and, below
 * the tools, the Undo and Redo buttons (anchor: undo.buttons).
 */
import type { PointerEvent, WheelEvent } from 'react';
import { UndoButtons } from './UndoButtons';
import type { UndoApi } from './useUndo';

export const STICKY_BUTTON_TOOLTIP = 'Sticky note – or double-click the board';

export function Toolbar(props: { onCreateSticky(): void; disabled?: boolean; undo?: UndoApi }): React.JSX.Element {
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
      <button
        type="button"
        aria-label="Sticky note"
        title={STICKY_BUTTON_TOOLTIP}
        disabled={props.disabled === true}
        onClick={props.onCreateSticky}
      >
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
      {props.undo !== undefined && <UndoButtons {...props.undo} />}
    </div>
  );
}
