import React, { useCallback } from 'react';

export interface ToolbarProps {
  onCreateSticky(): void;
}

export const STICKY_NOTE_TOOLTIP = 'Sticky note – or double-click the board';

/** Fixed left toolbar: the only tool in this story is the sticky note. */
export function Toolbar({ onCreateSticky }: ToolbarProps) {
  const stop = useCallback((e: React.SyntheticEvent) => {
    // Never let a toolbar click reach the viewport (it would clear selection).
    e.stopPropagation();
  }, []);

  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      role="toolbar"
      aria-label="Board tools"
      onPointerDown={stop}
    >
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="create-sticky"
        aria-label="Sticky note"
        title={STICKY_NOTE_TOOLTIP}
        onClick={onCreateSticky}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          aria-hidden="true"
          focusable="false"
        >
          <rect x="2" y="2" width="16" height="16" rx="1.5" fill="#FFF59D" stroke="#8a8a4a" />
          <path d="M13 18V15a2 2 0 0 1 2-2h3" fill="none" stroke="#8a8a4a" strokeWidth="1" />
        </svg>
      </button>
    </div>
  );
}
