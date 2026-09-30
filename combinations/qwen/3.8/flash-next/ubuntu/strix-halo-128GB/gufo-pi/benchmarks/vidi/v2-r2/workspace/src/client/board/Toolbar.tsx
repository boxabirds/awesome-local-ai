import type { ReactElement } from 'react';

export interface ToolbarProps {
  onCreateSticky(): void;
}

export function Toolbar({ onCreateSticky }: ToolbarProps): ReactElement {
  return (
    <div
      className="board-toolbar"
      data-board-ui="true"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        className="board-toolbar-btn"
        onClick={onCreateSticky}
        data-testid="sticky-note-btn"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <rect x="2" y="2" width="16" height="16" rx="2" fill="#FFF59D" stroke="#999" strokeWidth="1" />
          <line x1="6" y1="7" x2="14" y2="7" stroke="#999" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="6" y1="11" x2="12" y2="11" stroke="#999" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
