import type { JSX } from 'react';

export interface ToolbarProps {
  /** Create a sticky note centred in the visible board area, in edit mode. */
  onCreateSticky(): void;
}

const STOP = (e: { stopPropagation(): void }): void => {
  e.stopPropagation();
};

/**
 * Fixed left-side board toolbar with the Sticky note button. The container
 * stops pointer propagation so a click here never reaches the viewport
 * (which would clear the selection or pan).
 */
export function Toolbar(props: ToolbarProps): JSX.Element {
  return (
    <div
      className="vidi6-toolbar"
      role="toolbar"
      aria-label="Tools"
      onPointerDown={STOP}
      onPointerUp={STOP}
      onPointerCancel={STOP}
      onDoubleClick={STOP}
      onClick={STOP}
    >
      <button
        type="button"
        className="vidi6-toolbar__button"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        onClick={props.onCreateSticky}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M3.5 3.5h13v9l-4 4h-9v-13Z"
            fill="#FFF59D"
            stroke="#B9A83C"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          <path d="M12.5 16.5v-4h4" fill="#FFF59D" stroke="#B9A83C" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
