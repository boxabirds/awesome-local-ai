import React from 'react';

export interface ToolbarProps {
  onCreateSticky(): void;
}

/**
 * Fixed left-side toolbar. Currently holds the Sticky note button. Stops
 * pointer events so a click here never reaches the viewport (which would clear
 * the selection or start a pan).
 */
export function Toolbar({ onCreateSticky }: ToolbarProps) {
  return (
    <div
      data-testid="left-toolbar"
      role="toolbar"
      aria-label="Board tools"
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: 16,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 8,
        backgroundColor: '#fff',
        borderRadius: 10,
        boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
        zIndex: 10,
      }}
    >
      <button
        type="button"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        onClick={onCreateSticky}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 44,
          height: 44,
          border: 'none',
          borderRadius: 8,
          backgroundColor: '#FFF59D',
          color: '#333',
          cursor: 'pointer',
          fontSize: 22,
          lineHeight: 1,
        }}
      >
        {'🗒'}
      </button>
    </div>
  );
}
