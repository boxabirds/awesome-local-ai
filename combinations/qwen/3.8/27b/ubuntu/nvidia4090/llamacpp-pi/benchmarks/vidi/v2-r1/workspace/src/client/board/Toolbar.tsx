// Toolbar (story 2, sticky.toolbar contract): the fixed left toolbar with
// the Sticky note button.

import type { JSX } from 'react';

export interface ToolbarProps {
  onCreateSticky(): void;
}

export const STICKY_BUTTON_TOOLTIP = 'Sticky note – or double-click the board';

export function Toolbar(props: ToolbarProps): JSX.Element {
  const { onCreateSticky } = props;
  return (
    <div
      className="toolbar"
      role="toolbar"
      aria-label="Board tools"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="toolbar__sticky"
        aria-label="Sticky note"
        title={STICKY_BUTTON_TOOLTIP}
        onClick={onCreateSticky}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="14" height="14" rx="1.5" fill="#FFF59D" stroke="#b5a642" />
          <path d="M10 3v8h7" fill="#e8d873" stroke="#b5a642" strokeWidth="0.75" />
        </svg>
      </button>
    </div>
  );
}
