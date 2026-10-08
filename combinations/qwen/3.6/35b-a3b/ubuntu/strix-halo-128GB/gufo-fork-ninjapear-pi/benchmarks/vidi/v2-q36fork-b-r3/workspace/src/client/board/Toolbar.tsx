import React from 'react';

interface ToolbarProps {
  onCreateSticky(): void;
}

export function Toolbar({ onCreateSticky }: ToolbarProps) {
  return (
    <div
      style={{
        position: 'fixed',
        left: 12,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 100,
      }}
    >
      <button
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        onClick={onCreateSticky}
        style={{
          width: 40,
          height: 40,
          border: 'none',
          borderRadius: 8,
          background: '#fff',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          cursor: 'pointer',
          fontSize: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#333',
        }}
      >
        📝
      </button>
    </div>
  );
}
