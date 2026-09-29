import type { SyntheticEvent } from 'react';

export const STICKY_BUTTON_TOOLTIP = 'Sticky note – or double-click the board';

const stop = (e: SyntheticEvent) => e.stopPropagation();

/** Fixed left-side toolbar. */
export function Toolbar(props: { onCreateSticky(): void }) {
  return (
    <div
      className="toolbar"
      role="toolbar"
      aria-label="Tools"
      aria-orientation="vertical"
      onPointerDown={stop}
      onDoubleClick={stop}
      onWheel={stop}
    >
      <button
        type="button"
        className="toolbar-button"
        aria-label="Sticky note"
        title={STICKY_BUTTON_TOOLTIP}
        onClick={props.onCreateSticky}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M4 4h16v11l-5 5H4z"
            fill="#FFF59D"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M20 15h-5v5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
