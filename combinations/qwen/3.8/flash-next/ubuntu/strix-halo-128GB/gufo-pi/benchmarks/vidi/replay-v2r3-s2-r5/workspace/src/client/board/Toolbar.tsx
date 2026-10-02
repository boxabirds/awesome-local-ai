import React from 'react';

export interface ToolbarProps {
  onCreateSticky(): void;
}

/**
 * Left-side vertical board toolbar (story 2: the Sticky note button).
 * The accessible name is "Sticky note"; the tooltip also explains the
 * double-click shortcut.
 */
export function Toolbar({ onCreateSticky }: ToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label="Board tools"
      data-testid="board-toolbar"
      className="vidi6-board-toolbar"
      style={{
        position: 'fixed',
        left: 16,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        backgroundColor: '#fff',
        borderRadius: 10,
        padding: 6,
        boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
        zIndex: 10,
      }}
      // Tool clicks must not reach the viewport (which would clear selection).
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        data-testid="create-sticky-button"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        onClick={onCreateSticky}
        style={{
          width: 40,
          height: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: 'none',
          borderRadius: 8,
          backgroundColor: 'transparent',
          cursor: 'pointer',
          color: '#37474f',
          padding: 0,
        }}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        >
          <path d="M4 4h16v10l-6 6H4z" fill="#FFF59D" />
          <path d="M20 14h-6v6" />
        </svg>
      </button>
    </div>
  );
}
