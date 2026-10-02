import React from 'react';

export interface ToolbarProps {
  onCreateSticky(): void;
}

export const STICKY_NOTE_TOOLTIP = 'Sticky note – or double-click the board';

/**
 * Left-side vertical toolbar. Only the Sticky note button exists in story 2;
 * later stories add their tools here.
 */
export function Toolbar({ onCreateSticky }: ToolbarProps) {
  const stop = (event: React.SyntheticEvent) => {
    event.stopPropagation();
  };

  return (
    <div
      data-testid="board-toolbar"
      role="toolbar"
      aria-label="Board tools"
      onPointerDown={stop}
      onPointerUp={stop}
      onPointerMove={stop}
      onDoubleClick={stop}
      onWheel={stop}
      style={{
        position: 'fixed',
        left: 16,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        padding: 6,
        backgroundColor: '#ffffff',
        borderRadius: 10,
        boxShadow: '0 1px 6px rgba(0,0,0,0.2)',
      }}
    >
      <button
        type="button"
        aria-label="Sticky note"
        title={STICKY_NOTE_TOOLTIP}
        data-testid="create-sticky"
        onClick={onCreateSticky}
        style={{
          width: 40,
          height: 40,
          padding: 0,
          borderRadius: 8,
          border: '1px solid rgba(0,0,0,0.12)',
          backgroundColor: '#FFF59D',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#5f5517',
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <title>{STICKY_NOTE_TOOLTIP}</title>
          <path d="M4 4h16v11l-5 5H4z" />
          <path d="M20 15h-5v5" />
        </svg>
        <span className="visually-hidden" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
          Sticky note
        </span>
      </button>
    </div>
  );
}
