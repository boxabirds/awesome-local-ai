import type { SyntheticEvent } from 'react';

export const STICKY_BUTTON_TOOLTIP = 'Sticky note – or double-click the board';

const stop = (e: SyntheticEvent) => e.stopPropagation();

/** Fixed left-side toolbar. */
export function Toolbar(props: { onCreateSticky(): void; disabled?: boolean }) {
  return (
    <div
      className="toolbar"
      role="toolbar"
      aria-label="Tools"
      aria-orientation="vertical"
      onPointerDown={stop}
      onPointerUp={stop}
      onDoubleClick={stop}
    >
      <button
        type="button"
        className="toolbar__button"
        aria-label="Sticky note"
        title={STICKY_BUTTON_TOOLTIP}
        disabled={props.disabled}
        onClick={props.onCreateSticky}
      >
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
          <path d="M3 3h16v11l-5 5H3z" fill="#FFF59D" stroke="#1f2330" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M14 19v-5h5" fill="none" stroke="#1f2330" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
