import type { JSX } from 'react';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS } from '../../shared/config';

export interface ToolbarProps {
  onCreateSticky(): void;
  // Disabled while the board cannot be loaded (load_failed), TC-23.
  disabled?: boolean;
}

// Fixed left-side vertical toolbar.
export function Toolbar({ onCreateSticky, disabled = false }: ToolbarProps): JSX.Element {
  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
    >
      <button
        type="button"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        onClick={onCreateSticky}
        disabled={disabled}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <rect x="2" y="2" width="16" height="16" rx="2" fill={STICKY_COLORS[DEFAULT_STICKY_COLOR]} stroke="#0f172a" strokeWidth="1.5" />
          <path d="M12 18V14a2 2 0 0 1 2-2h4" fill="none" stroke="#0f172a" strokeWidth="1.5" />
        </svg>
      </button>
    </div>
  );
}
