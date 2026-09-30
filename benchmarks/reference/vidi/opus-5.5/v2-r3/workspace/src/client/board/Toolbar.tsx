import type { ReactNode } from 'react';

export const STICKY_BUTTON_TOOLTIP = 'Sticky note – or double-click the board';

/** Left-side vertical toolbar. */
export function Toolbar(props: { onCreateSticky(): void; disabled?: boolean; children?: ReactNode }) {
  return (
    <div className="toolbar" role="toolbar" aria-label="Tools" aria-orientation="vertical">
      <button
        type="button"
        className="toolbar-button"
        aria-label="Sticky note"
        title={STICKY_BUTTON_TOOLTIP}
        disabled={props.disabled}
        onClick={props.onCreateSticky}
      >
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" focusable="false">
          <path
            d="M4 3.5h14a.5.5 0 0 1 .5.5v9.5l-5 5H4a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5Z"
            fill="#FFF59D"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path d="M18.5 13.5h-4.5a.5.5 0 0 0-.5.5v4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      </button>
      {props.children}
    </div>
  );
}
